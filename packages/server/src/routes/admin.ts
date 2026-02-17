// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Admin Endpoints
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ErrorCodes, createLogger, getRecentLogs, type LogEntry } from 'vibekit'
import type { AppEnv } from '../types.js'
import { metrics } from './health.js'
import { getAllProjects } from '../middleware/api-auth.js'

const log = createLogger('server:admin')

const adminRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// System Health & Info
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/admin/system — System-level information.
 */
adminRoutes.get('/system', (c) => {
  const mem = process.memoryUsage()

  return c.json({
    data: {
      status: 'ok',
      version: process.env.VIBEKIT_VERSION ?? '0.1.0',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      uptime: Math.floor(process.uptime()),
      pid: process.pid,
      memory: {
        rss: Math.round(mem.rss / 1024 / 1024),
        heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
        external: Math.round(mem.external / 1024 / 1024),
      },
      cpuUsage: process.cpuUsage(),
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
    },
  })
})

/**
 * GET /api/v1/admin/metrics — Detailed request metrics.
 */
adminRoutes.get('/metrics', (c) => {
  const data = metrics.getMetrics()

  return c.json({
    data: {
      ...data,
      errorRate: data.requestsTotal > 0
        ? Math.round((data.errorsTotal / data.requestsTotal) * 10000) / 100
        : 0,
    },
  })
})

/**
 * GET /api/v1/admin/logs — Get recent log entries.
 */
adminRoutes.get('/logs', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 500)
  const level = c.req.query('level')

  let logs: readonly LogEntry[] = getRecentLogs(limit)

  if (level) {
    logs = logs.filter((entry: LogEntry) => entry.level === level)
  }

  return c.json({
    data: logs,
    total: logs.length,
  })
})

/**
 * GET /api/v1/admin/projects — List all projects (admin view).
 */
adminRoutes.get('/projects', (c) => {
  const allProjects = getAllProjects()

  return c.json({
    data: allProjects,
    total: allProjects.length,
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// Config & Feature Flags
// ──────────────────────────────────────────────────────────────────────────────

const featureFlags = new Map<string, boolean>()

/**
 * GET /api/v1/admin/config — Get current server configuration (non-sensitive).
 */
adminRoutes.get('/config', (c) => {
  return c.json({
    data: {
      region: process.env.VIBEKIT_REGION ?? 'us-east-1',
      environment: process.env.NODE_ENV ?? 'development',
      features: {
        database: !!process.env.DATABASE_URL,
        storage: !!(process.env.VIBEKIT_STORAGE_BUCKET || process.env.R2_BUCKET),
        email: !!process.env.VIBEKIT_EMAIL_API_KEY,
        realtime: !!process.env.VIBEKIT_REALTIME_ENABLED,
      },
      limits: {
        maxRequestBodySize: process.env.VIBEKIT_MAX_BODY_SIZE ?? '10mb',
        rateLimitPerMinute: parseInt(process.env.VIBEKIT_RATE_LIMIT ?? '100', 10),
      },
      featureFlags: Object.fromEntries(featureFlags),
    },
  })
})

/**
 * PUT /api/v1/admin/config/flags — Update feature flags.
 */
adminRoutes.put('/config/flags', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  if (!body.flags || typeof body.flags !== 'object' || body.flags === null) {
    throw new VibeKitError('Flags object is required', {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 400,
      suggestion: 'Provide a flags object like { "feature-x": true, "feature-y": false }',
    })
  }

  const flags = body.flags as Record<string, boolean>

  for (const [key, value] of Object.entries(flags)) {
    if (typeof value === 'boolean') {
      featureFlags.set(key, value)
    }
  }

  log.info('Feature flags updated', { flags })

  return c.json({
    data: {
      flags: Object.fromEntries(featureFlags),
      updatedAt: new Date().toISOString(),
    },
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// User Management (Admin-level)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/admin/cache/clear — Clear server caches.
 */
adminRoutes.post('/cache/clear', (c) => {
  // In production, this would clear Redis/in-memory caches, CDN, etc.
  log.info('Cache cleared by admin')

  return c.json({
    data: {
      cleared: true,
      timestamp: new Date().toISOString(),
    },
  })
})

/**
 * POST /api/v1/admin/maintenance — Toggle maintenance mode.
 */
let maintenanceMode = false

adminRoutes.post('/maintenance', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  if (typeof body.enabled !== 'boolean') {
    throw new VibeKitError('enabled field (boolean) is required', {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 400,
    })
  }

  maintenanceMode = body.enabled
  const message = body.message as string | undefined

  log.info(`Maintenance mode ${maintenanceMode ? 'enabled' : 'disabled'}`, {
    message: message ?? '',
  })

  return c.json({
    data: {
      maintenanceMode,
      message: message ?? null,
      updatedAt: new Date().toISOString(),
    },
  })
})

adminRoutes.get('/maintenance', (c) => {
  return c.json({
    data: {
      enabled: maintenanceMode,
    },
  })
})

export { adminRoutes, maintenanceMode }
