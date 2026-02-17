// ===== Existing types =====

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

export type WhereOperator = '=' | '!=' | '>' | '>=' | '<' | '<=' | 'LIKE' | 'NOT LIKE' | 'ILIKE' | 'IN' | 'NOT IN' | 'IS' | 'IS NOT' | 'BETWEEN' | 'NOT BETWEEN'
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

// ===== New types =====

/**
 * A log entry capturing details about a query execution.
 */
export interface QueryLog {
  sql: string
  params: unknown[]
  durationMs: number
  rowCount: number
  timestamp: string
  slow: boolean
}

/**
 * Events that can be emitted by the database layer.
 */
export type DatabaseEvent = 'query' | 'slow-query' | 'error' | 'connect' | 'disconnect' | 'migration'

/**
 * Handler function for database events.
 * The payload shape depends on the event type.
 */
export type DatabaseEventHandler = (payload: unknown) => void

/**
 * Context provided to seed functions with helper methods for seeding data.
 */
export interface SeedContext {
  /** Insert a single row into a table and return it. */
  insert<T = Record<string, unknown>>(table: string, data: Record<string, unknown>): Promise<T | null>
  /** Insert multiple rows into a table. */
  insertMany(table: string, data: Record<string, unknown>[]): Promise<void>
  /** Delete all rows from a table (use with care). */
  truncate(table: string): Promise<void>
  /** Run arbitrary SQL. */
  execute(sql: string, params?: unknown[]): Promise<ExecuteResult>
  /** Query arbitrary SQL. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  /** Log a message during seeding. */
  log(message: string): void
}

/**
 * Options for paginated queries.
 */
export interface PaginationOptions {
  page: number
  limit: number
}

/**
 * Result of a paginated query, including metadata.
 */
export interface PaginatedResult<T> {
  rows: T[]
  total: number
  page: number
  limit: number
  totalPages: number
  hasNext: boolean
  hasPrev: boolean
}

/**
 * Health information about the database connection.
 */
export interface DatabaseHealth {
  status: 'healthy' | 'degraded' | 'down'
  latencyMs: number
  tableCount: number
  sizeBytes?: number
}
