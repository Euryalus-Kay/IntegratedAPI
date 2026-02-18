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

// ===== Row Level Security (RLS) types =====

export type RLSOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

export interface RLSPolicy {
  name: string
  table: string
  operation: RLSOperation
  /** Check function serialized as string for storage; at runtime a real function is used. */
  checkFn: string
}

export interface RLSPolicyDefinition {
  name: string
  operation: RLSOperation
  /** Predicate: returns true if the row is accessible for the given user context. */
  check: (row: Record<string, unknown>, user: Record<string, unknown>) => boolean
}

export interface RLSManager {
  enable(table: string): Promise<void>
  disable(table: string): Promise<void>
  addPolicy(table: string, policy: RLSPolicyDefinition): Promise<void>
  removePolicy(table: string, policyName: string): Promise<void>
  listPolicies(table?: string): Promise<RLSPolicy[]>
  isEnabled(table: string): Promise<boolean>
  /** @internal Check a row against all applicable policies. */
  checkRow(table: string, operation: RLSOperation, row: Record<string, unknown>, user: Record<string, unknown>): boolean
}

// ===== Trigger types =====

export type TriggerTiming = 'BEFORE' | 'AFTER'
export type TriggerEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export interface TriggerDefinition {
  name: string
  table: string
  timing: TriggerTiming
  event: TriggerEvent
  fn: (oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null) => void | Promise<void>
}

export interface TriggerConfig {
  name: string
  table: string
  timing: TriggerTiming
  event: TriggerEvent
  createdAt: string
}

export interface TriggerManager {
  create(definition: TriggerDefinition): Promise<void>
  remove(name: string): Promise<void>
  list(table?: string): Promise<TriggerConfig[]>
  /** @internal Fire matching triggers. */
  fire(table: string, timing: TriggerTiming, event: TriggerEvent, oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null): Promise<void>
}

// ===== Database Functions types =====

export type DbFunction = (...args: unknown[]) => unknown

export interface DbFunctionEntry {
  name: string
  fn: DbFunction
}

export interface DbFunctionManager {
  create(name: string, fn: DbFunction): void
  remove(name: string): void
  list(): string[]
  call(name: string, ...args: unknown[]): unknown
}

// ===== Full-Text Search types =====

export interface FTSIndexOptions {
  /** FTS tokenizer: 'unicode61' (default), 'porter', 'ascii'. */
  tokenizer?: string
  /** Prefix length for prefix queries. */
  prefix?: string
  /** Content table for external content FTS. */
  contentTable?: string
}

export interface FTSSearchOptions {
  /** Maximum number of results. */
  limit?: number
  /** Offset for pagination. */
  offset?: number
  /** Whether to include highlighted snippets. */
  highlight?: boolean
  /** Tags for highlight start/end. */
  highlightTags?: [string, string]
  /** Whether to include snippet. */
  snippet?: boolean
  /** Snippet column index (0-based). */
  snippetColumn?: number
  /** Maximum snippet tokens. */
  snippetTokens?: number
  /** Order by rank (default true). */
  orderByRank?: boolean
}

export interface FTSResult<T = Record<string, unknown>> {
  rows: T[]
  rowCount: number
}

export interface SearchManager {
  createIndex(table: string, columns: string[], options?: FTSIndexOptions): Promise<void>
  search<T = Record<string, unknown>>(table: string, query: string, options?: FTSSearchOptions): Promise<FTSResult<T>>
  dropIndex(table: string): Promise<void>
  rebuild(table: string): Promise<void>
}

// ===== Vector / Embeddings types =====

export interface VectorEntry {
  id: string
  vector: number[]
  metadata?: Record<string, unknown>
}

export interface VectorSearchOptions {
  limit?: number
  filter?: Record<string, unknown>
  minScore?: number
}

export interface VectorSearchResult {
  id: string
  score: number
  vector: number[]
  metadata: Record<string, unknown>
}

export interface VectorManager {
  createCollection(name: string, dimensions: number): Promise<void>
  insert(collection: string, entry: VectorEntry): Promise<void>
  insertBatch(collection: string, entries: VectorEntry[]): Promise<void>
  search(collection: string, queryVector: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]>
  delete(collection: string, id: string): Promise<void>
  get(collection: string, id: string): Promise<VectorEntry | null>
  count(collection: string): Promise<number>
  dropCollection(collection: string): Promise<void>
  listCollections(): Promise<Array<{ name: string; dimensions: number; count: number }>>
}

// ===== Cron Job types =====

export interface CronJobConfig {
  name: string
  expression: string
  enabled: boolean
  lastRun: string | null
  nextRun: string | null
  createdAt: string
}

export interface CronHistoryEntry {
  id: number
  jobName: string
  startedAt: string
  finishedAt: string
  durationMs: number
  status: 'success' | 'error'
  error?: string
}

export interface CronManager {
  schedule(name: string, cronExpression: string, fn: () => void | Promise<void>): Promise<void>
  unschedule(name: string): Promise<void>
  list(): Promise<CronJobConfig[]>
  getHistory(name: string, limit?: number): Promise<CronHistoryEntry[]>
  /** Trigger a job immediately regardless of schedule. */
  trigger(name: string): Promise<void>
  /** Stop all running timers (for graceful shutdown). */
  stopAll(): void
}

// ===== Message Queue types =====

export interface QueueOptions {
  /** Visibility timeout in seconds (default: 30). */
  visibilityTimeout?: number
  /** Maximum retries before dead-letter (default: 3). */
  maxRetries?: number
  /** Delay in seconds before message becomes visible (default: 0). */
  deliveryDelay?: number
}

export type QueueMessageStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'archived' | 'dead_letter'

export interface QueueMessage<T = unknown> {
  id: string
  queue: string
  body: T
  status: QueueMessageStatus
  retryCount: number
  createdAt: string
  visibleAt: string
  processedAt?: string
}

export interface QueueReadOptions {
  /** Number of messages to read (default: 1). */
  batchSize?: number
  /** Visibility timeout override for this read (seconds). */
  visibilityTimeout?: number
}

export interface QueueMetrics {
  queue: string
  pending: number
  processing: number
  completed: number
  failed: number
  deadLetter: number
  archived: number
  total: number
  oldestMessage?: string
  newestMessage?: string
}

export interface QueueManager {
  create(name: string, options?: QueueOptions): Promise<void>
  send<T = unknown>(queue: string, message: T): Promise<string>
  sendBatch<T = unknown>(queue: string, messages: T[]): Promise<string[]>
  read<T = unknown>(queue: string, options?: QueueReadOptions): Promise<QueueMessage<T>[]>
  delete(queue: string, messageId: string): Promise<void>
  complete(queue: string, messageId: string): Promise<void>
  fail(queue: string, messageId: string, error?: string): Promise<void>
  archive(queue: string, messageId: string): Promise<void>
  purge(queue: string): Promise<void>
  metrics(queue: string): Promise<QueueMetrics>
  listQueues(): Promise<Array<{ name: string; options: QueueOptions; createdAt: string }>>
  drop(queue: string): Promise<void>
}

// ===== Webhook types =====

export interface WebhookDefinition {
  url: string
  events: string[]
  secret?: string
  headers?: Record<string, string>
  enabled?: boolean
}

export interface WebhookConfig {
  id: string
  url: string
  events: string[]
  secret: string | null
  headers: Record<string, string>
  enabled: boolean
  createdAt: string
}

export interface WebhookDeliveryLog {
  id: string
  webhookId: string
  event: string
  url: string
  requestBody: string
  responseStatus: number | null
  responseBody: string | null
  success: boolean
  error: string | null
  deliveredAt: string
  durationMs: number
}

export interface WebhookManager {
  create(definition: WebhookDefinition): Promise<WebhookConfig>
  remove(id: string): Promise<void>
  update(id: string, updates: Partial<WebhookDefinition>): Promise<WebhookConfig>
  list(): Promise<WebhookConfig[]>
  get(id: string): Promise<WebhookConfig | null>
  test(id: string): Promise<WebhookDeliveryLog>
  getDeliveryLog(id: string, limit?: number): Promise<WebhookDeliveryLog[]>
  /** @internal Fire webhooks for a database event. */
  fire(event: string, payload: Record<string, unknown>): Promise<void>
}

// ===== Database Branching types =====

export interface BranchInfo {
  name: string
  createdAt: string
  sizeBytes: number
  isCurrent: boolean
}

export interface BranchManager {
  create(name: string): Promise<BranchInfo>
  switch(name: string): Promise<void>
  list(): Promise<BranchInfo[]>
  current(): string
  delete(name: string): Promise<void>
  merge(name: string, strategy?: 'overwrite' | 'schema-only'): Promise<void>
  diff(name: string): Promise<BranchDiff>
}

export interface BranchDiff {
  branch: string
  tablesAdded: string[]
  tablesRemoved: string[]
  tablesModified: string[]
}

// ===== Connection Pool types =====

export interface PoolConfig {
  maxConnections: number
  minConnections?: number
  acquireTimeoutMs?: number
  idleTimeoutMs?: number
}

export interface PoolStats {
  totalConnections: number
  activeConnections: number
  idleConnections: number
  waitingRequests: number
  maxConnections: number
}

export interface PoolHealthEntry {
  connectionId: number
  status: 'active' | 'idle' | 'unhealthy'
  createdAt: string
  lastUsedAt: string
  queryCount: number
}

export interface ConnectionPool {
  getStats(): PoolStats
  getHealth(): PoolHealthEntry[]
  resize(maxConnections: number): void
  drain(): Promise<void>
}

// ===== Enhanced Migration types =====

export interface MigrationStatus {
  applied: Array<{
    id: string
    name: string
    appliedAt: string
  }>
  pending: Array<{
    id: string
    name: string
  }>
  current: string | null
}

export interface EnhancedMigrator {
  /** Generate a migration by diffing the current schema against the database. */
  generate(name: string): Promise<Migration>
  /** Apply the next pending migration. */
  up(): Promise<Migration | null>
  /** Roll back the last applied migration. */
  down(): Promise<Migration | null>
  /** Show status of all migrations. */
  status(): Promise<MigrationStatus>
  /** Squash all applied migrations into a single migration. */
  squash(name?: string): Promise<Migration>
  /** Apply all pending migrations. */
  upAll(): Promise<Migration[]>
}
