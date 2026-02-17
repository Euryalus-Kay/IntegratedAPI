import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import fs from 'node:fs'
import type {
  DatabaseAdapter,
  QueryResult,
  ExecuteResult,
  TransactionClient,
  QueryLog,
  DatabaseEvent,
  DatabaseEventHandler,
  DatabaseHealth,
} from './types.js'

/**
 * Extended SQLite adapter with query logging, event emission, health checks,
 * slow-query detection, and connection state tracking.
 */
export interface SqliteAdapterExtended extends DatabaseAdapter {
  /** Register a handler for a database event. */
  on(event: DatabaseEvent, handler: DatabaseEventHandler): void
  /** Remove a handler for a database event. */
  off(event: DatabaseEvent, handler: DatabaseEventHandler): void
  /** Get the most recent query log entries (up to 50). */
  getQueryLog(): QueryLog[]
  /** Check database health (latency, table count, size). */
  getHealth(): Promise<DatabaseHealth>
  /** Whether the adapter is currently connected. */
  isConnected(): boolean
}

/** Slow query threshold in ms; configurable via VIBEKIT_SLOW_QUERY_MS env var. */
function getSlowQueryThreshold(): number {
  const envVal = process.env.VIBEKIT_SLOW_QUERY_MS
  if (envVal !== undefined) {
    const parsed = parseInt(envVal, 10)
    if (!isNaN(parsed) && parsed > 0) return parsed
  }
  return 200
}

export function createSqliteAdapter(dbPath: string): SqliteAdapterExtended {
  const db = new Database(dbPath)
  let connected = true

  // Pragmas
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  // Custom functions
  db.function('gen_random_uuid', () => crypto.randomUUID())
  db.function('now', () => new Date().toISOString())

  // ---------------------------------------------------------------------------
  // Event emitter
  // ---------------------------------------------------------------------------
  const listeners: Map<DatabaseEvent, Set<DatabaseEventHandler>> = new Map()

  function emit(event: DatabaseEvent, payload: unknown): void {
    const handlers = listeners.get(event)
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(payload)
        } catch {
          // swallow listener errors so they never break DB operations
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Query log ring-buffer (last 50 entries)
  // ---------------------------------------------------------------------------
  const MAX_LOG_ENTRIES = 50
  const queryLog: QueryLog[] = []

  function pushLog(entry: QueryLog): void {
    if (queryLog.length >= MAX_LOG_ENTRIES) {
      queryLog.shift()
    }
    queryLog.push(entry)
  }

  // ---------------------------------------------------------------------------
  // Timing / logging helpers
  // ---------------------------------------------------------------------------
  function timedQuery<R>(
    sql: string,
    params: unknown[],
    fn: () => R,
    rowCountFn: (result: R) => number,
  ): R {
    const start = performance.now()
    let result: R
    try {
      result = fn()
    } catch (err: unknown) {
      const duration = performance.now() - start
      const entry: QueryLog = {
        sql,
        params,
        durationMs: Math.round(duration * 100) / 100,
        rowCount: 0,
        timestamp: new Date().toISOString(),
        slow: duration >= getSlowQueryThreshold(),
      }
      pushLog(entry)
      emit('error', { sql, params, error: err, durationMs: entry.durationMs })
      throw wrapError(err, sql, params)
    }

    const duration = performance.now() - start
    const rowCount = rowCountFn(result)
    const slow = duration >= getSlowQueryThreshold()

    const entry: QueryLog = {
      sql,
      params,
      durationMs: Math.round(duration * 100) / 100,
      rowCount,
      timestamp: new Date().toISOString(),
      slow,
    }
    pushLog(entry)

    // Emit events
    emit('query', entry)
    if (slow) {
      emit('slow-query', entry)
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Error wrapping
  // ---------------------------------------------------------------------------
  function wrapError(err: unknown, sql: string, params: unknown[]): Error {
    const original = err instanceof Error ? err : new Error(String(err))
    const message = original.message || ''

    // Try to extract table name from SQL
    const tableMatch = sql.match(/(?:FROM|INTO|UPDATE|TABLE)\s+"?(\w+)"?/i)
    const tableName = tableMatch ? tableMatch[1] : 'unknown'

    let suggestion = ''
    if (message.includes('no such table')) {
      suggestion = `Table "${tableName}" does not exist. Did you forget to call db.sync() or define the table with db.defineTable()?`
    } else if (message.includes('UNIQUE constraint failed')) {
      const colMatch = message.match(/UNIQUE constraint failed:\s*(.+)/i)
      suggestion = colMatch
        ? `A row with the same value for ${colMatch[1]} already exists. Use upsert() or check for duplicates before inserting.`
        : 'A unique constraint was violated. Check your data for duplicate values.'
    } else if (message.includes('NOT NULL constraint failed')) {
      suggestion = 'A required column is missing a value. Check that all NOT NULL columns are provided.'
    } else if (message.includes('FOREIGN KEY constraint failed')) {
      suggestion = 'A referenced row does not exist. Ensure the related record exists before inserting/updating.'
    } else if (message.includes('no such column')) {
      const colMatch = message.match(/no such column:\s*(\S+)/i)
      suggestion = colMatch
        ? `Column "${colMatch[1]}" does not exist on table "${tableName}". Check your schema definition.`
        : `A column referenced in the query does not exist on table "${tableName}".`
    }

    const enhanced = new Error(
      `SQLite query failed on table "${tableName}": ${message}\n` +
      `  SQL: ${sql}\n` +
      `  Params: ${JSON.stringify(params)}\n` +
      (suggestion ? `  Suggestion: ${suggestion}\n` : '')
    )
    enhanced.cause = original
    return enhanced
  }

  // ---------------------------------------------------------------------------
  // Param conversion (unchanged logic from original)
  // ---------------------------------------------------------------------------
  function convertParams(sql: string, params?: unknown[]): { sql: string; params: unknown[] } {
    if (!params || params.length === 0) return { sql, params: [] }

    let convertedSql = sql
    const convertedParams: unknown[] = []

    convertedSql = sql.replace(/\$(\d+)/g, (_, num) => {
      const idx = parseInt(num, 10) - 1
      convertedParams.push(convertBooleanParam(params[idx]))
      return '?'
    })

    if (convertedParams.length === 0 && params.length > 0) {
      return { sql, params: params.map(convertBooleanParam) }
    }

    return { sql: convertedSql, params: convertedParams }
  }

  function convertBooleanParam(value: unknown): unknown {
    if (value === true) return 1
    if (value === false) return 0
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return JSON.stringify(value)
    }
    return value
  }

  function convertBooleanResults<T>(rows: any[]): T[] {
    return rows as T[]
  }

  // ---------------------------------------------------------------------------
  // Adapter implementation
  // ---------------------------------------------------------------------------
  emit('connect', { dbPath })

  const adapter: SqliteAdapterExtended = {
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const converted = convertParams(sql, params)
      const rows = timedQuery<T[]>(
        converted.sql,
        converted.params,
        () => {
          const stmt = db.prepare(converted.sql)
          return stmt.all(...converted.params) as T[]
        },
        (r) => r.length,
      )
      return { rows: convertBooleanResults<T>(rows), rowCount: rows.length }
    },

    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const converted = convertParams(sql, params)
      const row = timedQuery<T | undefined>(
        converted.sql,
        converted.params,
        () => {
          const stmt = db.prepare(converted.sql)
          return stmt.get(...converted.params) as T | undefined
        },
        (r) => (r !== undefined ? 1 : 0),
      )
      return row ?? null
    },

    async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
      const converted = convertParams(sql, params)
      const result = timedQuery(
        converted.sql,
        converted.params,
        () => {
          const stmt = db.prepare(converted.sql)
          return stmt.run(...converted.params)
        },
        (r) => r.changes,
      )
      return { rowCount: result.changes, lastInsertId: result.lastInsertRowid as number }
    },

    async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
      const txClient: TransactionClient = {
        query: adapter.query.bind(adapter),
        queryOne: adapter.queryOne.bind(adapter),
        execute: adapter.execute.bind(adapter),
      }

      db.exec('BEGIN')
      try {
        const result = await fn(txClient)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },

    async close(): Promise<void> {
      connected = false
      emit('disconnect', { dbPath })
      db.close()
    },

    getInfo() {
      return { mode: 'local', database: dbPath }
    },

    // ----- Extended methods -----

    on(event: DatabaseEvent, handler: DatabaseEventHandler): void {
      if (!listeners.has(event)) {
        listeners.set(event, new Set())
      }
      listeners.get(event)!.add(handler)
    },

    off(event: DatabaseEvent, handler: DatabaseEventHandler): void {
      listeners.get(event)?.delete(handler)
    },

    getQueryLog(): QueryLog[] {
      return [...queryLog]
    },

    async getHealth(): Promise<DatabaseHealth> {
      if (!connected) {
        return { status: 'down', latencyMs: 0, tableCount: 0 }
      }

      const start = performance.now()
      try {
        // Test query to measure latency
        const stmt = db.prepare('SELECT 1')
        stmt.get()
        const latencyMs = Math.round((performance.now() - start) * 100) / 100

        // Table count
        const tables = db.prepare(
          "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).get() as { cnt: number }

        // Database file size
        let sizeBytes: number | undefined
        try {
          const stat = fs.statSync(dbPath)
          sizeBytes = stat.size
        } catch {
          // file might not be accessible; leave undefined
        }

        const status = latencyMs > 500 ? 'degraded' : 'healthy'

        return {
          status,
          latencyMs,
          tableCount: tables.cnt,
          sizeBytes,
        }
      } catch {
        return { status: 'down', latencyMs: 0, tableCount: 0 }
      }
    },

    isConnected(): boolean {
      return connected
    },
  }

  return adapter
}
