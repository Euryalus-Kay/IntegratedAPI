// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Observability — Log Drains
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getConfig } from '../config/index.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type LogDrainType = 'http' | 'datadog' | 'betterstack' | 'custom'
export type LogDrainStatus = 'active' | 'paused' | 'error'
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'

export interface LogDrainConfig {
  type: LogDrainType
  name: string
  url: string
  apiKey?: string
  headers?: Record<string, string>
  filter?: LogDrainFilter
  sampleRate?: number
  batchSize?: number
  flushInterval?: number
}

export interface LogDrainFilter {
  level?: LogLevel
  module?: string
  pattern?: string
}

export interface LogDrain {
  id: string
  type: LogDrainType
  name: string
  url: string
  apiKey: string | null
  headers: Record<string, string>
  filter: LogDrainFilter | null
  sampleRate: number
  batchSize: number
  flushInterval: number
  status: LogDrainStatus
  stats: LogDrainStats
  createdAt: string
  updatedAt: string
}

export interface LogDrainStats {
  totalSent: number
  totalErrors: number
  lastSentAt: string | null
  lastErrorAt: string | null
  lastError: string | null
}

export interface LogEntry {
  level: LogLevel
  message: string
  timestamp: string
  module?: string
  context?: Record<string, unknown>
  traceId?: string
}

interface DrainState {
  drain: LogDrain
  buffer: LogEntry[]
  flushTimer: ReturnType<typeof setInterval> | null
  retryCount: number
}

interface DrainStore {
  drains: LogDrain[]
}

// ── Constants ────────────────────────────────────────────────────────────────

const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5,
}

const MAX_RETRY_ATTEMPTS = 3
const BASE_RETRY_DELAY_MS = 1000
const DEFAULT_BATCH_SIZE = 100
const DEFAULT_FLUSH_INTERVAL_MS = 5000
const DEFAULT_SAMPLE_RATE = 1.0

// ── Factory ──────────────────────────────────────────────────────────────────

export function createLogDrainManager() {
  const storagePath = resolveStoragePath()
  const _states: Map<string, DrainState> = new Map()

  // ── Persistence ──────────────────────────────────────────────────────────

  function readStore(): DrainStore {
    try {
      if (fs.existsSync(storagePath)) {
        const raw = fs.readFileSync(storagePath, 'utf-8')
        return JSON.parse(raw) as DrainStore
      }
    } catch {
      // Corrupted file; start fresh
    }
    return { drains: [] }
  }

  function writeStore(store: DrainStore): void {
    const dir = path.dirname(storagePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(storagePath, JSON.stringify(store, null, 2), 'utf-8')
  }

  // ── Flush / delivery ────────────────────────────────────────────────────

  async function flushDrain(state: DrainState): Promise<void> {
    if (state.buffer.length === 0) return
    if (state.drain.status === 'paused') return

    const batch = state.buffer.splice(0, state.drain.batchSize)
    const payload = formatPayload(state.drain, batch)

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...state.drain.headers,
      }

      if (state.drain.apiKey) {
        if (state.drain.type === 'datadog') {
          headers['DD-API-KEY'] = state.drain.apiKey
        } else if (state.drain.type === 'betterstack') {
          headers['Authorization'] = `Bearer ${state.drain.apiKey}`
        } else {
          headers['Authorization'] = `Bearer ${state.drain.apiKey}`
        }
      }

      const res = await fetch(state.drain.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }

      // Update stats
      state.drain.stats.totalSent += batch.length
      state.drain.stats.lastSentAt = new Date().toISOString()
      state.retryCount = 0
      persistDrainStats(state.drain)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      state.drain.stats.totalErrors++
      state.drain.stats.lastErrorAt = new Date().toISOString()
      state.drain.stats.lastError = errorMsg

      // Retry with exponential backoff
      if (state.retryCount < MAX_RETRY_ATTEMPTS) {
        state.retryCount++
        // Push batch back to buffer front for retry
        state.buffer.unshift(...batch)
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, state.retryCount - 1)
        setTimeout(() => flushDrain(state), delay)
      } else {
        // Max retries exceeded; mark drain as error
        state.drain.status = 'error'
        state.retryCount = 0
      }
      persistDrainStats(state.drain)
    }
  }

  function persistDrainStats(drain: LogDrain): void {
    const store = readStore()
    const idx = store.drains.findIndex(d => d.id === drain.id)
    if (idx !== -1) {
      store.drains[idx] = { ...drain }
      writeStore(store)
    }
  }

  function startFlushTimer(state: DrainState): void {
    if (state.flushTimer) return
    state.flushTimer = setInterval(() => {
      flushDrain(state).catch(() => { /* swallow async errors */ })
    }, state.drain.flushInterval)

    if (state.flushTimer && typeof state.flushTimer === 'object' && 'unref' in state.flushTimer) {
      (state.flushTimer as NodeJS.Timeout).unref()
    }
  }

  function stopFlushTimer(state: DrainState): void {
    if (state.flushTimer) {
      clearInterval(state.flushTimer)
      state.flushTimer = null
    }
  }

  function getState(drainId: string): DrainState | undefined {
    return _states.get(drainId)
  }

  function ensureState(drain: LogDrain): DrainState {
    let state = _states.get(drain.id)
    if (!state) {
      state = { drain, buffer: [], flushTimer: null, retryCount: 0 }
      _states.set(drain.id, state)
    }
    return state
  }

  // ── Hydrate active drains on creation ────────────────────────────────────

  const store = readStore()
  for (const drain of store.drains) {
    if (drain.status === 'active') {
      const state = ensureState(drain)
      startFlushTimer(state)
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    /**
     * Add a new log drain. The drain starts in `active` status and
     * begins buffering and flushing logs immediately.
     */
    add(config: LogDrainConfig): LogDrain {
      if (!config.url) {
        throw new Error('Log drain URL is required.')
      }
      if (!config.name) {
        throw new Error('Log drain name is required.')
      }

      const now = new Date().toISOString()
      const drain: LogDrain = {
        id: crypto.randomUUID(),
        type: config.type,
        name: config.name,
        url: config.url,
        apiKey: config.apiKey ?? null,
        headers: config.headers ?? {},
        filter: config.filter ?? null,
        sampleRate: config.sampleRate ?? DEFAULT_SAMPLE_RATE,
        batchSize: config.batchSize ?? DEFAULT_BATCH_SIZE,
        flushInterval: config.flushInterval ?? DEFAULT_FLUSH_INTERVAL_MS,
        status: 'active',
        stats: {
          totalSent: 0,
          totalErrors: 0,
          lastSentAt: null,
          lastErrorAt: null,
          lastError: null,
        },
        createdAt: now,
        updatedAt: now,
      }

      const storeData = readStore()
      storeData.drains.push(drain)
      writeStore(storeData)

      const state = ensureState(drain)
      startFlushTimer(state)

      return drain
    },

    /**
     * Remove a log drain and stop its flush timer.
     */
    remove(drainId: string): void {
      const state = getState(drainId)
      if (state) {
        stopFlushTimer(state)
        _states.delete(drainId)
      }

      const storeData = readStore()
      const idx = storeData.drains.findIndex(d => d.id === drainId)
      if (idx === -1) {
        throw new Error(`Log drain "${drainId}" not found.`)
      }
      storeData.drains.splice(idx, 1)
      writeStore(storeData)
    },

    /**
     * List all configured log drains.
     */
    list(): LogDrain[] {
      return [...readStore().drains]
    },

    /**
     * Send a test log entry to a specific drain to verify connectivity.
     */
    async test(drainId: string): Promise<{ success: boolean; error?: string }> {
      const storeData = readStore()
      const drain = storeData.drains.find(d => d.id === drainId)
      if (!drain) {
        throw new Error(`Log drain "${drainId}" not found.`)
      }

      const testEntry: LogEntry = {
        level: 'info',
        message: 'VibeKit log drain test message',
        timestamp: new Date().toISOString(),
        module: 'vibekit.drains',
        context: { test: true, drainId },
      }

      const payload = formatPayload(drain, [testEntry])
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...drain.headers,
      }
      if (drain.apiKey) {
        if (drain.type === 'datadog') {
          headers['DD-API-KEY'] = drain.apiKey
        } else {
          headers['Authorization'] = `Bearer ${drain.apiKey}`
        }
      }

      try {
        const res = await fetch(drain.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        })

        if (!res.ok) {
          return { success: false, error: `HTTP ${res.status}: ${res.statusText}` }
        }
        return { success: true }
      } catch (err) {
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },

    /**
     * Pause a log drain. Buffered logs are retained but not flushed
     * until the drain is resumed.
     */
    pause(drainId: string): void {
      const storeData = readStore()
      const drain = storeData.drains.find(d => d.id === drainId)
      if (!drain) throw new Error(`Log drain "${drainId}" not found.`)

      drain.status = 'paused'
      drain.updatedAt = new Date().toISOString()
      writeStore(storeData)

      const state = getState(drainId)
      if (state) {
        state.drain.status = 'paused'
        stopFlushTimer(state)
      }
    },

    /**
     * Resume a paused log drain.
     */
    resume(drainId: string): void {
      const storeData = readStore()
      const drain = storeData.drains.find(d => d.id === drainId)
      if (!drain) throw new Error(`Log drain "${drainId}" not found.`)

      drain.status = 'active'
      drain.updatedAt = new Date().toISOString()
      writeStore(storeData)

      const state = ensureState(drain)
      state.drain.status = 'active'
      startFlushTimer(state)
    },

    /**
     * Get delivery statistics for a specific drain.
     */
    getStats(drainId: string): LogDrainStats {
      const storeData = readStore()
      const drain = storeData.drains.find(d => d.id === drainId)
      if (!drain) throw new Error(`Log drain "${drainId}" not found.`)
      return { ...drain.stats }
    },

    /**
     * Force flush all pending logs across all active drains.
     */
    async flush(): Promise<void> {
      const promises: Promise<void>[] = []
      for (const state of _states.values()) {
        if (state.drain.status === 'active' && state.buffer.length > 0) {
          promises.push(flushDrain(state))
        }
      }
      await Promise.allSettled(promises)
    },

    /**
     * Ingest a log entry into all active drains. This is the primary
     * method used to feed logs into the drain pipeline. Logs are
     * filtered and sampled before being added to the drain buffer.
     */
    ingest(entry: LogEntry): void {
      for (const state of _states.values()) {
        if (state.drain.status !== 'active') continue

        // Apply filter
        if (state.drain.filter) {
          const f = state.drain.filter
          if (f.level && LOG_LEVELS[entry.level] < LOG_LEVELS[f.level]) continue
          if (f.module && entry.module && !entry.module.includes(f.module)) continue
          if (f.pattern && !entry.message.includes(f.pattern)) continue
        }

        // Apply sampling
        if (state.drain.sampleRate < 1.0 && Math.random() > state.drain.sampleRate) continue

        state.buffer.push(entry)

        // Auto-flush when batch size is reached
        if (state.buffer.length >= state.drain.batchSize) {
          flushDrain(state).catch(() => { /* swallow async errors */ })
        }
      }
    },

    /**
     * Stop all flush timers and clear buffers. Useful for graceful
     * shutdown and testing.
     */
    shutdown(): void {
      for (const state of _states.values()) {
        stopFlushTimer(state)
        state.buffer.length = 0
      }
      _states.clear()
    },
  }
}

// ── Payload formatters ───────────────────────────────────────────────────────

function formatPayload(drain: LogDrain, entries: LogEntry[]): unknown {
  switch (drain.type) {
    case 'datadog':
      return entries.map(e => ({
        ddsource: 'vibekit',
        ddtags: e.module ? `module:${e.module}` : undefined,
        hostname: 'vibekit-app',
        message: e.message,
        status: mapLevelToDatadog(e.level),
        timestamp: e.timestamp,
        ...e.context,
      }))

    case 'betterstack':
      return entries.map(e => ({
        dt: e.timestamp,
        level: e.level,
        message: e.message,
        ...(e.module ? { module: e.module } : {}),
        ...(e.context ?? {}),
      }))

    case 'http':
    case 'custom':
    default:
      return {
        logs: entries.map(e => ({
          level: e.level,
          message: e.message,
          timestamp: e.timestamp,
          module: e.module,
          traceId: e.traceId,
          ...e.context,
        })),
        source: 'vibekit',
        sentAt: new Date().toISOString(),
      }
  }
}

function mapLevelToDatadog(level: LogLevel): string {
  switch (level) {
    case 'trace':
    case 'debug': return 'debug'
    case 'info': return 'info'
    case 'warn': return 'warning'
    case 'error': return 'error'
    case 'fatal': return 'critical'
    default: return 'info'
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveStoragePath(): string {
  try {
    const config = getConfig()
    const dbPath = config.dbPath ?? '.vibekit/data.db'
    const dir = path.dirname(path.resolve(dbPath))
    return path.join(dir, '_vibekit_log_drains.json')
  } catch {
    return path.resolve('.vibekit', '_vibekit_log_drains.json')
  }
}
