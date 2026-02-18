/**
 * Type Generation for VibeKit
 *
 * Generates TypeScript interfaces from database schema, similar to
 * Supabase typegen and Prisma generate. Produces Row, Insert, and Update
 * interfaces for each table, plus a unified Database type.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseAdapter } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ColumnInfo {
  name: string
  type: string
  nullable: boolean
  hasDefault: boolean
  isPrimaryKey: boolean
  defaultValue: string | null
}

export interface TableSchema {
  name: string
  columns: ColumnInfo[]
}

export interface TypeGenerator {
  generate(): Promise<string>
  generateForTable(tableName: string): Promise<string>
  generateSchema(): Promise<TableSchema[]>
  watch(outputPath: string, interval?: number): WatchHandle
  writeToFile(outputPath: string): Promise<void>
}

export interface WatchHandle {
  stop(): void
  isRunning(): boolean
}

// ---------------------------------------------------------------------------
// SQL Type Mapping
// ---------------------------------------------------------------------------

const SQLITE_TYPE_MAP: Record<string, string> = {
  TEXT: 'string',
  VARCHAR: 'string',
  CHAR: 'string',
  CLOB: 'string',
  NVARCHAR: 'string',
  NCHAR: 'string',
  INTEGER: 'number',
  INT: 'number',
  TINYINT: 'number',
  SMALLINT: 'number',
  MEDIUMINT: 'number',
  BIGINT: 'number',
  REAL: 'number',
  FLOAT: 'number',
  DOUBLE: 'number',
  'DOUBLE PRECISION': 'number',
  NUMERIC: 'number',
  DECIMAL: 'number',
  BOOLEAN: 'boolean',
  BLOB: 'Uint8Array',
  DATETIME: 'string',
  DATE: 'string',
  TIMESTAMP: 'string',
  TIMESTAMPTZ: 'string',
  JSON: 'unknown',
  JSONB: 'unknown',
}

const POSTGRES_TYPE_MAP: Record<string, string> = {
  text: 'string',
  varchar: 'string',
  'character varying': 'string',
  char: 'string',
  character: 'string',
  uuid: 'string',
  citext: 'string',
  name: 'string',
  integer: 'number',
  int: 'number',
  int2: 'number',
  int4: 'number',
  int8: 'number',
  smallint: 'number',
  bigint: 'number',
  serial: 'number',
  bigserial: 'number',
  smallserial: 'number',
  real: 'number',
  float4: 'number',
  float8: 'number',
  'double precision': 'number',
  numeric: 'number',
  decimal: 'number',
  money: 'number',
  boolean: 'boolean',
  bool: 'boolean',
  bytea: 'Uint8Array',
  json: 'unknown',
  jsonb: 'unknown',
  timestamp: 'string',
  'timestamp without time zone': 'string',
  'timestamp with time zone': 'string',
  timestamptz: 'string',
  date: 'string',
  time: 'string',
  'time without time zone': 'string',
  'time with time zone': 'string',
  timetz: 'string',
  interval: 'string',
  inet: 'string',
  cidr: 'string',
  macaddr: 'string',
  point: 'string',
  line: 'string',
  lseg: 'string',
  box: 'string',
  path: 'string',
  polygon: 'string',
  circle: 'string',
  xml: 'string',
  tsvector: 'string',
  tsquery: 'string',
  'ARRAY': 'unknown[]',
  'USER-DEFINED': 'string',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapSqlTypeToTs(sqlType: string, isPostgres: boolean): string {
  const normalized = sqlType.trim()

  // Check for array types (Postgres)
  if (normalized.endsWith('[]')) {
    const baseType = normalized.slice(0, -2)
    const mapped = mapSqlTypeToTs(baseType, isPostgres)
    return `${mapped}[]`
  }

  // Check for array type indicator
  if (normalized === 'ARRAY') {
    return 'unknown[]'
  }

  if (isPostgres) {
    const lower = normalized.toLowerCase()
    if (POSTGRES_TYPE_MAP[lower]) return POSTGRES_TYPE_MAP[lower]

    // Handle parameterized types like varchar(255), numeric(10,2)
    const baseMatch = lower.match(/^(\w+)(\(.+\))?$/)
    if (baseMatch && POSTGRES_TYPE_MAP[baseMatch[1]]) {
      return POSTGRES_TYPE_MAP[baseMatch[1]]
    }

    return 'unknown'
  }

  // SQLite
  const upper = normalized.toUpperCase()
  if (SQLITE_TYPE_MAP[upper]) return SQLITE_TYPE_MAP[upper]

  // Handle parameterized types like VARCHAR(255)
  const baseMatch = upper.match(/^(\w+)(\(.+\))?$/)
  if (baseMatch && SQLITE_TYPE_MAP[baseMatch[1]]) {
    return SQLITE_TYPE_MAP[baseMatch[1]]
  }

  // SQLite type affinity rules
  if (upper.includes('INT')) return 'number'
  if (upper.includes('CHAR') || upper.includes('TEXT') || upper.includes('CLOB')) return 'string'
  if (upper.includes('BLOB')) return 'Uint8Array'
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'number'
  if (upper.includes('BOOL')) return 'boolean'

  return 'unknown'
}

function toPascalCase(str: string): string {
  return str
    .split(/[_\-\s]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}

function hasAutoDefault(defaultValue: string | null, columnName: string): boolean {
  if (!defaultValue) return false
  const lower = defaultValue.toLowerCase()
  return (
    lower.includes('datetime') ||
    lower.includes('now()') ||
    lower.includes('current_timestamp') ||
    lower.includes('gen_random_uuid') ||
    lower.includes('uuid_generate') ||
    lower.includes('nextval') ||
    lower.includes('autoincrement') ||
    columnName === 'id' ||
    columnName === 'created_at' ||
    columnName === 'updated_at'
  )
}

// ---------------------------------------------------------------------------
// Schema introspection
// ---------------------------------------------------------------------------

async function introspectSqliteTables(adapter: DatabaseAdapter): Promise<string[]> {
  const { rows } = await adapter.query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_vibekit_%' AND name NOT LIKE '_fts_%' ORDER BY name"
  )
  return rows.map(r => r.name)
}

async function introspectSqliteColumns(adapter: DatabaseAdapter, table: string): Promise<ColumnInfo[]> {
  const { rows } = await adapter.query<{
    cid: number
    name: string
    type: string
    notnull: number
    dflt_value: string | null
    pk: number
  }>(`PRAGMA table_info("${table}")`)

  return rows.map(row => ({
    name: row.name,
    type: row.type || 'TEXT',
    nullable: row.notnull === 0 && row.pk === 0,
    hasDefault: row.dflt_value !== null || row.pk === 1,
    isPrimaryKey: row.pk === 1,
    defaultValue: row.dflt_value,
  }))
}

async function introspectPostgresTables(adapter: DatabaseAdapter): Promise<string[]> {
  const { rows } = await adapter.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_vibekit_%' ORDER BY tablename"
  )
  return rows.map(r => r.tablename)
}

async function introspectPostgresColumns(adapter: DatabaseAdapter, table: string): Promise<ColumnInfo[]> {
  const { rows } = await adapter.query<{
    column_name: string
    data_type: string
    udt_name: string
    is_nullable: string
    column_default: string | null
  }>(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  )

  // Get primary key columns
  const { rows: pkRows } = await adapter.query<{ column_name: string }>(
    `SELECT a.attname AS column_name
     FROM pg_index i
     JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
     WHERE i.indrelid = $1::regclass AND i.indisprimary`,
    [table]
  )
  const pkSet = new Set(pkRows.map(r => r.column_name))

  return rows.map(row => {
    // Use udt_name for better type resolution (e.g., int4 instead of integer)
    const effectiveType = row.data_type === 'ARRAY'
      ? `${row.udt_name.replace(/^_/, '')}[]`
      : row.data_type === 'USER-DEFINED'
        ? row.udt_name
        : row.data_type

    return {
      name: row.column_name,
      type: effectiveType,
      nullable: row.is_nullable === 'YES',
      hasDefault: row.column_default !== null || pkSet.has(row.column_name),
      isPrimaryKey: pkSet.has(row.column_name),
      defaultValue: row.column_default,
    }
  })
}

// ---------------------------------------------------------------------------
// Code generation
// ---------------------------------------------------------------------------

function generateTableTypes(table: string, columns: ColumnInfo[], isPostgres: boolean): string {
  const pascalName = toPascalCase(table)
  const lines: string[] = []

  // Row type (all columns, nullable ones are T | null)
  lines.push(`export interface ${pascalName}Row {`)
  for (const col of columns) {
    const tsType = mapSqlTypeToTs(col.type, isPostgres)
    const nullSuffix = col.nullable ? ' | null' : ''
    lines.push(`  ${col.name}: ${tsType}${nullSuffix}`)
  }
  lines.push('}')
  lines.push('')

  // Insert type (columns with defaults are optional, nullable are optional with null)
  lines.push(`export interface ${pascalName}Insert {`)
  for (const col of columns) {
    const tsType = mapSqlTypeToTs(col.type, isPostgres)
    const isOptional = col.hasDefault || hasAutoDefault(col.defaultValue, col.name)
    const nullSuffix = col.nullable ? ' | null' : ''
    const optionalMark = isOptional ? '?' : ''
    lines.push(`  ${col.name}${optionalMark}: ${tsType}${nullSuffix}`)
  }
  lines.push('}')
  lines.push('')

  // Update type (all columns are optional)
  lines.push(`export interface ${pascalName}Update {`)
  for (const col of columns) {
    const tsType = mapSqlTypeToTs(col.type, isPostgres)
    const nullSuffix = col.nullable ? ' | null' : ''
    lines.push(`  ${col.name}?: ${tsType}${nullSuffix}`)
  }
  lines.push('}')

  return lines.join('\n')
}

function generateDatabaseType(tables: Array<{ name: string; columns: ColumnInfo[] }>): string {
  const lines: string[] = []
  lines.push('export type Database = {')
  for (const table of tables) {
    const pascalName = toPascalCase(table.name)
    lines.push(`  ${table.name}: {`)
    lines.push(`    Row: ${pascalName}Row`)
    lines.push(`    Insert: ${pascalName}Insert`)
    lines.push(`    Update: ${pascalName}Update`)
    lines.push('  }')
  }
  lines.push('}')
  return lines.join('\n')
}

function generateFileHeader(): string {
  return `/**
 * Auto-generated by VibeKit Type Generator
 * Generated at: ${new Date().toISOString()}
 *
 * DO NOT EDIT THIS FILE MANUALLY.
 * Run \`vibekit typegen\` or call typeGenerator.writeToFile() to regenerate.
 */

/* eslint-disable */
/* tslint:disable */
`
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createTypeGenerator(adapter: DatabaseAdapter): TypeGenerator {
  function isPostgres(): boolean {
    return adapter.getInfo().mode !== 'local'
  }

  async function getTablesAndColumns(): Promise<Array<{ name: string; columns: ColumnInfo[] }>> {
    const tables = isPostgres()
      ? await introspectPostgresTables(adapter)
      : await introspectSqliteTables(adapter)

    const result: Array<{ name: string; columns: ColumnInfo[] }> = []

    for (const table of tables) {
      const columns = isPostgres()
        ? await introspectPostgresColumns(adapter, table)
        : await introspectSqliteColumns(adapter, table)
      result.push({ name: table, columns })
    }

    return result
  }

  const generator: TypeGenerator = {
    async generate(): Promise<string> {
      const tables = await getTablesAndColumns()
      const sections: string[] = [generateFileHeader()]

      for (const table of tables) {
        sections.push(generateTableTypes(table.name, table.columns, isPostgres()))
        sections.push('')
      }

      sections.push(generateDatabaseType(tables))
      sections.push('')

      return sections.join('\n')
    },

    async generateForTable(tableName: string): Promise<string> {
      const columns = isPostgres()
        ? await introspectPostgresColumns(adapter, tableName)
        : await introspectSqliteColumns(adapter, tableName)

      if (columns.length === 0) {
        throw new Error(`Table "${tableName}" not found or has no columns`)
      }

      return generateTableTypes(tableName, columns, isPostgres())
    },

    async generateSchema(): Promise<TableSchema[]> {
      const tables = await getTablesAndColumns()
      return tables.map(t => ({
        name: t.name,
        columns: t.columns,
      }))
    },

    watch(outputPath: string, interval?: number): WatchHandle {
      const checkInterval = interval ?? 5_000
      let running = true
      let lastContent = ''
      let timer: ReturnType<typeof setInterval> | null = null

      const check = async () => {
        if (!running) return
        try {
          const content = await generator.generate()
          if (content !== lastContent) {
            lastContent = content
            const dir = path.dirname(outputPath)
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true })
            }
            fs.writeFileSync(outputPath, content, 'utf-8')
            console.log(`[vibekit:typegen] Types updated: ${outputPath}`)
          }
        } catch (err) {
          console.error(`[vibekit:typegen] Watch error: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // Initial generation
      check().catch(() => {})

      timer = setInterval(check, checkInterval)

      const handle: WatchHandle = {
        stop(): void {
          running = false
          if (timer) {
            clearInterval(timer)
            timer = null
          }
          console.log('[vibekit:typegen] Watcher stopped')
        },
        isRunning(): boolean {
          return running
        },
      }

      return handle
    },

    async writeToFile(outputPath: string): Promise<void> {
      const content = await generator.generate()
      const dir = path.dirname(outputPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(outputPath, content, 'utf-8')
      console.log(`[vibekit:typegen] Types written to: ${outputPath}`)
    },
  }

  return generator
}
