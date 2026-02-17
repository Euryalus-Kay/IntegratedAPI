import type { DatabaseAdapter, Migration, MigrationState, TableDefinition } from './types.js'
import { getTableDefinitions, generateSqliteCreateTable } from './schema.js'

export class Migrator {
  constructor(private db: DatabaseAdapter) {}

  async init(): Promise<void> {
    await this.db.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_migrations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        up_sql TEXT NOT NULL,
        down_sql TEXT NOT NULL,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `)
  }

  async getState(): Promise<MigrationState> {
    const { rows } = await this.db.query<{ id: string; name: string; up_sql: string; down_sql: string; applied_at: string }>(
      'SELECT * FROM _vibekit_migrations ORDER BY id ASC'
    )
    return {
      applied: rows.map(r => ({ id: r.id, name: r.name, up: r.up_sql, down: r.down_sql, appliedAt: new Date(r.applied_at) })),
      pending: [],
    }
  }

  async autoSync(): Promise<{ created: string[]; modified: string[] }> {
    const tables = getTableDefinitions()
    const created: string[] = []
    const modified: string[] = []

    for (const [name, def] of tables) {
      const exists = await this.tableExists(name)
      if (!exists) {
        const sql = generateSqliteCreateTable(name, def)
        await this.db.execute(sql)
        created.push(name)
      } else {
        const existingCols = await this.getExistingColumns(name)
        for (const [colName, colDef] of Object.entries(def.columns)) {
          if (!existingCols.includes(colName)) {
            const colSql = this.generateAddColumn(name, colName, colDef)
            await this.db.execute(colSql)
            modified.push(`${name}.${colName}`)
          }
        }
      }
    }

    return { created, modified }
  }

  async apply(migration: Migration): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(migration.up)
      await tx.execute(
        'INSERT INTO _vibekit_migrations (id, name, up_sql, down_sql) VALUES ($1, $2, $3, $4)',
        [migration.id, migration.name, migration.up, migration.down]
      )
    })
  }

  async rollbackLast(): Promise<Migration | null> {
    const state = await this.getState()
    const last = state.applied[state.applied.length - 1]
    if (!last) return null

    await this.db.transaction(async (tx) => {
      await tx.execute(last.down)
      await tx.execute('DELETE FROM _vibekit_migrations WHERE id = $1', [last.id])
    })

    return last
  }

  async reset(): Promise<void> {
    const tables = await this.getAllTables()
    for (const table of tables) {
      if (table !== '_vibekit_migrations') {
        await this.db.execute(`DROP TABLE IF EXISTS "${table}"`)
      }
    }
    await this.db.execute('DELETE FROM _vibekit_migrations')
    await this.autoSync()
  }

  private async tableExists(name: string): Promise<boolean> {
    const result = await this.db.queryOne<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=$1",
      [name]
    )
    return result !== null
  }

  private async getExistingColumns(table: string): Promise<string[]> {
    const { rows } = await this.db.query<{ name: string }>(`PRAGMA table_info("${table}")`)
    return rows.map(r => r.name)
  }

  private async getAllTables(): Promise<string[]> {
    const { rows } = await this.db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    return rows.map(r => r.name)
  }

  private generateAddColumn(table: string, colName: string, col: any): string {
    const typeMap: Record<string, string> = {
      text: 'TEXT', integer: 'INTEGER', bigint: 'INTEGER', float: 'REAL',
      boolean: 'INTEGER', uuid: 'TEXT', timestamp: 'TEXT', timestamptz: 'TEXT',
      json: 'TEXT', jsonb: 'TEXT', bytea: 'BLOB',
    }
    const sqlType = typeMap[col.type] || 'TEXT'
    let sql = `ALTER TABLE "${table}" ADD COLUMN "${colName}" ${sqlType}`
    if (col.default !== undefined) {
      const def = typeof col.default === 'string' ? `'${col.default}'` : col.default
      sql += ` DEFAULT ${def}`
    }
    return sql
  }
}
