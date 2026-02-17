import { getConfig, isLocal } from '../config/index.js'
import { createSqliteAdapter } from './sqlite.js'
import { createPostgresAdapter } from './postgres.js'
import { Migrator } from './migrator.js'
import { QueryBuilder } from './query-builder.js'
import { defineTable, getTableDefinitions, clearTableDefinitions, generateSqliteCreateTable } from './schema.js'
import type { DatabaseAdapter, QueryResult, ExecuteResult, TransactionClient, ColumnDefinition, ColumnType, IndexDefinition } from './types.js'

let _adapter: DatabaseAdapter | null = null
let _migrator: Migrator | null = null
let _initialized = false

function getAdapter(): DatabaseAdapter {
  if (!_adapter) {
    const config = getConfig()
    if (isLocal()) {
      _adapter = createSqliteAdapter(config.dbPath)
    } else {
      _adapter = createPostgresAdapter(process.env.DATABASE_URL || '')
    }
  }
  return _adapter
}

async function ensureInitialized(): Promise<void> {
  if (_initialized) return
  const adapter = getAdapter()
  _migrator = new Migrator(adapter)
  await _migrator.init()
  await _migrator.autoSync()
  _initialized = true
}

export const db = {
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    await ensureInitialized()
    return getAdapter().query<T>(sql, params)
  },

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    await ensureInitialized()
    return getAdapter().queryOne<T>(sql, params)
  },

  async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
    await ensureInitialized()
    return getAdapter().execute(sql, params)
  },

  from<T = Record<string, unknown>>(table: string): QueryBuilder<T> {
    return new QueryBuilder<T>(table, getAdapter())
  },

  async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
    await ensureInitialized()
    return getAdapter().transaction(fn)
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

  /** @internal */
  _getAdapter(): DatabaseAdapter { return getAdapter() },
  /** @internal */
  _getMigrator(): Migrator | null { return _migrator },
}
