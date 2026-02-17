import type { ColumnDefinition, ColumnType, TableDefinition, IndexDefinition } from './types.js'

const _tables: Map<string, TableDefinition> = new Map()

export function defineTable(
  name: string,
  columns: Record<string, ColumnDefinition | ColumnType>,
  options?: { timestamps?: boolean; indexes?: IndexDefinition[] }
): void {
  const normalizedColumns: Record<string, ColumnDefinition> = {}

  for (const [colName, colDef] of Object.entries(columns)) {
    if (typeof colDef === 'string') {
      normalizedColumns[colName] = { type: colDef }
    } else {
      normalizedColumns[colName] = colDef
    }
  }

  if (options?.timestamps !== false) {
    if (!normalizedColumns.created_at) {
      normalizedColumns.created_at = { type: 'timestamptz', default: 'now()' }
    }
    if (!normalizedColumns.updated_at) {
      normalizedColumns.updated_at = { type: 'timestamptz', default: 'now()' }
    }
  }

  _tables.set(name, {
    columns: normalizedColumns,
    indexes: options?.indexes,
    timestamps: options?.timestamps !== false,
  })
}

export function getTableDefinitions(): Map<string, TableDefinition> {
  return new Map(_tables)
}

export function getTableDefinition(name: string): TableDefinition | undefined {
  return _tables.get(name)
}

export function clearTableDefinitions(): void {
  _tables.clear()
}

export function generateSqliteCreateTable(name: string, def: TableDefinition): string {
  const lines: string[] = []

  for (const [colName, col] of Object.entries(def.columns)) {
    let line = `  "${colName}" ${mapTypeToSqlite(col.type)}`
    if (col.primaryKey) line += ' PRIMARY KEY'
    if (col.notNull && !col.primaryKey) line += ' NOT NULL'
    if (col.unique) line += ' UNIQUE'
    if (col.default !== undefined) line += ` DEFAULT ${formatDefaultSqlite(col.default, col.type)}`
    if (col.references) {
      const [refTable, refCol] = col.references.split('.')
      line += ` REFERENCES "${refTable}"("${refCol}")`
      if (col.onDelete) line += ` ON DELETE ${col.onDelete.toUpperCase()}`
      if (col.onUpdate) line += ` ON UPDATE ${col.onUpdate.toUpperCase()}`
    }
    lines.push(line)
  }

  let sql = `CREATE TABLE IF NOT EXISTS "${name}" (\n${lines.join(',\n')}\n);`

  if (def.indexes) {
    for (const idx of def.indexes) {
      const unique = idx.unique ? 'UNIQUE ' : ''
      const cols = idx.columns.map(c => `"${c}"`).join(', ')
      sql += `\nCREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${name}" (${cols});`
    }
  }

  for (const [colName, col] of Object.entries(def.columns)) {
    if (col.index && !col.primaryKey && !col.unique) {
      sql += `\nCREATE INDEX IF NOT EXISTS "idx_${name}_${colName}" ON "${name}" ("${colName}");`
    }
  }

  return sql
}

export function generatePostgresCreateTable(name: string, def: TableDefinition): string {
  const lines: string[] = []

  for (const [colName, col] of Object.entries(def.columns)) {
    let line = `  "${colName}" ${mapTypeToPostgres(col.type)}`
    if (col.primaryKey) line += ' PRIMARY KEY'
    if (col.notNull && !col.primaryKey) line += ' NOT NULL'
    if (col.unique) line += ' UNIQUE'
    if (col.default !== undefined) line += ` DEFAULT ${formatDefaultPostgres(col.default, col.type)}`
    if (col.references) {
      const [refTable, refCol] = col.references.split('.')
      line += ` REFERENCES "${refTable}"("${refCol}")`
      if (col.onDelete) line += ` ON DELETE ${col.onDelete.toUpperCase()}`
      if (col.onUpdate) line += ` ON UPDATE ${col.onUpdate.toUpperCase()}`
    }
    lines.push(line)
  }

  let sql = `CREATE TABLE IF NOT EXISTS "${name}" (\n${lines.join(',\n')}\n);`

  if (def.indexes) {
    for (const idx of def.indexes) {
      const unique = idx.unique ? 'UNIQUE ' : ''
      const cols = idx.columns.map(c => `"${c}"`).join(', ')
      sql += `\nCREATE ${unique}INDEX IF NOT EXISTS "${idx.name}" ON "${name}" (${cols});`
    }
  }

  for (const [colName, col] of Object.entries(def.columns)) {
    if (col.index && !col.primaryKey && !col.unique) {
      sql += `\nCREATE INDEX IF NOT EXISTS "idx_${name}_${colName}" ON "${name}" ("${colName}");`
    }
  }

  return sql
}

function mapTypeToSqlite(type: ColumnType): string {
  const map: Record<ColumnType, string> = {
    text: 'TEXT', integer: 'INTEGER', bigint: 'INTEGER', float: 'REAL',
    boolean: 'INTEGER', uuid: 'TEXT', timestamp: 'TEXT', timestamptz: 'TEXT',
    json: 'TEXT', jsonb: 'TEXT', bytea: 'BLOB',
  }
  return map[type] || 'TEXT'
}

function mapTypeToPostgres(type: ColumnType): string {
  const map: Record<ColumnType, string> = {
    text: 'TEXT', integer: 'INTEGER', bigint: 'BIGINT', float: 'DOUBLE PRECISION',
    boolean: 'BOOLEAN', uuid: 'UUID', timestamp: 'TIMESTAMP', timestamptz: 'TIMESTAMPTZ',
    json: 'JSON', jsonb: 'JSONB', bytea: 'BYTEA',
  }
  return map[type] || 'TEXT'
}

function formatDefaultSqlite(val: string | number | boolean, type: ColumnType): string {
  if (val === 'now()') return "datetime('now')"
  if (val === 'gen_random_uuid()') return "gen_random_uuid()"
  if (typeof val === 'string') return `'${val}'`
  if (typeof val === 'boolean') return val ? '1' : '0'
  return String(val)
}

function formatDefaultPostgres(val: string | number | boolean, type: ColumnType): string {
  if (val === 'now()') return 'NOW()'
  if (val === 'gen_random_uuid()') return 'gen_random_uuid()'
  if (typeof val === 'string') return `'${val}'`
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE'
  return String(val)
}
