// ──────────────────────────────────────────────────────────────────────────────
// VibeKit — Advanced Structured Logger
// ──────────────────────────────────────────────────────────────────────────────

import { isLocal } from '../config/index.js'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogFormat = 'pretty' | 'json'

export interface LogEntry {
  level: LogLevel
  module: string
  message: string
  timestamp: string
  data?: Record<string, unknown>
}

export interface TimerResult {
  /** Call to stop the timer and log the elapsed duration. Returns the
   *  elapsed time in milliseconds. */
  end: (message?: string, data?: Record<string, unknown>) => number
}

export interface RequestLogData {
  method: string
  path: string
  statusCode?: number
  durationMs?: number
  requestId?: string
}

export interface QueryLogData {
  query: string
  params?: unknown[]
  durationMs: number
  rowCount?: number
}

/**
 * The full logger interface returned by `createLogger()`. Child loggers share
 * the same interface with extra inherited context fields.
 */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void
  info(message: string, data?: Record<string, unknown>): void
  warn(message: string, data?: Record<string, unknown>): void
  error(message: string, data?: Record<string, unknown>): void

  /** Create a child logger that inherits the parent module name and merges
   *  additional context into every log entry. */
  child(context: Record<string, unknown>): Logger

  /** Start a timer. Call `.end()` on the returned handle to log the elapsed
   *  duration at the specified level (default `info`). */
  timer(label?: string, level?: LogLevel): TimerResult

  /** Log an inbound HTTP request (call once when the response is sent). */
  logRequest(data: RequestLogData): void

  /** Log a SQL query execution (respects the current log level). */
  logQuery(data: QueryLogData): void

  /** The module name this logger was created with. */
  readonly module: string
}

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const DEFAULT_BUFFER_SIZE = 100
const DEFAULT_SLOW_QUERY_THRESHOLD_MS = 200

function getMinLevel(): LogLevel {
  const env = (process.env.VIBEKIT_LOG_LEVEL ?? '').toLowerCase()
  if (env === 'debug' || env === 'info' || env === 'warn' || env === 'error') {
    return env
  }
  return isLocal() ? 'debug' : 'info'
}

function getLogFormat(): LogFormat {
  const env = (process.env.VIBEKIT_LOG_FORMAT ?? '').toLowerCase()
  if (env === 'json') return 'json'
  if (env === 'pretty') return 'pretty'
  return isLocal() ? 'pretty' : 'json'
}

function getSlowQueryThreshold(): number {
  const env = process.env.VIBEKIT_SLOW_QUERY_MS
  if (env) {
    const parsed = Number(env)
    if (!Number.isNaN(parsed) && parsed > 0) return parsed
  }
  return DEFAULT_SLOW_QUERY_THRESHOLD_MS
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[getMinLevel()]
}

// ──────────────────────────────────────────────────────────────────────────────
// ANSI helpers (only used in pretty mode)
// ──────────────────────────────────────────────────────────────────────────────

const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: ansi.gray,
  info: ansi.cyan,
  warn: ansi.yellow,
  error: ansi.red,
}

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '\u2022',  // •
  info: '\u2714',   // ✔
  warn: '\u26A0',   // ⚠
  error: '\u2718',  // ✘
}

// ──────────────────────────────────────────────────────────────────────────────
// Log buffer (ring buffer for the dev-tools dashboard)
// ──────────────────────────────────────────────────────────────────────────────

let bufferMaxSize = DEFAULT_BUFFER_SIZE
const logBuffer: LogEntry[] = []

function pushToBuffer(entry: LogEntry): void {
  logBuffer.push(entry)
  if (logBuffer.length > bufferMaxSize) {
    logBuffer.shift()
  }
}

/**
 * Retrieve the most recent log entries stored in the in-memory ring buffer.
 *
 * @param count  Maximum entries to return (default: all buffered entries).
 */
export function getRecentLogs(count?: number): readonly LogEntry[] {
  if (count === undefined || count >= logBuffer.length) {
    return [...logBuffer]
  }
  return logBuffer.slice(-count)
}

/**
 * Change the maximum number of entries the ring buffer retains.
 * Existing entries beyond the new limit are dropped (oldest first).
 */
export function setLogBufferSize(size: number): void {
  bufferMaxSize = Math.max(1, Math.floor(size))
  while (logBuffer.length > bufferMaxSize) {
    logBuffer.shift()
  }
}

/**
 * Clear all entries in the log buffer. Primarily useful in tests.
 */
export function clearLogBuffer(): void {
  logBuffer.length = 0
}

// ──────────────────────────────────────────────────────────────────────────────
// Formatting
// ──────────────────────────────────────────────────────────────────────────────

function formatPretty(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level]
  const icon = LEVEL_ICONS[entry.level]
  const tag = entry.level.toUpperCase().padEnd(5)
  const ts = entry.timestamp.slice(11, 23) // HH:mm:ss.SSS
  const mod = `${ansi.magenta}${entry.module}${ansi.reset}`

  let line = `${ansi.dim}${ts}${ansi.reset} ${color}${icon} ${tag}${ansi.reset} ${mod} ${entry.message}`

  if (entry.data && Object.keys(entry.data).length > 0) {
    const pairs = Object.entries(entry.data)
      .map(([k, v]) => `${ansi.dim}${k}=${ansi.reset}${formatValue(v)}`)
      .join(' ')
    line += ` ${pairs}`
  }

  return line
}

function formatJson(entry: LogEntry): string {
  const obj: Record<string, unknown> = {
    level: entry.level,
    module: entry.module,
    msg: entry.message,
    ts: entry.timestamp,
  }
  if (entry.data && Object.keys(entry.data).length > 0) {
    Object.assign(obj, entry.data)
  }
  return JSON.stringify(obj)
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v)
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

// ──────────────────────────────────────────────────────────────────────────────
// Core write function
// ──────────────────────────────────────────────────────────────────────────────

const WRITER: Record<LogLevel, (msg: string) => void> = {
  debug: (msg) => console.debug(msg),
  info: (msg) => console.info(msg),
  warn: (msg) => console.warn(msg),
  error: (msg) => console.error(msg),
}

function writeEntry(entry: LogEntry): void {
  // Always buffer regardless of level filtering so the dev dashboard has data.
  pushToBuffer(entry)

  if (!shouldLog(entry.level)) return

  const fmt = getLogFormat()
  const formatted = fmt === 'json' ? formatJson(entry) : formatPretty(entry)
  WRITER[entry.level](formatted)
}

// ──────────────────────────────────────────────────────────────────────────────
// Logger implementation
// ──────────────────────────────────────────────────────────────────────────────

function buildLogger(
  module: string,
  parentContext: Record<string, unknown> = {},
): Logger {
  function makeEntry(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): LogEntry {
    const merged =
      Object.keys(parentContext).length > 0 || (data && Object.keys(data).length > 0)
        ? { ...parentContext, ...data }
        : data

    return {
      level,
      module,
      message,
      timestamp: new Date().toISOString(),
      ...(merged && Object.keys(merged).length > 0 ? { data: merged } : {}),
    }
  }

  function log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    writeEntry(makeEntry(level, message, data))
  }

  const logger: Logger = {
    module,

    debug(message, data) {
      log('debug', message, data)
    },
    info(message, data) {
      log('info', message, data)
    },
    warn(message, data) {
      log('warn', message, data)
    },
    error(message, data) {
      log('error', message, data)
    },

    child(context: Record<string, unknown>): Logger {
      return buildLogger(module, { ...parentContext, ...context })
    },

    timer(label?: string, level: LogLevel = 'info'): TimerResult {
      const start = performance.now()
      const timerLabel = label ?? 'operation'
      return {
        end(message?: string, data?: Record<string, unknown>): number {
          const durationMs =
            Math.round((performance.now() - start) * 100) / 100
          const msg = message ?? `${timerLabel} completed`
          log(level, msg, { ...data, durationMs, timer: timerLabel })
          return durationMs
        },
      }
    },

    logRequest(reqData: RequestLogData): void {
      const { method, path, statusCode, durationMs, requestId } = reqData

      const status = statusCode ?? 0
      let level: LogLevel = 'info'
      if (status >= 500) level = 'error'
      else if (status >= 400) level = 'warn'

      const statusStr = statusCode !== undefined ? ` ${statusCode}` : ''
      const durationStr = durationMs !== undefined ? ` ${durationMs}ms` : ''
      const msg = `${method} ${path}${statusStr}${durationStr}`

      const data: Record<string, unknown> = { method, path }
      if (statusCode !== undefined) data.statusCode = statusCode
      if (durationMs !== undefined) data.durationMs = durationMs
      if (requestId) data.requestId = requestId

      log(level, msg, data)
    },

    logQuery(queryData: QueryLogData): void {
      const { query, params, durationMs, rowCount } = queryData
      const threshold = getSlowQueryThreshold()
      const isSlow = durationMs > threshold

      const data: Record<string, unknown> = { durationMs }
      if (params !== undefined && params.length > 0) data.params = params
      if (rowCount !== undefined) data.rowCount = rowCount

      // Truncate very long query strings for readability.
      const shortQuery =
        query.length > 200 ? `${query.slice(0, 197)}...` : query

      if (isSlow) {
        log('warn', `Slow query (${durationMs}ms > ${threshold}ms): ${shortQuery}`, {
          ...data,
          slowQueryThresholdMs: threshold,
          query,
        })
      } else {
        log('debug', `Query (${durationMs}ms): ${shortQuery}`, {
          ...data,
          query,
        })
      }
    },
  }

  return logger
}

// ──────────────────────────────────────────────────────────────────────────────
// Public factory
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create a logger scoped to a module name.
 *
 * ```ts
 * const log = createLogger('auth')
 * log.info('User signed in', { userId: '123' })
 *
 * const reqLog = log.child({ requestId: 'abc-def' })
 * reqLog.info('Processing request')  // requestId auto-attached
 * ```
 */
export function createLogger(module: string): Logger {
  return buildLogger(module)
}

// ──────────────────────────────────────────────────────────────────────────────
// Request logging middleware (framework-agnostic)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Generic request / response shape that works with Express, Koa, Hono,
 * and similar frameworks without coupling to any specific one.
 */
export interface GenericRequest {
  method: string
  url?: string
  path?: string
  headers?: Record<string, string | string[] | undefined>
}

export interface GenericResponse {
  statusCode?: number
  status?: number
  on?(event: string, listener: () => void): void
}

/**
 * Returns a middleware-style function that logs every request.
 *
 * Usage with Express:
 * ```ts
 * app.use(requestLogger())
 * ```
 *
 * The middleware calls `next()` and hooks into the response `finish` event to
 * capture the final status code and duration.
 */
export function requestLogger(
  overrideModule = 'http',
): (req: GenericRequest, res: GenericResponse, next: () => void) => void {
  const log = createLogger(overrideModule)

  return (req, res, next) => {
    const start = performance.now()
    const path = req.path ?? req.url ?? '/'
    const method = req.method
    const requestId =
      (req.headers?.['x-request-id'] as string | undefined) ?? undefined

    const onFinish = (): void => {
      const durationMs =
        Math.round((performance.now() - start) * 100) / 100
      const statusCode =
        res.statusCode ??
        (typeof res.status === 'number' ? res.status : undefined)

      log.logRequest({
        method,
        path,
        statusCode,
        durationMs,
        requestId,
      })
    }

    // Hook into the response `finish` event if available (Express / Node http).
    if (typeof res.on === 'function') {
      res.on('finish', onFinish)
    } else {
      // Fallback: log immediately after next() returns (less accurate for
      // async handlers but better than nothing).
      const origNext = next
      next = () => {
        origNext()
        onFinish()
      }
    }

    next()
  }
}
