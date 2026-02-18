/**
 * VibeKit Edge Functions / Serverless Runtime
 * Local function execution runtime with HTTP invocation, middleware,
 * CORS, rate limiting, scheduling, metrics, and secrets management.
 *
 * Replaces: Supabase Edge Functions, Vercel Functions, Cloudflare Workers
 */

import type {
  FunctionRequest,
  FunctionResponse,
  FunctionContext,
  FunctionHandler,
  FunctionMiddleware,
  FunctionOptions,
  RegisteredFunction,
  FunctionInvocationLog,
  FunctionMetrics,
  FunctionSchedule,
  FunctionRuntimeConfig,
  FunctionRuntime,
  CorsConfig,
  RateLimitConfig,
} from './types.js'

export type {
  FunctionRequest,
  FunctionResponse,
  FunctionContext,
  FunctionHandler,
  FunctionMiddleware,
  FunctionOptions,
  RegisteredFunction,
  FunctionInvocationLog,
  FunctionMetrics,
  FunctionSchedule,
  FunctionRuntimeConfig,
  FunctionRuntime,
  CorsConfig,
  RateLimitConfig,
}

// ── Helpers ──────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function parseUrl(raw: string): { pathname: string; query: Record<string, string> } {
  try {
    const url = new URL(raw, 'http://localhost')
    const query: Record<string, string> = {}
    url.searchParams.forEach((v, k) => { query[k] = v })
    return { pathname: url.pathname, query }
  } catch {
    return { pathname: raw, query: {} }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

// ── Cron parsing (basic subset) ─────────────────────────────────────────

interface CronFields {
  minutes: number[]
  hours: number[]
  daysOfMonth: number[]
  months: number[]
  daysOfWeek: number[]
}

function expandField(field: string, min: number, max: number): number[] {
  const results: number[] = []
  const parts = field.split(',')
  for (const part of parts) {
    if (part === '*') {
      for (let i = min; i <= max; i++) results.push(i)
    } else if (part.includes('/')) {
      const [rangeStr, stepStr] = part.split('/')
      const step = parseInt(stepStr, 10)
      let start = min
      let end = max
      if (rangeStr !== '*') {
        if (rangeStr.includes('-')) {
          const [lo, hi] = rangeStr.split('-').map(Number)
          start = lo
          end = hi
        } else {
          start = parseInt(rangeStr, 10)
        }
      }
      for (let i = start; i <= end; i += step) results.push(i)
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number)
      for (let i = lo; i <= hi; i++) results.push(i)
    } else {
      results.push(parseInt(part, 10))
    }
  }
  return results
}

function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${expression}" — expected 5 fields`)
  }
  return {
    minutes: expandField(parts[0], 0, 59),
    hours: expandField(parts[1], 0, 23),
    daysOfMonth: expandField(parts[2], 1, 31),
    months: expandField(parts[3], 1, 12),
    daysOfWeek: expandField(parts[4], 0, 6),
  }
}

function getNextCronDate(fields: CronFields, after: Date): Date {
  const candidate = new Date(after.getTime())
  candidate.setSeconds(0, 0)
  candidate.setMinutes(candidate.getMinutes() + 1)

  for (let attempts = 0; attempts < 525960; attempts++) {
    if (
      fields.months.includes(candidate.getMonth() + 1) &&
      fields.daysOfMonth.includes(candidate.getDate()) &&
      fields.daysOfWeek.includes(candidate.getDay()) &&
      fields.hours.includes(candidate.getHours()) &&
      fields.minutes.includes(candidate.getMinutes())
    ) {
      return candidate
    }
    candidate.setMinutes(candidate.getMinutes() + 1)
  }
  return candidate
}

function msUntilNext(fields: CronFields): number {
  const now = new Date()
  const next = getNextCronDate(fields, now)
  return Math.max(next.getTime() - now.getTime(), 1000)
}

// ── Rate Limiter ─────────────────────────────────────────────────────────

interface RateLimitBucket {
  tokens: number
  lastRefill: number
}

class RateLimiter {
  private buckets: Map<string, RateLimitBucket> = new Map()

  check(key: string, config: RateLimitConfig): boolean {
    const now = Date.now()
    let bucket = this.buckets.get(key)

    if (!bucket) {
      bucket = { tokens: config.maxRequests - 1, lastRefill: now }
      this.buckets.set(key, bucket)
      return true
    }

    const elapsed = now - bucket.lastRefill
    if (elapsed >= config.windowMs) {
      bucket.tokens = config.maxRequests - 1
      bucket.lastRefill = now
      return true
    }

    if (bucket.tokens > 0) {
      bucket.tokens--
      return true
    }

    return false
  }
}

// ── CORS Handling ────────────────────────────────────────────────────────

function buildCorsHeaders(corsConfig: CorsConfig, requestOrigin?: string): Record<string, string> {
  const headers: Record<string, string> = {}

  const allowedOrigin = corsConfig.origins.includes('*')
    ? '*'
    : requestOrigin && corsConfig.origins.includes(requestOrigin)
      ? requestOrigin
      : ''

  if (allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin
  }

  if (corsConfig.methods && corsConfig.methods.length > 0) {
    headers['Access-Control-Allow-Methods'] = corsConfig.methods.join(', ')
  } else {
    headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
  }

  if (corsConfig.headers && corsConfig.headers.length > 0) {
    headers['Access-Control-Allow-Headers'] = corsConfig.headers.join(', ')
  } else {
    headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
  }

  if (corsConfig.credentials) {
    headers['Access-Control-Allow-Credentials'] = 'true'
  }

  if (corsConfig.maxAge !== undefined) {
    headers['Access-Control-Max-Age'] = String(corsConfig.maxAge)
  }

  return headers
}

// ── Main Runtime Factory ─────────────────────────────────────────────────

export function createFunctionRuntime(config: FunctionRuntimeConfig = {}): FunctionRuntime {
  const functions: Map<string, RegisteredFunction> = new Map()
  const secrets: Map<string, string> = new Map()
  const logs: FunctionInvocationLog[] = []
  const schedules: Map<string, FunctionSchedule> = new Map()
  const rateLimiter = new RateLimiter()
  const backgroundPromises: Promise<unknown>[] = []

  const defaultTimeout = config.defaultTimeout ?? 30000
  const defaultRegion = config.defaultRegion ?? 'auto'
  const maxLogBuffer = config.maxLogBuffer ?? 10000
  const envVars: Record<string, string> = { ...(config.env ?? {}) }

  // ── Build context for an invocation ────────────────────────────────

  function buildContext(
    fnName: string,
    overrides?: Partial<FunctionContext>,
  ): FunctionContext {
    const invocationId = generateId()
    const resolvedSecrets: Record<string, string> = {}
    for (const [k, v] of secrets) {
      resolvedSecrets[k] = v
    }

    return {
      env: { ...envVars },
      secrets: resolvedSecrets,
      waitUntil: (promise: Promise<unknown>) => {
        backgroundPromises.push(promise)
      },
      db: config.db ?? null,
      auth: config.auth ?? null,
      storage: config.storage ?? null,
      functionName: fnName,
      invocationId,
      region: defaultRegion,
      ...overrides,
    }
  }

  // ── Build default request ──────────────────────────────────────────

  function buildRequest(
    name: string,
    payload?: unknown,
    method?: string,
    partialReq?: Partial<FunctionRequest>,
  ): FunctionRequest {
    const base: FunctionRequest = {
      method: method ?? 'POST',
      url: partialReq?.url ?? `/${name}`,
      headers: partialReq?.headers ?? { 'content-type': 'application/json' },
      body: payload ?? partialReq?.body ?? null,
      params: partialReq?.params ?? {},
      query: partialReq?.query ?? {},
    }

    if (!base.query || Object.keys(base.query).length === 0) {
      const parsed = parseUrl(base.url)
      if (Object.keys(parsed.query).length > 0) {
        base.query = parsed.query
      }
    }

    return base
  }

  // ── Execute a handler with middleware chain ─────────────────────────

  async function executeWithMiddleware(
    fn: RegisteredFunction,
    req: FunctionRequest,
    ctx: FunctionContext,
  ): Promise<FunctionResponse> {
    const allMiddleware = [...fn.middleware, ...(fn.options.middleware ?? [])]

    let idx = 0

    const next = async (): Promise<FunctionResponse> => {
      if (idx < allMiddleware.length) {
        const mw = allMiddleware[idx]
        idx++
        return mw(req, ctx, next)
      }
      return fn.handler(req, ctx)
    }

    return next()
  }

  // ── Apply timeout ──────────────────────────────────────────────────

  async function withTimeout(
    promise: Promise<FunctionResponse>,
    timeoutMs: number,
    fnName: string,
  ): Promise<FunctionResponse> {
    return new Promise<FunctionResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Function "${fnName}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      promise
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  // ── Record a log entry ─────────────────────────────────────────────

  function recordLog(entry: FunctionInvocationLog): void {
    logs.push(entry)
    if (logs.length > maxLogBuffer) {
      logs.splice(0, logs.length - maxLogBuffer)
    }
  }

  // ── Core invocation logic ──────────────────────────────────────────

  async function coreInvoke(
    name: string,
    req: FunctionRequest,
    ctxOverrides?: Partial<FunctionContext>,
  ): Promise<FunctionResponse> {
    const fn = functions.get(name)
    if (!fn) {
      throw new Error(`Function "${name}" is not registered`)
    }

    const ctx = buildContext(name, ctxOverrides)
    const timeoutMs = fn.options.timeout ?? defaultTimeout
    const start = performance.now()
    let response: FunctionResponse

    // Rate limiting
    if (fn.options.rateLimit) {
      const rateLimitKey = `${name}:${req.headers['x-forwarded-for'] ?? 'anonymous'}`
      const allowed = rateLimiter.check(rateLimitKey, fn.options.rateLimit)
      if (!allowed) {
        const limitResponse: FunctionResponse = {
          status: 429,
          headers: { 'Retry-After': String(Math.ceil(fn.options.rateLimit.windowMs / 1000)) },
          body: { error: 'Too Many Requests' },
        }
        const durationMs = Math.round((performance.now() - start) * 100) / 100
        recordLog({
          id: generateId(),
          functionName: name,
          invocationId: ctx.invocationId,
          method: req.method,
          url: req.url,
          status: 429,
          durationMs,
          error: 'Rate limit exceeded',
          timestamp: new Date().toISOString(),
        })
        return limitResponse
      }
    }

    // CORS preflight
    if (req.method === 'OPTIONS' && fn.options.cors) {
      const corsHeaders = buildCorsHeaders(fn.options.cors, req.headers['origin'])
      return {
        status: 204,
        headers: corsHeaders,
        body: null,
      }
    }

    try {
      response = await withTimeout(
        executeWithMiddleware(fn, req, ctx),
        timeoutMs,
        name,
      )

      // Attach CORS headers to response
      if (fn.options.cors) {
        const corsHeaders = buildCorsHeaders(fn.options.cors, req.headers['origin'])
        response.headers = { ...corsHeaders, ...response.headers }
      }

      const durationMs = Math.round((performance.now() - start) * 100) / 100
      recordLog({
        id: generateId(),
        functionName: name,
        invocationId: ctx.invocationId,
        method: req.method,
        url: req.url,
        status: response.status,
        durationMs,
        error: null,
        timestamp: new Date().toISOString(),
      })

      return response
    } catch (err) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100
      const errorMessage = err instanceof Error ? err.message : String(err)
      recordLog({
        id: generateId(),
        functionName: name,
        invocationId: ctx.invocationId,
        method: req.method,
        url: req.url,
        status: 500,
        durationMs,
        error: errorMessage,
        timestamp: new Date().toISOString(),
      })

      const errorResponse: FunctionResponse = {
        status: 500,
        headers: { 'content-type': 'application/json' },
        body: { error: errorMessage },
      }

      if (fn.options.cors) {
        const corsHeaders = buildCorsHeaders(fn.options.cors, req.headers['origin'])
        errorResponse.headers = { ...corsHeaders, ...errorResponse.headers }
      }

      return errorResponse
    }
  }

  // ── Schedule runner ────────────────────────────────────────────────

  function startSchedule(name: string, cronExpression: string): void {
    const fn = functions.get(name)
    if (!fn) {
      throw new Error(`Cannot schedule unregistered function "${name}"`)
    }

    const cronFields = parseCron(cronExpression)
    const schedule: FunctionSchedule = {
      functionName: name,
      cron: cronExpression,
      lastRun: null,
      nextRun: getNextCronDate(cronFields, new Date()).toISOString(),
      enabled: true,
      timerId: null,
    }

    const tick = (): void => {
      if (!schedule.enabled) return

      const req = buildRequest(name, null, 'POST')
      coreInvoke(name, req).catch(() => {})
      schedule.lastRun = new Date().toISOString()

      const nextDelay = msUntilNext(cronFields)
      schedule.nextRun = new Date(Date.now() + nextDelay).toISOString()
      schedule.timerId = setTimeout(tick, nextDelay)
    }

    const initialDelay = msUntilNext(cronFields)
    schedule.timerId = setTimeout(tick, initialDelay)
    schedules.set(name, schedule)
  }

  // ── Compute metrics from logs ──────────────────────────────────────

  function computeMetrics(fnName: string): FunctionMetrics {
    const fnLogs = logs.filter(l => l.functionName === fnName)
    if (fnLogs.length === 0) {
      return {
        functionName: fnName,
        totalInvocations: 0,
        successCount: 0,
        errorCount: 0,
        avgLatencyMs: 0,
        minLatencyMs: 0,
        maxLatencyMs: 0,
        p95LatencyMs: 0,
        lastInvokedAt: null,
      }
    }

    const durations = fnLogs.map(l => l.durationMs).sort((a, b) => a - b)
    const successCount = fnLogs.filter(l => l.error === null).length
    const errorCount = fnLogs.length - successCount
    const sum = durations.reduce((a, b) => a + b, 0)

    return {
      functionName: fnName,
      totalInvocations: fnLogs.length,
      successCount,
      errorCount,
      avgLatencyMs: Math.round((sum / durations.length) * 100) / 100,
      minLatencyMs: durations[0],
      maxLatencyMs: durations[durations.length - 1],
      p95LatencyMs: percentile(durations, 95),
      lastInvokedAt: fnLogs[fnLogs.length - 1].timestamp,
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    register(name: string, handler: FunctionHandler, options: FunctionOptions = {}): void {
      if (functions.has(name)) {
        throw new Error(`Function "${name}" is already registered`)
      }
      functions.set(name, {
        name,
        handler,
        options,
        middleware: options.middleware ? [...options.middleware] : [],
        createdAt: new Date().toISOString(),
      })
    },

    async invoke(
      name: string,
      payload?: unknown,
      context?: Partial<FunctionContext>,
    ): Promise<FunctionResponse> {
      const req = buildRequest(name, payload)
      return coreInvoke(name, req, context)
    },

    async invokeHttp(
      name: string,
      request: Partial<FunctionRequest>,
    ): Promise<FunctionResponse> {
      const req = buildRequest(
        name,
        request.body,
        request.method,
        request,
      )
      return coreInvoke(name, req)
    },

    list(): RegisteredFunction[] {
      return [...functions.values()]
    },

    remove(name: string): void {
      const existing = functions.get(name)
      if (!existing) {
        throw new Error(`Function "${name}" is not registered`)
      }
      functions.delete(name)
      const sched = schedules.get(name)
      if (sched) {
        if (sched.timerId !== null) clearTimeout(sched.timerId)
        schedules.delete(name)
      }
    },

    getMetrics(name?: string): FunctionMetrics | FunctionMetrics[] {
      if (name) {
        if (!functions.has(name)) {
          throw new Error(`Function "${name}" is not registered`)
        }
        return computeMetrics(name)
      }
      return [...functions.keys()].map(computeMetrics)
    },

    setSecret(key: string, value: string): void {
      secrets.set(key, value)
    },

    getSecrets(): string[] {
      return [...secrets.keys()]
    },

    schedule(name: string, cron: string): void {
      if (schedules.has(name)) {
        throw new Error(`Function "${name}" already has a schedule — unschedule first`)
      }
      startSchedule(name, cron)
    },

    unschedule(name: string): void {
      const sched = schedules.get(name)
      if (!sched) {
        throw new Error(`Function "${name}" has no active schedule`)
      }
      sched.enabled = false
      if (sched.timerId !== null) {
        clearTimeout(sched.timerId)
        sched.timerId = null
      }
      schedules.delete(name)
    },

    logs(name?: string, limit?: number): FunctionInvocationLog[] {
      let result = name ? logs.filter(l => l.functionName === name) : [...logs]
      if (limit !== undefined && limit > 0) {
        result = result.slice(-limit)
      }
      return result
    },

    shutdown(): void {
      for (const sched of schedules.values()) {
        sched.enabled = false
        if (sched.timerId !== null) {
          clearTimeout(sched.timerId)
          sched.timerId = null
        }
      }
      schedules.clear()
    },
  }
}
