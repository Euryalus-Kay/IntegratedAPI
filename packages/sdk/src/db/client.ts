import { getConfig, isLocal } from '../config/index.js'
import { createSqliteAdapter } from './sqlite.js'
import { createPostgresAdapter } from './postgres.js'
import { Migrator } from './migrator.js'
import { QueryBuilder } from './query-builder.js'
import { defineTable, getTableDefinitions, clearTableDefinitions, generateSqliteCreateTable } from './schema.js'
import type {
  DatabaseAdapter,
  QueryResult,
  ExecuteResult,
  TransactionClient,
  ColumnDefinition,
  ColumnType,
  IndexDefinition,
  DatabaseEvent,
  DatabaseEventHandler,
  QueryLog,
  DatabaseHealth,
  PaginatedResult,
  PaginationOptions,
  SeedContext,
} from './types.js'
import type { SqliteAdapterExtended } from './sqlite.js'

let _adapter: DatabaseAdapter | null = null
let _migrator: Migrator | null = null
let _initialized = false

/**
 * Event handlers registered before the adapter is created.
 * Once the adapter is available we replay them onto it (if it supports events).
 */
const _pendingListeners: Array<{ event: DatabaseEvent; handler: DatabaseEventHandler }> = []

function getAdapter(): DatabaseAdapter {
  if (!_adapter) {
    const config = getConfig()
    if (isLocal()) {
      _adapter = createSqliteAdapter(config.dbPath)

      // Replay any pending event listeners onto the real adapter
      if (isExtended(_adapter)) {
        for (const { event, handler } of _pendingListeners) {
          _adapter.on(event, handler)
        }
        _pendingListeners.length = 0
      }
    } else {
      _adapter = createPostgresAdapter(process.env.DATABASE_URL || '')
    }
  }
  return _adapter
}

/** Type-guard: does the adapter support extended methods? */
function isExtended(adapter: DatabaseAdapter): adapter is SqliteAdapterExtended {
  return typeof (adapter as any).on === 'function'
}

async function ensureInitialized(): Promise<void> {
  if (_initialized) return
  const adapter = getAdapter()
  _migrator = new Migrator(adapter)
  await _migrator.init()
  await _migrator.autoSync()
  _initialized = true
}

function wrapClientError(err: unknown, context: string): Error {
  const original = err instanceof Error ? err : new Error(String(err))
  // Avoid double-wrapping errors that already contain SQL context
  if (original.message.includes('SQL:')) return original
  const enhanced = new Error(`db.${context}: ${original.message}`)
  enhanced.cause = original
  return enhanced
}

export const db = {
  // ---------------------------------------------------------------------------
  // Core query methods (existing)
  // ---------------------------------------------------------------------------

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    await ensureInitialized()
    try {
      return await getAdapter().query<T>(sql, params)
    } catch (err) {
      throw wrapClientError(err, `query(${sql.slice(0, 60)}...)`)
    }
  },

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    await ensureInitialized()
    try {
      return await getAdapter().queryOne<T>(sql, params)
    } catch (err) {
      throw wrapClientError(err, `queryOne(${sql.slice(0, 60)}...)`)
    }
  },

  async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
    await ensureInitialized()
    try {
      return await getAdapter().execute(sql, params)
    } catch (err) {
      throw wrapClientError(err, `execute(${sql.slice(0, 60)}...)`)
    }
  },

  from<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table, getAdapter())
  },

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    await ensureInitialized()
    try {
      return await getAdapter().transaction(fn)
    } catch (err) {
      throw wrapClientError(err, 'transaction')
    }
  },

  defineTable(
    name: string,
    columns: Record<string, ColumnDefinition | ColumnType>,
    options?: { timestamps?: boolean; indexes?: IndexDefinition[] }
  ): void {
    defineTable(name, columns, options)
  },

  async sync(): Promise<{ created: string[]; modified: string[] }> {
    const adapter = getAdapter()
    if (!_migrator) {
      _migrator = new Migrator(adapter)
      await _migrator.init()
    }
    return _migrator.autoSync()
  },

  async reset(): Promise<void> {
    const adapter = getAdapter()
    if (!_migrator) {
      _migrator = new Migrator(adapter)
      await _migrator.init()
    }
    return _migrator.reset()
  },

  getConnectionInfo(): { mode: string; database: string } {
    return getAdapter().getInfo()
  },

  async close(): Promise<void> {
    if (_adapter) {
      await _adapter.close()
      _adapter = null
      _initialized = false
    }
  },

  // ---------------------------------------------------------------------------
  // New: Health check
  // ---------------------------------------------------------------------------

  /**
   * Return health information about the database (latency, table count, size).
   */
  async health(): Promise<DatabaseHealth> {
    await ensureInitialized()
    const adapter = getAdapter()
    if (isExtended(adapter)) {
      return adapter.getHealth()
    }
    // Fallback for non-extended adapters: basic latency test
    const start = performance.now()
    try {
      await adapter.query('SELECT 1')
      const latencyMs = Math.round((performance.now() - start) * 100) / 100
      return { status: latencyMs > 500 ? 'degraded' : 'healthy', latencyMs, tableCount: 0 }
    } catch {
      return { status: 'down', latencyMs: 0, tableCount: 0 }
    }
  },

  // ---------------------------------------------------------------------------
  // New: Query log
  // ---------------------------------------------------------------------------

  /**
   * Return the last 50 query log entries (only available with the SQLite adapter).
   */
  getQueryLog(): QueryLog[] {
    const adapter = getAdapter()
    if (isExtended(adapter)) {
      return adapter.getQueryLog()
    }
    return []
  },

  // ---------------------------------------------------------------------------
  // New: Event emitter
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to database events.
   *
   * Events:
   *  - `query`       – fired after every query with a QueryLog payload
   *  - `slow-query`  – fired when a query exceeds the slow-query threshold
   *  - `error`       – fired when a query throws
   *  - `connect`     – fired when the adapter connects
   *  - `disconnect`  – fired when the adapter disconnects
   *  - `migration`   – fired when a migration is applied
   */
  on(event: DatabaseEvent, handler: DatabaseEventHandler): void {
    // If the adapter is not yet created, queue the listener
    if (!_adapter) {
      _pendingListeners.push({ event, handler })
      return
    }
    const adapter = getAdapter()
    if (isExtended(adapter)) {
      adapter.on(event, handler)
    }
  },

  // ---------------------------------------------------------------------------
  // New: Seed
  // ---------------------------------------------------------------------------

  /**
   * Run a seed function with a rich context that provides insert/truncate helpers.
   *
   * @example
   * ```ts
   * await db.seed(async (ctx) => {
   *   ctx.log('Seeding users...')
   *   await ctx.insert('users', { name: 'Alice', email: 'alice@example.com' })
   *   await ctx.insertMany('posts', [
   *     { title: 'Hello', user_id: 1 },
   *     { title: 'World', user_id: 1 },
   *   ])
   * })
   * ```
   */
  async seed(fn: (ctx: SeedContext) => Promise<void>): Promise<void> {
    await ensureInitialized()
    const adapter = getAdapter()

    const ctx: SeedContext = {
      async insert<T = Record<string, unknown>>(table: string, data: Record<string, unknown>): Promise<T | null> {
        const columns = Object.keys(data)
        const values = Object.values(data)
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        const colStr = columns.map(c => `"${c}"`).join(', ')
        const sql = `INSERT INTO "${table}" (${colStr}) VALUES (${placeholders})`
        try {
          await adapter.execute(sql, values)
          // Try to return the inserted row
          const result = await adapter.queryOne<T>(
            `SELECT * FROM "${table}" WHERE rowid = last_insert_rowid()`,
          )
          return result
        } catch (err) {
          throw wrapClientError(err, `seed.insert("${table}")`)
        }
      },

      async insertMany(table: string, data: Record<string, unknown>[]): Promise<void> {
        if (data.length === 0) return
        const columns = Object.keys(data[0])
        for (const row of data) {
          const values = columns.map(c => row[c])
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
          const colStr = columns.map(c => `"${c}"`).join(', ')
          const sql = `INSERT INTO "${table}" (${colStr}) VALUES (${placeholders})`
          try {
            await adapter.execute(sql, values)
          } catch (err) {
            throw wrapClientError(err, `seed.insertMany("${table}")`)
          }
        }
      },

      async truncate(table: string): Promise<void> {
        try {
          await adapter.execute(`DELETE FROM "${table}"`)
        } catch (err) {
          throw wrapClientError(err, `seed.truncate("${table}")`)
        }
      },

      async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
        try {
          return await adapter.execute(sql, params)
        } catch (err) {
          throw wrapClientError(err, `seed.execute(${sql.slice(0, 60)}...)`)
        }
      },

      async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
        try {
          return await adapter.query<T>(sql, params)
        } catch (err) {
          throw wrapClientError(err, `seed.query(${sql.slice(0, 60)}...)`)
        }
      },

      log(message: string): void {
        console.log(`[seed] ${message}`)
      },
    }

    await fn(ctx)
  },

  // ---------------------------------------------------------------------------
  // New: Paginate shorthand
  // ---------------------------------------------------------------------------

  /**
   * Shorthand to paginate rows from a table.
   *
   * @example
   * ```ts
   * const result = await db.paginate('users', { page: 2, limit: 10 })
   * console.log(result.rows, result.totalPages, result.hasNext)
   * ```
   */
  async paginate<T = Record<string, unknown>>(
    table: string,
    options: PaginationOptions,
  ): Promise<PaginatedResult<T>> {
    await ensureInitialized()
    return new QueryBuilder<T>(table, getAdapter()).paginate(options.page, options.limit)
  },

  // ---------------------------------------------------------------------------
  // Internal (existing)
  // ---------------------------------------------------------------------------

  /** @internal */
  _getAdapter(): DatabaseAdapter { return getAdapter() },
  /** @internal */
  _getMigrator(): Migrator | null { return _migrator },
}
