import Database from 'better-sqlite3'
import crypto from 'node:crypto'
import type { DatabaseAdapter, QueryResult, ExecuteResult, TransactionClient } from './types.js'

export function createSqliteAdapter(dbPath: string): DatabaseAdapter {
  const db = new Database(dbPath)

  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')

  db.function('gen_random_uuid', () => crypto.randomUUID())
  db.function('now', () => new Date().toISOString())

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

  const adapter: DatabaseAdapter = {
    async query<T>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const converted = convertParams(sql, params)
      const stmt = db.prepare(converted.sql)
      const rows = stmt.all(...converted.params) as T[]
      return { rows: convertBooleanResults<T>(rows), rowCount: rows.length }
    },

    async queryOne<T>(sql: string, params?: unknown[]): Promise<T | null> {
      const converted = convertParams(sql, params)
      const stmt = db.prepare(converted.sql)
      const row = stmt.get(...converted.params) as T | undefined
      return row ?? null
    },

    async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
      const converted = convertParams(sql, params)
      const stmt = db.prepare(converted.sql)
      const result = stmt.run(...converted.params)
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
      db.close()
    },

    getInfo() {
      return { mode: 'local', database: dbPath }
    },
  }

  return adapter
}
