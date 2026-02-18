/**
 * VibeKit Observability Module
 * Structured logging, metrics, tracing, alerts, health checks.
 * Replaces: Vercel Analytics, Railway Metrics, Datadog, New Relic
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface StructuredLog {
  level: LogLevel
  message: string
  timestamp: string
  context?: Record<string, unknown>
  traceId?: string
  spanId?: string
  service?: string
  error?: { message: string; stack?: string; code?: string }
}

export interface MetricEntry {
  name: string
  type: 'counter' | 'gauge' | 'histogram' | 'summary'
  value: number
  labels: Record<string, string>
  timestamp: string
}

export interface TraceSpan {
  traceId: string
  spanId: string
  parentSpanId: string | null
  name: string
  service: string
  startTime: string
  endTime: string | null
  durationMs: number | null
  status: 'ok' | 'error' | 'unset'
  attributes: Record<string, unknown>
  events: Array<{ name: string; timestamp: string; attributes?: Record<string, unknown> }>
}

export interface AlertRule {
  id: string
  name: string
  condition: string
  threshold: number
  metric: string
  window: string
  channels: string[]
  enabled: boolean
  lastTriggered: string | null
  createdAt: string
}

export interface AlertEvent {
  id: string
  ruleId: string
  ruleName: string
  value: number
  threshold: number
  message: string
  triggeredAt: string
  resolved: boolean
  resolvedAt: string | null
}

export interface HealthCheck {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  latencyMs: number
  message?: string
  lastChecked: string
  metadata?: Record<string, unknown>
}

export interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy'
  checks: HealthCheck[]
  uptime: number
  timestamp: string
  version: string
}

// ── In-memory stores ──────────────────────────────────────────────────────

const _logs: StructuredLog[] = []
const _metrics: Map<string, MetricEntry> = new Map()
const _metricHistory: MetricEntry[] = []
const _spans: Map<string, TraceSpan> = new Map()
const _completedSpans: TraceSpan[] = []
const _alertRules: Map<string, AlertRule & { checkFn?: (value: number) => boolean }> = new Map()
const _alertEvents: AlertEvent[] = []
const _healthChecks: Map<string, () => Promise<HealthCheck>> = new Map()
const _startTime = Date.now()

let _logLevel: LogLevel = 'info'
let _maxLogBuffer = 1000
let _maxMetricHistory = 10000
let _maxSpanHistory = 5000
let _service = 'vibekit'

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5,
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[_logLevel]
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// ── Logging ───────────────────────────────────────────────────────────────

function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
  if (!shouldLog(level)) return
  const entry: StructuredLog = {
    level, message,
    timestamp: new Date().toISOString(),
    context, service: _service,
  }
  _logs.push(entry)
  if (_logs.length > _maxLogBuffer) _logs.splice(0, _logs.length - _maxLogBuffer)

  // Console output in dev
  const prefix = `[${level.toUpperCase()}]`
  const ctx = context ? ` ${JSON.stringify(context)}` : ''
  if (level === 'error' || level === 'fatal') {
    console.error(`${prefix} ${message}${ctx}`)
  } else if (level === 'warn') {
    console.warn(`${prefix} ${message}${ctx}`)
  } else if (level === 'debug' || level === 'trace') {
    console.debug(`${prefix} ${message}${ctx}`)
  } else {
    console.log(`${prefix} ${message}${ctx}`)
  }
}

export const logger = {
  trace: (msg: string, ctx?: Record<string, unknown>) => log('trace', msg, ctx),
  debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, ctx),
  fatal: (msg: string, ctx?: Record<string, unknown>) => log('fatal', msg, ctx),

  setLevel(level: LogLevel): void { _logLevel = level },
  getLevel(): LogLevel { return _logLevel },
  setService(name: string): void { _service = name },
  setBufferSize(size: number): void { _maxLogBuffer = size },
  getLogs(options?: { level?: LogLevel; limit?: number; search?: string }): StructuredLog[] {
    let logs = [..._logs]
    if (options?.level) {
      const minLevel = LOG_LEVELS[options.level]
      logs = logs.filter(l => LOG_LEVELS[l.level] >= minLevel)
    }
    if (options?.search) {
      const term = options.search.toLowerCase()
      logs = logs.filter(l => l.message.toLowerCase().includes(term) || JSON.stringify(l.context || {}).toLowerCase().includes(term))
    }
    if (options?.limit) logs = logs.slice(-options.limit)
    return logs
  },
  clear(): void { _logs.length = 0 },

  child(defaultContext: Record<string, unknown>) {
    return {
      trace: (msg: string, ctx?: Record<string, unknown>) => log('trace', msg, { ...defaultContext, ...ctx }),
      debug: (msg: string, ctx?: Record<string, unknown>) => log('debug', msg, { ...defaultContext, ...ctx }),
      info: (msg: string, ctx?: Record<string, unknown>) => log('info', msg, { ...defaultContext, ...ctx }),
      warn: (msg: string, ctx?: Record<string, unknown>) => log('warn', msg, { ...defaultContext, ...ctx }),
      error: (msg: string, ctx?: Record<string, unknown>) => log('error', msg, { ...defaultContext, ...ctx }),
      fatal: (msg: string, ctx?: Record<string, unknown>) => log('fatal', msg, { ...defaultContext, ...ctx }),
    }
  },
}

// ── Metrics ───────────────────────────────────────────────────────────────

export const metrics = {
  increment(name: string, value = 1, labels: Record<string, string> = {}): void {
    const key = `${name}:${JSON.stringify(labels)}`
    const existing = _metrics.get(key)
    const entry: MetricEntry = {
      name, type: 'counter',
      value: (existing?.value ?? 0) + value,
      labels, timestamp: new Date().toISOString(),
    }
    _metrics.set(key, entry)
    _metricHistory.push({ ...entry })
    if (_metricHistory.length > _maxMetricHistory) _metricHistory.splice(0, _metricHistory.length - _maxMetricHistory)
    checkAlerts(name, entry.value)
  },

  gauge(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = `${name}:${JSON.stringify(labels)}`
    const entry: MetricEntry = {
      name, type: 'gauge', value, labels,
      timestamp: new Date().toISOString(),
    }
    _metrics.set(key, entry)
    _metricHistory.push({ ...entry })
    if (_metricHistory.length > _maxMetricHistory) _metricHistory.splice(0, _metricHistory.length - _maxMetricHistory)
    checkAlerts(name, value)
  },

  histogram(name: string, value: number, labels: Record<string, string> = {}): void {
    const key = `${name}:${JSON.stringify(labels)}`
    const entry: MetricEntry = {
      name, type: 'histogram', value, labels,
      timestamp: new Date().toISOString(),
    }
    _metrics.set(key, entry)
    _metricHistory.push({ ...entry })
    if (_metricHistory.length > _maxMetricHistory) _metricHistory.splice(0, _metricHistory.length - _maxMetricHistory)
  },

  get(name: string, labels?: Record<string, string>): MetricEntry | undefined {
    if (labels) return _metrics.get(`${name}:${JSON.stringify(labels)}`)
    for (const [key, entry] of _metrics) {
      if (key.startsWith(`${name}:`)) return entry
    }
    return undefined
  },

  getAll(): MetricEntry[] { return [..._metrics.values()] },

  getHistory(name?: string, limit = 100): MetricEntry[] {
    let history = name ? _metricHistory.filter(m => m.name === name) : [..._metricHistory]
    return history.slice(-limit)
  },

  reset(name?: string): void {
    if (name) {
      for (const key of [..._metrics.keys()]) {
        if (key.startsWith(`${name}:`)) _metrics.delete(key)
      }
    } else {
      _metrics.clear()
    }
  },

  /** Export metrics in Prometheus text format */
  toPrometheus(): string {
    const lines: string[] = []
    const byName = new Map<string, MetricEntry[]>()
    for (const entry of _metrics.values()) {
      if (!byName.has(entry.name)) byName.set(entry.name, [])
      byName.get(entry.name)!.push(entry)
    }
    for (const [name, entries] of byName) {
      const type = entries[0]?.type || 'gauge'
      lines.push(`# TYPE ${name} ${type}`)
      for (const entry of entries) {
        const labelStr = Object.entries(entry.labels).map(([k, v]) => `${k}="${v}"`).join(',')
        const labelPart = labelStr ? `{${labelStr}}` : ''
        lines.push(`${name}${labelPart} ${entry.value}`)
      }
    }
    return lines.join('\n')
  },
}

// ── Tracing ───────────────────────────────────────────────────────────────

export const tracing = {
  startSpan(name: string, options?: { traceId?: string; parentSpanId?: string; attributes?: Record<string, unknown> }): TraceSpan {
    const traceId = options?.traceId || generateId()
    const spanId = generateId()
    const span: TraceSpan = {
      traceId, spanId,
      parentSpanId: options?.parentSpanId || null,
      name, service: _service,
      startTime: new Date().toISOString(),
      endTime: null, durationMs: null,
      status: 'unset',
      attributes: options?.attributes || {},
      events: [],
    }
    _spans.set(spanId, span)
    return span
  },

  endSpan(spanId: string, status?: 'ok' | 'error'): TraceSpan | null {
    const span = _spans.get(spanId)
    if (!span) return null
    span.endTime = new Date().toISOString()
    span.durationMs = new Date(span.endTime).getTime() - new Date(span.startTime).getTime()
    span.status = status || 'ok'
    _spans.delete(spanId)
    _completedSpans.push(span)
    if (_completedSpans.length > _maxSpanHistory) _completedSpans.splice(0, _completedSpans.length - _maxSpanHistory)
    return span
  },

  addSpanEvent(spanId: string, name: string, attributes?: Record<string, unknown>): void {
    const span = _spans.get(spanId)
    if (span) {
      span.events.push({ name, timestamp: new Date().toISOString(), attributes })
    }
  },

  setSpanAttribute(spanId: string, key: string, value: unknown): void {
    const span = _spans.get(spanId)
    if (span) span.attributes[key] = value
  },

  getActiveSpans(): TraceSpan[] { return [..._spans.values()] },

  getCompletedSpans(options?: { traceId?: string; limit?: number }): TraceSpan[] {
    let spans = [..._completedSpans]
    if (options?.traceId) spans = spans.filter(s => s.traceId === options.traceId)
    if (options?.limit) spans = spans.slice(-options.limit)
    return spans
  },

  getTrace(traceId: string): TraceSpan[] {
    return [
      ...[..._spans.values()].filter(s => s.traceId === traceId),
      ..._completedSpans.filter(s => s.traceId === traceId),
    ].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  },

  /** Async wrapper that traces a function call */
  async trace<T>(name: string, fn: (span: TraceSpan) => Promise<T>, options?: { attributes?: Record<string, unknown> }): Promise<T> {
    const span = tracing.startSpan(name, { attributes: options?.attributes })
    try {
      const result = await fn(span)
      tracing.endSpan(span.spanId, 'ok')
      return result
    } catch (error) {
      tracing.addSpanEvent(span.spanId, 'error', {
        message: error instanceof Error ? error.message : String(error),
      })
      tracing.endSpan(span.spanId, 'error')
      throw error
    }
  },

  clear(): void { _spans.clear(); _completedSpans.length = 0 },
}

// ── Alerts ────────────────────────────────────────────────────────────────

function checkAlerts(metricName: string, value: number): void {
  for (const rule of _alertRules.values()) {
    if (rule.metric !== metricName || !rule.enabled) continue
    const triggered = rule.checkFn ? rule.checkFn(value) : value > rule.threshold
    if (triggered) {
      const event: AlertEvent = {
        id: generateId(),
        ruleId: rule.id,
        ruleName: rule.name,
        value,
        threshold: rule.threshold,
        message: `Alert "${rule.name}": ${metricName} = ${value} (threshold: ${rule.threshold})`,
        triggeredAt: new Date().toISOString(),
        resolved: false,
        resolvedAt: null,
      }
      _alertEvents.push(event)
      rule.lastTriggered = event.triggeredAt
      logger.warn(`Alert triggered: ${event.message}`)
    }
  }
}

export const alerts = {
  createRule(rule: Omit<AlertRule, 'id' | 'lastTriggered' | 'createdAt'>): AlertRule {
    const id = generateId()
    const alertRule: AlertRule & { checkFn?: (value: number) => boolean } = {
      ...rule, id,
      lastTriggered: null,
      createdAt: new Date().toISOString(),
    }

    // Parse condition
    if (rule.condition === '>') alertRule.checkFn = (v) => v > rule.threshold
    else if (rule.condition === '<') alertRule.checkFn = (v) => v < rule.threshold
    else if (rule.condition === '>=') alertRule.checkFn = (v) => v >= rule.threshold
    else if (rule.condition === '<=') alertRule.checkFn = (v) => v <= rule.threshold
    else if (rule.condition === '==') alertRule.checkFn = (v) => v === rule.threshold

    _alertRules.set(id, alertRule)
    return { ...alertRule, checkFn: undefined } as AlertRule
  },

  removeRule(id: string): void { _alertRules.delete(id) },

  listRules(): AlertRule[] {
    return [..._alertRules.values()].map(({ checkFn, ...rest }) => rest)
  },

  getEvents(options?: { ruleId?: string; limit?: number; resolved?: boolean }): AlertEvent[] {
    let events = [..._alertEvents]
    if (options?.ruleId) events = events.filter(e => e.ruleId === options.ruleId)
    if (options?.resolved !== undefined) events = events.filter(e => e.resolved === options.resolved)
    if (options?.limit) events = events.slice(-options.limit)
    return events
  },

  resolveEvent(eventId: string): void {
    const event = _alertEvents.find(e => e.id === eventId)
    if (event) {
      event.resolved = true
      event.resolvedAt = new Date().toISOString()
    }
  },

  clear(): void { _alertRules.clear(); _alertEvents.length = 0 },
}

// ── Health Checks ─────────────────────────────────────────────────────────

export const health = {
  register(name: string, checkFn: () => Promise<HealthCheck>): void {
    _healthChecks.set(name, checkFn)
  },

  unregister(name: string): void { _healthChecks.delete(name) },

  async check(name?: string): Promise<HealthCheck | HealthReport> {
    if (name) {
      const fn = _healthChecks.get(name)
      if (!fn) throw new Error(`Health check "${name}" not registered`)
      return fn()
    }
    // Run all checks
    const checks: HealthCheck[] = []
    for (const [checkName, fn] of _healthChecks) {
      try {
        checks.push(await fn())
      } catch (err) {
        checks.push({
          name: checkName,
          status: 'unhealthy',
          latencyMs: 0,
          message: err instanceof Error ? err.message : String(err),
          lastChecked: new Date().toISOString(),
        })
      }
    }

    const hasUnhealthy = checks.some(c => c.status === 'unhealthy')
    const hasDegraded = checks.some(c => c.status === 'degraded')

    return {
      status: hasUnhealthy ? 'unhealthy' : hasDegraded ? 'degraded' : 'healthy',
      checks,
      uptime: Math.floor((Date.now() - _startTime) / 1000),
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    }
  },

  listRegistered(): string[] { return [..._healthChecks.keys()] },
}

// ── Combined export ───────────────────────────────────────────────────────

export const observability = {
  logger,
  metrics,
  tracing,
  alerts,
  health,
}
