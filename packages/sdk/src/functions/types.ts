/**
 * VibeKit Edge Functions / Serverless Runtime — Type Definitions
 */

// ── Request / Response / Context ──────────────────────────────────────────

export interface FunctionRequest {
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
  params: Record<string, string>
  query: Record<string, string>
}

export interface FunctionResponse {
  status: number
  headers: Record<string, string>
  body: unknown
}

export interface FunctionContext {
  env: Record<string, string>
  secrets: Record<string, string>
  waitUntil: (promise: Promise<unknown>) => void
  db: FunctionDbProxy | null
  auth: FunctionAuthProxy | null
  storage: FunctionStorageProxy | null
  functionName: string
  invocationId: string
  region: string
}

export interface FunctionDbProxy {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>
  execute: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }>
}

export interface FunctionAuthProxy {
  verifyToken: (token: string) => Promise<{ valid: boolean; userId?: string; claims?: Record<string, unknown> }>
}

export interface FunctionStorageProxy {
  getUrl: (path: string) => string
}

// ── Handler & Middleware ──────────────────────────────────────────────────

export type FunctionHandler = (
  req: FunctionRequest,
  ctx: FunctionContext,
) => Promise<FunctionResponse>

export type FunctionMiddleware = (
  req: FunctionRequest,
  ctx: FunctionContext,
  next: () => Promise<FunctionResponse>,
) => Promise<FunctionResponse>

// ── Options ──────────────────────────────────────────────────────────────

export interface CorsConfig {
  origins: string[]
  methods?: string[]
  headers?: string[]
  credentials?: boolean
  maxAge?: number
}

export interface RateLimitConfig {
  maxRequests: number
  windowMs: number
}

export interface FunctionOptions {
  timeout?: number
  memory?: number
  region?: string
  cors?: CorsConfig
  auth?: boolean
  rateLimit?: RateLimitConfig
  middleware?: FunctionMiddleware[]
}

// ── Registration & Metrics ───────────────────────────────────────────────

export interface RegisteredFunction {
  name: string
  handler: FunctionHandler
  options: FunctionOptions
  middleware: FunctionMiddleware[]
  createdAt: string
}

export interface FunctionInvocationLog {
  id: string
  functionName: string
  invocationId: string
  method: string
  url: string
  status: number
  durationMs: number
  error: string | null
  timestamp: string
}

export interface FunctionMetrics {
  functionName: string
  totalInvocations: number
  successCount: number
  errorCount: number
  avgLatencyMs: number
  minLatencyMs: number
  maxLatencyMs: number
  p95LatencyMs: number
  lastInvokedAt: string | null
}

export interface FunctionSchedule {
  functionName: string
  cron: string
  lastRun: string | null
  nextRun: string | null
  enabled: boolean
  timerId: ReturnType<typeof setInterval> | null
}

// ── Runtime Config ───────────────────────────────────────────────────────

export interface FunctionRuntimeConfig {
  defaultTimeout?: number
  defaultMemory?: number
  defaultRegion?: string
  maxLogBuffer?: number
  env?: Record<string, string>
  db?: FunctionDbProxy | null
  auth?: FunctionAuthProxy | null
  storage?: FunctionStorageProxy | null
}

// ── Runtime Interface ────────────────────────────────────────────────────

export interface FunctionRuntime {
  register: (name: string, handler: FunctionHandler, options?: FunctionOptions) => void
  invoke: (name: string, payload?: unknown, context?: Partial<FunctionContext>) => Promise<FunctionResponse>
  invokeHttp: (name: string, request: Partial<FunctionRequest>) => Promise<FunctionResponse>
  list: () => RegisteredFunction[]
  remove: (name: string) => void
  getMetrics: (name?: string) => FunctionMetrics | FunctionMetrics[]
  setSecret: (key: string, value: string) => void
  getSecrets: () => string[]
  schedule: (name: string, cron: string) => void
  unschedule: (name: string) => void
  logs: (name?: string, limit?: number) => FunctionInvocationLog[]
  shutdown: () => void
}
