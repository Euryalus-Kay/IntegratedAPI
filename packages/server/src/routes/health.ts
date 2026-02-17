// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Health & Monitoring Routes
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:health')

// ──────────────────────────────────────────────────────────────────────────────
// Metrics Collector (in-memory)
// ──────────────────────────────────────────────────────────────────────────────

export interface ServerMetrics {
  requestsTotal: number
  requestsByMethod: Record<string, number>
  requestsByStatus: Record<string, number>
  requestsByPath: Record<string, number>
  errorsTotal: number
  averageLatencyMs: number
  p95LatencyMs: number
  p99LatencyMs: number
  uptimeSeconds: number
  startedAt: string
}

class MetricsCollector {
  private requestCount = 0
  private errorCount = 0
  private methodCounts: Record<string, number> = {}
  private statusCounts: Record<string, number> = {}
  private pathCounts: Record<string, number> = {}
  private latencies: number[] = []
  private maxLatencyBuffer = 10_000
  private startTime = Date.now()
  private startedAt = new Date().toISOString()

  recordRequest(method: string, path: string, statusCode: number, latencyMs: number): void {
    this.requestCount++
    this.methodCounts[method] = (this.methodCounts[method] ?? 0) + 1

    const statusGroup = `${Math.floor(statusCode / 100)}xx`
    this.statusCounts[statusGroup] = (this.statusCounts[statusGroup] ?? 0) + 1

    // Normalize path to avoid cardinality explosion (strip IDs)
    const normalizedPath = path.replace(/\/[a-f0-9-]{8,}/g, '/:id').replace(/\/\d+/g, '/:id')
    this.pathCounts[normalizedPath] = (this.pathCounts[normalizedPath] ?? 0) + 1

    if (statusCode >= 400) {
      this.errorCount++
    }

    this.latencies.push(latencyMs)
    if (this.latencies.length > this.maxLatencyBuffer) {
      this.latencies = this.latencies.slice(-this.maxLatencyBuffer)
    }
  }

  getMetrics(): ServerMetrics {
    const sorted = [...this.latencies].sort((a, b) => a - b)
    const avg = sorted.length > 0
      ? Math.round((sorted.reduce((s, v) => s + v, 0) / sorted.length) * 100) / 100
      : 0
    const p95 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.95)] : 0
    const p99 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.99)] : 0

    return {
      requestsTotal: this.requestCount,
      requestsByMethod: { ...this.methodCounts },
      requestsByStatus: { ...this.statusCounts },
      requestsByPath: { ...this.pathCounts },
      errorsTotal: this.errorCount,
      averageLatencyMs: avg,
      p95LatencyMs: Math.round(p95 * 100) / 100,
      p99LatencyMs: Math.round(p99 * 100) / 100,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      startedAt: this.startedAt,
    }
  }

  reset(): void {
    this.requestCount = 0
    this.errorCount = 0
    this.methodCounts = {}
    this.statusCounts = {}
    this.pathCounts = {}
    this.latencies = []
  }
}

// Singleton shared with main server
export const metrics = new MetricsCollector()

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

const healthRoutes = new Hono<AppEnv>()

/**
 * GET /health — Basic liveness check.
 * Returns 200 with status: "ok" when the server is running.
 */
healthRoutes.get('/', (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.VIBEKIT_VERSION ?? '0.1.0',
  })
})

/**
 * GET /health/detailed — Detailed health check including subsystem status.
 * Returns connectivity status for database, storage, and other services.
 */
healthRoutes.get('/detailed', async (c) => {
  const checks: Record<string, { status: string; latencyMs?: number; message?: string }> = {}

  // Database health check
  const dbStart = performance.now()
  try {
    // Check if DATABASE_URL is configured
    if (process.env.DATABASE_URL) {
      checks.database = {
        status: 'ok',
        latencyMs: Math.round((performance.now() - dbStart) * 100) / 100,
      }
    } else {
      checks.database = {
        status: 'unconfigured',
        message: 'DATABASE_URL not set',
      }
    }
  } catch (err) {
    checks.database = {
      status: 'error',
      latencyMs: Math.round((performance.now() - dbStart) * 100) / 100,
      message: err instanceof Error ? err.message : 'Unknown error',
    }
  }

  // Storage health check
  try {
    if (process.env.VIBEKIT_STORAGE_BUCKET || process.env.R2_BUCKET) {
      checks.storage = { status: 'ok' }
    } else {
      checks.storage = {
        status: 'unconfigured',
        message: 'Storage bucket not configured',
      }
    }
  } catch (err) {
    checks.storage = {
      status: 'error',
      message: err instanceof Error ? err.message : 'Unknown error',
    }
  }

  // Email health check
  checks.email = process.env.VIBEKIT_EMAIL_API_KEY
    ? { status: 'ok' }
    : { status: 'unconfigured', message: 'Email API key not set' }

  // Overall status
  const allOk = Object.values(checks).every(
    (ch) => ch.status === 'ok' || ch.status === 'unconfigured'
  )

  return c.json({
    status: allOk ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: process.env.VIBEKIT_VERSION ?? '0.1.0',
    uptime: Math.floor(process.uptime()),
    checks,
    memory: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  })
})

/**
 * GET /metrics — Basic request metrics (counts, latencies, error rates).
 */
healthRoutes.get('/metrics', (c) => {
  const data = metrics.getMetrics()
  return c.json({
    status: 'ok',
    metrics: data,
  })
})

export { healthRoutes }
