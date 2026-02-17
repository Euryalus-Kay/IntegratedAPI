// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Auth Proxy Routes
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ValidationError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:auth')

const authRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// In-memory session/user store (production would use DB + JWT)
// ──────────────────────────────────────────────────────────────────────────────

interface PendingCode {
  email: string
  code: string
  expiresAt: number
  attempts: number
}

interface UserRecord {
  id: string
  email: string
  role: 'user' | 'admin'
  createdAt: string
  updatedAt: string
  lastLoginAt?: string
  metadata: Record<string, unknown>
}

interface SessionRecord {
  id: string
  userId: string
  token: string
  expiresAt: string
  createdAt: string
}

const pendingCodes = new Map<string, PendingCode>()
const users = new Map<string, UserRecord>()
const sessions = new Map<string, SessionRecord>()
const tokenToSession = new Map<string, string>()

function generateId(prefix: string): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return `${prefix}_${ts}${rand}`
}

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function generateToken(): string {
  const parts: string[] = []
  for (let i = 0; i < 4; i++) {
    parts.push(Math.random().toString(36).substring(2, 10))
  }
  return `vk_${parts.join('')}`
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function resolveSessionFromRequest(c: { req: { header: (name: string) => string | undefined } }): SessionRecord | null {
  const authHeader = c.req.header('Authorization')
  if (!authHeader) return null

  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) return null

  const token = match[1]
  const sessionId = tokenToSession.get(token)
  if (!sessionId) return null

  const session = sessions.get(sessionId)
  if (!session) return null

  if (new Date(session.expiresAt) < new Date()) {
    // Session expired — clean up
    sessions.delete(sessionId)
    tokenToSession.delete(token)
    return null
  }

  return session
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/auth/send-code — Send a verification code to an email address.
 */
authRoutes.post('/send-code', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  if (!body.email || typeof body.email !== 'string') {
    throw new ValidationError('Email is required', {
      code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
      fieldErrors: { email: 'A valid email address is required' },
    })
  }

  const email = body.email.toLowerCase().trim()
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    throw new ValidationError('Invalid email format', {
      code: ErrorCodes.VALIDATION_INVALID_FORMAT,
      fieldErrors: { email: 'Must be a valid email address' },
    })
  }

  // Check rate limiting on pending codes
  const existing = pendingCodes.get(email)
  if (existing && existing.expiresAt > Date.now() && existing.attempts >= 5) {
    throw new VibeKitError('Too many verification attempts', {
      code: ErrorCodes.AUTH_CODE_MAX_ATTEMPTS,
      statusCode: 429,
      suggestion: 'Wait a few minutes before requesting a new code.',
    })
  }

  const code = generateCode()
  pendingCodes.set(email, {
    email,
    code,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
    attempts: 0,
  })

  log.info('Verification code sent', { email })

  // In production this would send an actual email via the email service
  return c.json({
    data: {
      sent: true,
      email,
      expiresIn: 600,
      // Include code in dev mode for testing
      ...(process.env.NODE_ENV !== 'production' ? { code } : {}),
    },
  })
})

/**
 * POST /api/v1/auth/verify — Verify a code and create a session.
 */
authRoutes.post('/verify', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  if (!body.email || typeof body.email !== 'string') {
    throw new ValidationError('Email is required', {
      code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
      fieldErrors: { email: 'Email is required' },
    })
  }

  if (!body.code || typeof body.code !== 'string') {
    throw new ValidationError('Verification code is required', {
      code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
      fieldErrors: { code: 'Verification code is required' },
    })
  }

  const email = body.email.toLowerCase().trim()
  const pending = pendingCodes.get(email)

  if (!pending) {
    throw new VibeKitError('No pending verification code for this email', {
      code: ErrorCodes.AUTH_CODE_INVALID,
      statusCode: 400,
      suggestion: 'Request a new verification code via POST /api/v1/auth/send-code',
    })
  }

  if (Date.now() > pending.expiresAt) {
    pendingCodes.delete(email)
    throw new VibeKitError('Verification code has expired', {
      code: ErrorCodes.AUTH_CODE_EXPIRED,
      statusCode: 400,
      suggestion: 'Request a new verification code.',
    })
  }

  pending.attempts++

  if (pending.attempts > 5) {
    pendingCodes.delete(email)
    throw new VibeKitError('Maximum verification attempts exceeded', {
      code: ErrorCodes.AUTH_CODE_MAX_ATTEMPTS,
      statusCode: 429,
    })
  }

  if (pending.code !== body.code) {
    throw new VibeKitError('Invalid verification code', {
      code: ErrorCodes.AUTH_CODE_INVALID,
      statusCode: 400,
      suggestion: 'Double-check the code. You have ' + (5 - pending.attempts) + ' attempts remaining.',
    })
  }

  // Code is valid — remove it
  pendingCodes.delete(email)

  // Find or create user
  let user: UserRecord | undefined
  for (const u of users.values()) {
    if (u.email === email) {
      user = u
      break
    }
  }

  const now = new Date().toISOString()

  if (!user) {
    user = {
      id: generateId('user'),
      email,
      role: 'user',
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      metadata: {},
    }
    users.set(user.id, user)
    log.info('New user created', { userId: user.id, email })
  } else {
    user.lastLoginAt = now
    user.updatedAt = now
  }

  // Create session
  const token = generateToken()
  const session: SessionRecord = {
    id: generateId('sess'),
    userId: user.id,
    token,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    createdAt: now,
  }
  sessions.set(session.id, session)
  tokenToSession.set(token, session.id)

  log.info('User authenticated', { userId: user.id, sessionId: session.id })

  return c.json({
    data: {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      session: {
        token: session.token,
        expiresAt: session.expiresAt,
      },
    },
  })
})

/**
 * POST /api/v1/auth/logout — Invalidate the current session.
 */
authRoutes.post('/logout', (c) => {
  const session = resolveSessionFromRequest(c)

  if (!session) {
    throw new VibeKitError('No active session', {
      code: ErrorCodes.AUTH_UNAUTHORIZED,
      statusCode: 401,
      suggestion: 'Include a valid session token in the Authorization header.',
    })
  }

  // Remove session
  sessions.delete(session.id)
  tokenToSession.delete(session.token)

  log.info('User logged out', { sessionId: session.id, userId: session.userId })

  return c.json({ data: { loggedOut: true } })
})

/**
 * GET /api/v1/auth/me — Get the currently authenticated user.
 */
authRoutes.get('/me', (c) => {
  const session = resolveSessionFromRequest(c)

  if (!session) {
    throw new VibeKitError('Not authenticated', {
      code: ErrorCodes.AUTH_UNAUTHORIZED,
      statusCode: 401,
      suggestion: 'Include a valid session token in the Authorization header.',
    })
  }

  const user = users.get(session.userId)
  if (!user) {
    throw new VibeKitError('User not found', {
      code: ErrorCodes.AUTH_USER_NOT_FOUND,
      statusCode: 404,
    })
  }

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      metadata: user.metadata,
    },
  })
})

/**
 * GET /api/v1/auth/users — List all users (admin-level).
 */
authRoutes.get('/users', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)

  const allUsers = Array.from(users.values())
  const paginated = allUsers.slice(offset, offset + limit)

  return c.json({
    data: paginated.map((u) => ({
      id: u.id,
      email: u.email,
      role: u.role,
      createdAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
    })),
    total: allUsers.length,
    limit,
    offset,
  })
})

/**
 * GET /api/v1/auth/users/:id — Get a specific user by ID.
 */
authRoutes.get('/users/:id', (c) => {
  const id = c.req.param('id')
  const user = users.get(id)

  if (!user) {
    throw new VibeKitError(`User not found: ${id}`, {
      code: ErrorCodes.AUTH_USER_NOT_FOUND,
      statusCode: 404,
    })
  }

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastLoginAt: user.lastLoginAt,
      metadata: user.metadata,
    },
  })
})

/**
 * PATCH /api/v1/auth/users/:id — Update a user's profile/role.
 */
authRoutes.patch('/users/:id', async (c) => {
  const id = c.req.param('id')
  const user = users.get(id)

  if (!user) {
    throw new VibeKitError(`User not found: ${id}`, {
      code: ErrorCodes.AUTH_USER_NOT_FOUND,
      statusCode: 404,
    })
  }

  const body = await c.req.json<Record<string, unknown>>()

  if (body.role !== undefined) {
    if (body.role !== 'user' && body.role !== 'admin') {
      throw new ValidationError('Invalid role', {
        code: ErrorCodes.VALIDATION_INVALID_FORMAT,
        fieldErrors: { role: 'Role must be "user" or "admin"' },
      })
    }
    user.role = body.role as 'user' | 'admin'
  }

  if (body.metadata !== undefined) {
    if (typeof body.metadata !== 'object' || body.metadata === null) {
      throw new ValidationError('Invalid metadata', {
        code: ErrorCodes.VALIDATION_INVALID_FORMAT,
        fieldErrors: { metadata: 'Metadata must be an object' },
      })
    }
    user.metadata = { ...user.metadata, ...(body.metadata as Record<string, unknown>) }
  }

  user.updatedAt = new Date().toISOString()

  log.info('Updated user', { userId: id })

  return c.json({
    data: {
      id: user.id,
      email: user.email,
      role: user.role,
      updatedAt: user.updatedAt,
      metadata: user.metadata,
    },
  })
})

/**
 * DELETE /api/v1/auth/users/:id — Delete a user and all their sessions.
 */
authRoutes.delete('/users/:id', (c) => {
  const id = c.req.param('id')
  const user = users.get(id)

  if (!user) {
    throw new VibeKitError(`User not found: ${id}`, {
      code: ErrorCodes.AUTH_USER_NOT_FOUND,
      statusCode: 404,
    })
  }

  // Remove all sessions for this user
  for (const [sessionId, session] of sessions) {
    if (session.userId === id) {
      tokenToSession.delete(session.token)
      sessions.delete(sessionId)
    }
  }

  users.delete(id)

  log.info('Deleted user', { userId: id, email: user.email })

  return c.json({ data: { id, deleted: true } })
})

export { authRoutes }
