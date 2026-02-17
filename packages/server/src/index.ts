// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Production API Backend
// ──────────────────────────────────────────────────────────────────────────────
//
// Full Hono-based API server powering the VibeKit backend.
// Provides project management, auth, database, storage, email, billing,
// admin, and deployment endpoints behind a unified API gateway.
//
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { createLogger, VibeKitError, ErrorCodes } from 'vibekit'
import type { AppEnv } from './types.js'

// Middleware
import { requestIdMiddleware } from './middleware/request-id.js'
import { errorHandlerMiddleware, notFoundHandler } from './middleware/error-handler.js'
import { rateLimitMiddleware, RATE_LIMIT_PRESETS, destroyRateLimitStore } from './middleware/rate-limit.js'
import { apiAuthMiddleware, optionalAuthMiddleware, seedFromEnv } from './middleware/api-auth.js'

// Routes
import { healthRoutes, metrics } from './routes/health.js'
import { projectRoutes } from './routes/projects.js'
import { authRoutes } from './routes/auth.js'
import { databaseRoutes } from './routes/database.js'
import { storageRoutes } from './routes/storage.js'
import { emailRoutes } from './routes/email.js'
import { billingRoutes } from './routes/billing.js'
import { adminRoutes } from './routes/admin.js'
import { deployRoutes } from './routes/deploy.js'

const log = createLogger('server')

// ──────────────────────────────────────────────────────────────────────────────
// Server Configuration
// ──────────────────────────────────────────────────────────────────────────────

export interface ServerConfig {
  /** Port to listen on. Default: 3747 or PORT env. */
  port?: number
  /** Allowed CORS origins. Default: ['*'] in dev, configurable in prod. */
  corsOrigins?: string[]
  /** Maximum request body size in bytes. Default: 10 MB. */
  maxBodySize?: number
  /** Whether to seed API keys from environment. Default: true. */
  seedEnvKeys?: boolean
  /** Custom rate limit overrides per route group. */
  rateLimits?: Partial<typeof RATE_LIMIT_PRESETS>
}

const DEFAULT_PORT = 3747
const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024 // 10 MB

// ──────────────────────────────────────────────────────────────────────────────
// Create Server
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create and configure the VibeKit API server.
 *
 * Returns a configured Hono application with all middleware and routes
 * registered. Call `.start()` on the returned object to begin listening
 * for connections, or use the `.app` property to embed in a custom server.
 *
 * ```ts
 * import { createServer } from '@vibekit/server'
 *
 * const server = createServer({ port: 3747 })
 * server.start()
 * ```
 */
export function createServer(config: ServerConfig = {}) {
  const port = config.port ?? parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10)
  const maxBodySize = config.maxBodySize ?? DEFAULT_MAX_BODY_SIZE
  const corsOrigins = config.corsOrigins
    ?? (process.env.VIBEKIT_CORS_ORIGINS
      ? process.env.VIBEKIT_CORS_ORIGINS.split(',').map((o) => o.trim())
      : ['*'])

  const rateLimits = { ...RATE_LIMIT_PRESETS, ...config.rateLimits }

  // Seed API keys from environment
  if (config.seedEnvKeys !== false) {
    seedFromEnv()
  }

  // ── Hono App ────────────────────────────────────────────────────────────

  const app = new Hono<AppEnv>()

  // ── Global Middleware (applied to all routes) ───────────────────────────

  // 1. Request ID — must be first to ensure all logs include the ID
  app.use('*', requestIdMiddleware)

  // 2. Error handler — wraps everything and returns structured JSON errors
  app.use('*', errorHandlerMiddleware)

  // 3. Request logging with timing + metrics recording
  app.use('*', async (c, next) => {
    const start = performance.now()
    await next()
    const durationMs = Math.round((performance.now() - start) * 100) / 100
    const status = c.res.status

    // Record metrics
    metrics.recordRequest(c.req.method, c.req.path, status, durationMs)

    // Log the request
    const requestId = c.get('requestId')
    log.logRequest({
      method: c.req.method,
      path: c.req.path,
      statusCode: status,
      durationMs,
      requestId,
    })
  })

  // 4. CORS
  app.use('*', cors({
    origin: corsOrigins.includes('*')
      ? '*'
      : (origin) => corsOrigins.includes(origin) ? origin : corsOrigins[0],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-API-Key',
      'X-Request-ID',
      'X-Project-ID',
      'X-API-Version',
    ],
    exposeHeaders: [
      'X-Request-ID',
      'RateLimit-Limit',
      'RateLimit-Remaining',
      'RateLimit-Reset',
      'Retry-After',
    ],
    maxAge: 86400,
    credentials: true,
  }))

  // 5. Request body size limiting
  app.use('*', async (c, next) => {
    const contentLength = c.req.header('Content-Length')
    if (contentLength) {
      const size = parseInt(contentLength, 10)
      if (!isNaN(size) && size > maxBodySize) {
        throw new VibeKitError(
          `Request body too large: ${(size / 1024 / 1024).toFixed(1)} MB exceeds ${(maxBodySize / 1024 / 1024).toFixed(0)} MB limit`,
          {
            code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
            statusCode: 413,
            suggestion: `Reduce the request body size to under ${(maxBodySize / 1024 / 1024).toFixed(0)} MB.`,
          },
        )
      }
    }
    await next()
  })

  // 6. API version header support
  app.use('/api/*', async (c, next) => {
    // Set the API version in the response
    c.header('X-API-Version', 'v1')

    // Check for version header from client
    const clientVersion = c.req.header('X-API-Version')
    if (clientVersion && clientVersion !== 'v1') {
      throw new VibeKitError(`Unsupported API version: ${clientVersion}. Current version is v1.`, {
        code: ErrorCodes.VALIDATION_FAILED,
        statusCode: 400,
        suggestion: 'Use X-API-Version: v1 or omit the header to use the latest version.',
      })
    }

    await next()
  })

  // ── Health Routes (no auth required) ────────────────────────────────────

  app.route('/health', healthRoutes)

  // Rate limit health endpoints separately (lighter limits)
  app.use('/health/*', rateLimitMiddleware(rateLimits.health))

  // ── Maintenance mode check for API routes ───────────────────────────────

  app.use('/api/*', async (c, next) => {
    const { maintenanceMode } = await import('./routes/admin.js')
    if (maintenanceMode) {
      throw new VibeKitError('Service is currently under maintenance. Please try again later.', {
        code: 'MAINTENANCE_MODE',
        statusCode: 503,
        suggestion: 'The service is temporarily unavailable for maintenance. Try again in a few minutes.',
      })
    }
    await next()
  })

  // ── API v1 Routes ──────────────────────────────────────────────────────

  // Projects — requires API key auth
  app.use('/api/v1/projects/*', apiAuthMiddleware)
  app.use('/api/v1/projects/*', rateLimitMiddleware(rateLimits.standard))
  app.route('/api/v1/projects', projectRoutes)

  // Auth — requires API key auth for project scoping
  app.use('/api/v1/auth/*', apiAuthMiddleware)
  app.use('/api/v1/auth/*', rateLimitMiddleware(rateLimits.auth))
  app.route('/api/v1/auth', authRoutes)

  // Database — requires API key auth
  app.use('/api/v1/db/*', apiAuthMiddleware)
  app.use('/api/v1/db/*', rateLimitMiddleware(rateLimits.database))
  app.route('/api/v1/db', databaseRoutes)

  // Storage — requires API key auth
  app.use('/api/v1/storage/*', apiAuthMiddleware)
  app.use('/api/v1/storage/*', rateLimitMiddleware(rateLimits.storage))
  app.route('/api/v1/storage', storageRoutes)

  // Email — requires API key auth
  app.use('/api/v1/email/*', apiAuthMiddleware)
  app.use('/api/v1/email/*', rateLimitMiddleware(rateLimits.email))
  app.route('/api/v1/email', emailRoutes)

  // Billing — requires API key auth
  app.use('/api/v1/billing/*', apiAuthMiddleware)
  app.use('/api/v1/billing/*', rateLimitMiddleware(rateLimits.standard))
  app.route('/api/v1/billing', billingRoutes)

  // Admin — requires API key auth
  app.use('/api/v1/admin/*', apiAuthMiddleware)
  app.use('/api/v1/admin/*', rateLimitMiddleware(rateLimits.admin))
  app.route('/api/v1/admin', adminRoutes)

  // Deploy — requires API key auth
  app.use('/api/v1/deploy/*', apiAuthMiddleware)
  app.use('/api/v1/deploy/*', rateLimitMiddleware(rateLimits.admin))
  app.route('/api/v1/deploy', deployRoutes)

  // ── Root endpoint ──────────────────────────────────────────────────────

  app.get('/', (c) => {
    return c.json({
      name: 'VibeKit API',
      version: 'v1',
      status: 'ok',
      docs: 'https://vibekit.dev/docs/api',
      endpoints: {
        health: '/health',
        healthDetailed: '/health/detailed',
        metrics: '/health/metrics',
        projects: '/api/v1/projects',
        auth: '/api/v1/auth',
        database: '/api/v1/db',
        storage: '/api/v1/storage',
        email: '/api/v1/email',
        billing: '/api/v1/billing',
        admin: '/api/v1/admin',
        deploy: '/api/v1/deploy',
      },
    })
  })

  // ── 404 handler ─────────────────────────────────────────────────────────

  app.notFound(notFoundHandler)

  // ── Server lifecycle ────────────────────────────────────────────────────

  let server: { close: () => void } | null = null

  return {
    /** The underlying Hono app instance for testing or embedding. */
    app,

    /** The configured port. */
    port,

    /**
     * Start the HTTP server.
     *
     * Uses @hono/node-server for Node.js environments.
     * Returns a handle that can be used to stop the server.
     */
    async start() {
      try {
        const { serve } = await import('@hono/node-server')

        server = serve({
          fetch: app.fetch,
          port,
        }, (info) => {
          log.info(`VibeKit API server started`, {
            port: info.port,
            address: info.address,
            environment: process.env.NODE_ENV ?? 'development',
          })
          console.log(`
  ╔═══════════════════════════════════════════════════╗
  ║                                                   ║
  ║   VibeKit API Server                              ║
  ║   Listening on http://localhost:${String(info.port).padEnd(5)}              ║
  ║                                                   ║
  ║   Health:   http://localhost:${String(info.port).padEnd(5)}/health          ║
  ║   API:      http://localhost:${String(info.port).padEnd(5)}/api/v1          ║
  ║   Docs:     https://vibekit.dev/docs/api          ║
  ║                                                   ║
  ╚═══════════════════════════════════════════════════╝
`)
        })

        return server
      } catch (err) {
        log.error('Failed to start server', {
          error: err instanceof Error ? err.message : String(err),
          port,
        })
        throw err
      }
    },

    /**
     * Gracefully stop the server and clean up resources.
     */
    async stop() {
      log.info('Shutting down VibeKit API server...')
      if (server) {
        server.close()
        server = null
      }
      destroyRateLimitStore()
      log.info('Server stopped')
    },
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Auto-start when run directly
// ──────────────────────────────────────────────────────────────────────────────

const isMainModule =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  (process.argv[1].endsWith('/index.js') || process.argv[1].endsWith('/index.ts'))

if (isMainModule) {
  const server = createServer()
  server.start().catch((err) => {
    console.error('Fatal: Could not start VibeKit server:', err)
    process.exit(1)
  })

  // Graceful shutdown
  const shutdown = () => {
    server.stop().then(() => process.exit(0)).catch(() => process.exit(1))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// ──────────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────────

export { metrics } from './routes/health.js'
export { RATE_LIMIT_PRESETS } from './middleware/rate-limit.js'
export type { RateLimitConfig } from './middleware/rate-limit.js'
export type { ApiKeyRecord, ProjectRecord, AuthContext } from './middleware/api-auth.js'
export { registerApiKey, registerProject } from './middleware/api-auth.js'
export type { AppEnv } from './types.js'
