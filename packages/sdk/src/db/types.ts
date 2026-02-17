export interface QueryResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
}

export interface ExecuteResult {
  rowCount: number
  lastInsertId?: string | number
}

export interface DatabaseAdapter {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>
  close(): Promise<void>
  getInfo(): { mode: string; database: string }
}

export interface TransactionClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>
}

export type ColumnType = 'text' | 'integer' | 'bigint' | 'float' | 'boolean' | 'uuid' | 'timestamp' | 'timestamptz' | 'json' | 'jsonb' | 'bytea'

export interface ColumnDefinition {
  type: ColumnType
  primaryKey?: boolean
  unique?: boolean
  notNull?: boolean
  default?: string | number | boolean
  references?: string
  onDelete?: 'cascade' | 'set null' | 'restrict' | 'no action'
  onUpdate?: 'cascade' | 'set null' | 'restrict' | 'no action'
  index?: boolean
}

export interface TableDefinition {
  columns: Record<string, ColumnDefinition>
  indexes?: IndexDefinition[]
  timestamps?: boolean
}

export interface IndexDefinition {
  name: string
  columns: string[]
  unique?: boolean
}

export type WhereOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'ILIKE' | 'IN' | 'NOT IN' | 'IS' | 'IS NOT'
export type OrderDirection = 'asc' | 'desc'

export interface WhereClause {
  column: string
  operator: WhereOperator
  value: unknown
}

export interface OrderClause {
  column: string
  direction: OrderDirection
}

export interface Migration {
  id: string
  name: string
  up: string
  down: string
  appliedAt?: Date
}

export interface MigrationState {
  applied: Migration[]
  pending: Migration[]
}
