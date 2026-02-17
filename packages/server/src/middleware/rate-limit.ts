// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Rate Limiting Middleware
// ──────────────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory'
import type { Context, MiddlewareHandler } from 'hono'
import { VibeKitError, ErrorCodes } from 'vibekit'
import type { AppEnv } from '../types.js'

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  maxRequests: number
  /** Time window in milliseconds. */
  windowMs: number
  /** Key extractor — determines how to bucket requests. Defaults to IP. */
  keyExtractor?: (c: Context) => string
  /** Optional message override. */
  message?: string
}

interface RateLimitEntry {
  count: number
  resetAt: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Default configs for different route groups
// ──────────────────────────────────────────────────────────────────────────────

export const RATE_LIMIT_PRESETS = {
  /** General API: 100 req/min */
  standard: { maxRequests: 100, windowMs: 60_000 },
  /** Auth endpoints: 20 req/min (tighter to prevent brute-force) */
  auth: { maxRequests: 20, windowMs: 60_000 },
  /** Database endpoints: 200 req/min */
  database: { maxRequests: 200, windowMs: 60_000 },
  /** Storage uploads: 30 req/min */
  storage: { maxRequests: 30, windowMs: 60_000 },
  /** Email sends: 10 req/min */
  email: { maxRequests: 10, windowMs: 60_000 },
  /** Admin/deploy: 30 req/min */
  admin: { maxRequests: 30, windowMs: 60_000 },
  /** Health checks: 60 req/min */
  health: { maxRequests: 60, windowMs: 60_000 },
} as const

// ──────────────────────────────────────────────────────────────────────────────
// In-memory store with automatic cleanup
// ──────────────────────────────────────────────────────────────────────────────

class RateLimitStore {
  private buckets = new Map<string, RateLimitEntry>()
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor() {
    // Periodically purge expired entries to prevent memory leaks
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000)
    // Allow the process to exit even if the interval is still active
    if (this.cleanupInterval && typeof this.cleanupInterval === 'object' && 'unref' in this.cleanupInterval) {
      this.cleanupInterval.unref()
    }
  }

  /**
   * Check the current request count for a key and increment it.
   * Returns the updated entry and whether the limit has been exceeded.
   */
  check(key: string, config: RateLimitConfig): { allowed: boolean; entry: RateLimitEntry; remaining: number } {
    const now = Date.now()
    let entry = this.buckets.get(key)

    if (!entry || now >= entry.resetAt) {
      // Window expired or first request — start a new window
      entry = { count: 1, resetAt: now + config.windowMs }
      this.buckets.set(key, entry)
      return { allowed: true, entry, remaining: config.maxRequests - 1 }
    }

    entry.count++

    if (entry.count > config.maxRequests) {
      return { allowed: false, entry, remaining: 0 }
    }

    return { allowed: true, entry, remaining: config.maxRequests - entry.count }
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.buckets) {
      if (now >= entry.resetAt) {
        this.buckets.delete(key)
      }
    }
  }

  /** For testing — clear all entries. */
  reset(): void {
    this.buckets.clear()
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
    this.buckets.clear()
  }
}

// Singleton store shared across all rate-limit middleware instances
const store = new RateLimitStore()

// ──────────────────────────────────────────────────────────────────────────────
// Extract client identifier (IP or API key)
// ──────────────────────────────────────────────────────────────────────────────

function defaultKeyExtractor(c: Context): string {
  // Prefer forwarded headers (behind proxies/load balancers)
  const forwarded = c.req.header('X-Forwarded-For')
  if (forwarded) {
    return forwarded.split(',')[0].trim()
  }
  const realIp = c.req.header('X-Real-IP')
  if (realIp) return realIp

  // Fall back to a generic key (single-process scenario)
  return 'unknown'
}

// ──────────────────────────────────────────────────────────────────────────────
// Middleware factory
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Create a rate-limiting middleware with the given configuration.
 *
 * Sets standard `RateLimit-*` response headers and throws a VibeKitError
 * with code `RATE_LIMITED` (429) when the limit is exceeded.
 */
export function rateLimitMiddleware(config: RateLimitConfig): MiddlewareHandler {
  const keyFn = config.keyExtractor ?? defaultKeyExtractor

  return createMiddleware<AppEnv>(async (c, next) => {
    const key = `${keyFn(c)}:${c.req.path}`
    const { allowed, entry, remaining } = store.check(key, config)

    // Always set informational headers
    const retryAfter = Math.max(0, Math.ceil((entry.resetAt - Date.now()) / 1000))
    c.header('RateLimit-Limit', String(config.maxRequests))
    c.header('RateLimit-Remaining', String(remaining))
    c.header('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (!allowed) {
      c.header('Retry-After', String(retryAfter))
      throw new VibeKitError(
        config.message ?? 'Rate limit exceeded. Please slow down and retry later.',
        {
          code: ErrorCodes.RATE_LIMITED,
          statusCode: 429,
          suggestion: `You have exceeded ${config.maxRequests} requests per ${config.windowMs / 1000}s. Wait ${retryAfter}s before retrying.`,
          context: {
            limit: config.maxRequests,
            windowMs: config.windowMs,
            retryAfterSeconds: retryAfter,
          },
        },
      )
    }

    await next()
  })
}

/**
 * Clean up the global store. Call on server shutdown.
 */
export function destroyRateLimitStore(): void {
  store.destroy()
}
