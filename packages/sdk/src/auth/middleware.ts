import crypto from 'node:crypto'
import { auth } from './provider.js'
import type { User, RateLimitEntry } from './types.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitOptions {
  /** Time window in milliseconds (default: 60 000 = 1 minute). */
  windowMs?: number
  /** Maximum number of requests allowed in the window (default: 60). */
  max?: number
  /** Custom error message returned when the limit is exceeded. */
  message?: string
  /**
   * Function that derives a unique key from the request. Defaults to the
   * IP address extracted from common headers.
   */
  keyFn?: (req: any) => string
}

export interface MiddlewareErrorBody {
  error: string
  code: string
  suggestion: string
  docs: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DOCS_BASE = 'https://docs.vibekit.dev'

// ---------------------------------------------------------------------------
// Helpers: error responses
// ---------------------------------------------------------------------------

function sendError(
  res: any,
  statusCode: number,
  body: MiddlewareErrorBody,
): void {
  // Express-style
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode).json(body)
    return
  }
  // Fallback: try to set status + write JSON manually (e.g. raw Node response)
  if (typeof res.writeHead === 'function') {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
    return
  }
}

function honoError(c: any, statusCode: number, body: MiddlewareErrorBody) {
  return c.json(body, statusCode)
}

function getIp(req: any): string {
  // Common proxy headers, then raw socket
  return (
    req.headers?.['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers?.['x-real-ip'] ||
    req.headers?.get?.('x-real-ip') ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  )
}

// ---------------------------------------------------------------------------
// Express / generic middleware
// ---------------------------------------------------------------------------

/**
 * Attach the current user (or `null`) to `req.user` without blocking
 * unauthenticated requests.
 */
export function middleware() {
  return async (req: any, res: any, next: any) => {
    try {
      req.user = await auth.getUser(req)
    } catch {
      req.user = null
    }
    next()
  }
}

/**
 * Block unauthenticated requests. Optionally restrict by role.
 *
 * If `redirectTo` is set the user is redirected instead of receiving a JSON
 * error response.
 */
export function protect(options?: { role?: string; redirectTo?: string }) {
  return async (req: any, res: any, next: any) => {
    try {
      const user = await auth.requireUser(req)

      if (options?.role && user.role !== options.role) {
        if (options?.redirectTo) return res.redirect(options.redirectTo)
        return sendError(res, 403, {
          error: `Forbidden: requires the "${options.role}" role.`,
          code: 'AUTH_INSUFFICIENT_ROLE',
          suggestion: 'Contact an administrator to have your role updated.',
          docs: `${DOCS_BASE}/auth/roles`,
        })
      }

      req.user = user
      next()
    } catch {
      if (options?.redirectTo) return res.redirect(options.redirectTo)
      sendError(res, 401, {
        error: 'Authentication required. Include a valid session token in your request.',
        code: 'AUTH_UNAUTHORIZED',
        suggestion: 'Call POST /auth/send-code and POST /auth/verify to obtain a session token.',
        docs: `${DOCS_BASE}/auth/quickstart`,
      })
    }
  }
}

/**
 * Convenience alias for {@link protect} with no options.
 */
export function requireAuth() {
  return protect()
}

/**
 * Require that the authenticated user holds **any** of the listed roles.
 *
 * @example
 * ```ts
 * app.delete('/admin/users/:id', requireRole('admin', 'superadmin'), handler)
 * ```
 */
export function requireRole(...roles: string[]) {
  if (roles.length === 0) {
    throw new Error('requireRole() requires at least one role argument.')
  }

  return async (req: any, res: any, next: any) => {
    try {
      const user = await auth.requireUser(req)

      if (!roles.includes(user.role)) {
        return sendError(res, 403, {
          error: `Forbidden: requires one of the following roles: ${roles.join(', ')}.`,
          code: 'AUTH_INSUFFICIENT_ROLE',
          suggestion:
            roles.length === 1
              ? `Your current role does not include "${roles[0]}". Contact an administrator.`
              : `Your current role does not match any of: ${roles.join(', ')}. Contact an administrator.`,
          docs: `${DOCS_BASE}/auth/roles`,
        })
      }

      req.user = user
      next()
    } catch {
      sendError(res, 401, {
        error: 'Authentication required. Include a valid session token in your request.',
        code: 'AUTH_UNAUTHORIZED',
        suggestion: 'Call POST /auth/send-code and POST /auth/verify to obtain a session token.',
        docs: `${DOCS_BASE}/auth/quickstart`,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, per-process)
// ---------------------------------------------------------------------------

/**
 * In-memory sliding-window rate limiter.
 *
 * Works with Express, Hono (via {@link honoRateLimit}), and any framework
 * that follows the `(req, res, next)` middleware pattern.
 *
 * @example
 * ```ts
 * app.use('/auth', rateLimit({ windowMs: 60_000, max: 10 }))
 * ```
 */
export function rateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = 60_000,
    max = 60,
    message = 'Too many requests. Please try again later.',
    keyFn = getIp,
  } = options

  const store = new Map<string, RateLimitEntry>()

  // Periodically clean up expired entries to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, Math.max(windowMs, 60_000))
  // Allow the Node process to exit even if the interval is still active
  if (cleanupInterval.unref) cleanupInterval.unref()

  return (req: any, res: any, next: any) => {
    const key = keyFn(req)
    const now = Date.now()
    let entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    // Set standard rate-limit headers
    const remaining = Math.max(0, max - entry.count)
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000)
    if (typeof res.setHeader === 'function') {
      res.setHeader('X-RateLimit-Limit', String(max))
      res.setHeader('X-RateLimit-Remaining', String(remaining))
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
    }

    if (entry.count > max) {
      if (typeof res.setHeader === 'function') {
        res.setHeader('Retry-After', String(retryAfterSec))
      }
      return sendError(res, 429, {
        error: message,
        code: 'RATE_LIMITED',
        suggestion: `Wait ${retryAfterSec} second(s) before retrying.`,
        docs: `${DOCS_BASE}/guides/rate-limiting`,
      })
    }

    next()
  }
}

// ---------------------------------------------------------------------------
// CSRF (double-submit cookie)
// ---------------------------------------------------------------------------

/**
 * CSRF protection using the double-submit cookie pattern.
 *
 * For **GET / HEAD / OPTIONS** requests: a random CSRF token is set as a
 * cookie (`vibekit_csrf`) and returned in the `X-CSRF-Token` response header
 * so that the client can read it.
 *
 * For **state-changing methods** (POST, PUT, PATCH, DELETE): the middleware
 * verifies that the `X-CSRF-Token` request header matches the value of the
 * `vibekit_csrf` cookie.
 *
 * @example
 * ```ts
 * app.use(csrf())
 * ```
 */
export function csrf() {
  return (req: any, res: any, next: any) => {
    const method = (req.method || 'GET').toUpperCase()
    const safeMethods = ['GET', 'HEAD', 'OPTIONS']

    if (safeMethods.includes(method)) {
      // Issue a new token on safe requests
      const token = crypto.randomUUID()
      const isSecure = process.env.NODE_ENV === 'production'
      const cookie = [
        `vibekit_csrf=${token}`,
        'Path=/',
        'SameSite=Lax',
        isSecure ? 'Secure' : '',
      ]
        .filter(Boolean)
        .join('; ')

      if (typeof res.setHeader === 'function') {
        res.setHeader('Set-Cookie', cookie)
        res.setHeader('X-CSRF-Token', token)
      } else if (typeof res.header === 'function') {
        res.header('Set-Cookie', cookie)
        res.header('X-CSRF-Token', token)
      }

      return next()
    }

    // State-changing request: verify the token
    const cookieHeader: string | undefined =
      req.headers?.cookie || req.headers?.get?.('cookie')
    let cookieToken: string | null = null
    if (cookieHeader) {
      const match = cookieHeader.match(/vibekit_csrf=([^;]+)/)
      if (match) cookieToken = match[1]
    }

    const headerToken: string | undefined =
      req.headers?.['x-csrf-token'] || req.headers?.get?.('x-csrf-token')

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return sendError(res, 403, {
        error: 'CSRF token mismatch. Your request could not be verified.',
        code: 'CSRF_INVALID',
        suggestion:
          'Include the X-CSRF-Token header with the value from the vibekit_csrf cookie. ' +
          'Perform a GET request first to obtain a fresh token.',
        docs: `${DOCS_BASE}/security/csrf`,
      })
    }

    next()
  }
}

// ---------------------------------------------------------------------------
// Hono-specific middleware
// ---------------------------------------------------------------------------

/**
 * Hono middleware: attach the current user to the context without blocking
 * unauthenticated requests.
 */
export function honoMiddleware() {
  return async (c: any, next: any) => {
    try {
      const user = await auth.getUser(c.req.raw)
      c.set('user', user)
    } catch {
      c.set('user', null)
    }
    await next()
  }
}

/**
 * Hono middleware: block unauthenticated requests. Optionally restrict by a
 * single role.
 */
export function honoProtect(options?: { role?: string }) {
  return async (c: any, next: any) => {
    try {
      const user = await auth.requireUser(c.req.raw)
      if (options?.role && user.role !== options.role) {
        return honoError(c, 403, {
          error: `Forbidden: requires the "${options.role}" role.`,
          code: 'AUTH_INSUFFICIENT_ROLE',
          suggestion: 'Contact an administrator to have your role updated.',
          docs: `${DOCS_BASE}/auth/roles`,
        })
      }
      c.set('user', user)
      await next()
    } catch {
      return honoError(c, 401, {
        error: 'Authentication required. Include a valid session token in your request.',
        code: 'AUTH_UNAUTHORIZED',
        suggestion: 'Call POST /auth/send-code and POST /auth/verify to obtain a session token.',
        docs: `${DOCS_BASE}/auth/quickstart`,
      })
    }
  }
}

/**
 * Hono middleware: require the authenticated user to hold any of the listed
 * roles.
 */
export function honoRequireRole(...roles: string[]) {
  if (roles.length === 0) {
    throw new Error('honoRequireRole() requires at least one role argument.')
  }

  return async (c: any, next: any) => {
    try {
      const user = await auth.requireUser(c.req.raw)

      if (!roles.includes(user.role)) {
        return honoError(c, 403, {
          error: `Forbidden: requires one of the following roles: ${roles.join(', ')}.`,
          code: 'AUTH_INSUFFICIENT_ROLE',
          suggestion:
            roles.length === 1
              ? `Your current role does not include "${roles[0]}". Contact an administrator.`
              : `Your current role does not match any of: ${roles.join(', ')}. Contact an administrator.`,
          docs: `${DOCS_BASE}/auth/roles`,
        })
      }

      c.set('user', user)
      await next()
    } catch {
      return honoError(c, 401, {
        error: 'Authentication required. Include a valid session token in your request.',
        code: 'AUTH_UNAUTHORIZED',
        suggestion: 'Call POST /auth/send-code and POST /auth/verify to obtain a session token.',
        docs: `${DOCS_BASE}/auth/quickstart`,
      })
    }
  }
}

/**
 * Hono middleware: in-memory sliding-window rate limiter.
 */
export function honoRateLimit(options: RateLimitOptions = {}) {
  const {
    windowMs = 60_000,
    max = 60,
    message = 'Too many requests. Please try again later.',
    keyFn,
  } = options

  const store = new Map<string, RateLimitEntry>()

  const cleanupInterval = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store) {
      if (now > entry.resetAt) store.delete(key)
    }
  }, Math.max(windowMs, 60_000))
  if (cleanupInterval.unref) cleanupInterval.unref()

  return async (c: any, next: any) => {
    const key = keyFn
      ? keyFn(c.req.raw)
      : c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
        c.req.header('x-real-ip') ||
        'unknown'

    const now = Date.now()
    let entry = store.get(key)

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs }
      store.set(key, entry)
    }

    entry.count++

    const remaining = Math.max(0, max - entry.count)
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000)

    c.header('X-RateLimit-Limit', String(max))
    c.header('X-RateLimit-Remaining', String(remaining))
    c.header('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))

    if (entry.count > max) {
      c.header('Retry-After', String(retryAfterSec))
      return honoError(c, 429, {
        error: message,
        code: 'RATE_LIMITED',
        suggestion: `Wait ${retryAfterSec} second(s) before retrying.`,
        docs: `${DOCS_BASE}/guides/rate-limiting`,
      })
    }

    await next()
  }
}

/**
 * Hono middleware: CSRF protection using the double-submit cookie pattern.
 */
export function honoCsrf() {
  return async (c: any, next: any) => {
    const method = c.req.method.toUpperCase()
    const safeMethods = ['GET', 'HEAD', 'OPTIONS']

    if (safeMethods.includes(method)) {
      const token = crypto.randomUUID()
      const isSecure = process.env.NODE_ENV === 'production'
      const cookie = [
        `vibekit_csrf=${token}`,
        'Path=/',
        'SameSite=Lax',
        isSecure ? 'Secure' : '',
      ]
        .filter(Boolean)
        .join('; ')

      c.header('Set-Cookie', cookie)
      c.header('X-CSRF-Token', token)
      await next()
      return
    }

    // State-changing request: verify the token
    const cookieHeader: string | undefined = c.req.header('cookie')
    let cookieToken: string | null = null
    if (cookieHeader) {
      const match = cookieHeader.match(/vibekit_csrf=([^;]+)/)
      if (match) cookieToken = match[1]
    }

    const headerToken: string | undefined = c.req.header('x-csrf-token')

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return honoError(c, 403, {
        error: 'CSRF token mismatch. Your request could not be verified.',
        code: 'CSRF_INVALID',
        suggestion:
          'Include the X-CSRF-Token header with the value from the vibekit_csrf cookie. ' +
          'Perform a GET request first to obtain a fresh token.',
        docs: `${DOCS_BASE}/security/csrf`,
      })
    }

    await next()
  }
}

// ---------------------------------------------------------------------------
// Cookie helpers (unchanged from original)
// ---------------------------------------------------------------------------

export function setSessionCookie(res: any, token: string, expiresAt: Date): void {
  const isSecure = process.env.NODE_ENV === 'production'
  const cookie = [
    `vibekit_session=${token}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Expires=${expiresAt.toUTCString()}`,
    isSecure ? 'Secure' : '',
  ]
    .filter(Boolean)
    .join('; ')

  if (res.setHeader) {
    res.setHeader('Set-Cookie', cookie)
  } else if (res.header) {
    res.header('Set-Cookie', cookie)
  }
}

export function clearSessionCookie(res: any): void {
  const cookie =
    'vibekit_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  if (res.setHeader) {
    res.setHeader('Set-Cookie', cookie)
  } else if (res.header) {
    res.header('Set-Cookie', cookie)
  }
}
