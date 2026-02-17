import * as jose from 'jose'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getConfig } from '../config/index.js'
import type { DatabaseAdapter } from '../db/types.js'
import type { User, Session, AuthResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'

function parseSessionDuration(duration: string): number {
  const match = duration.match(/^(\d+)(d|h|m)$/)
  if (!match) return 30 * 24 * 60 * 60 * 1000
  const [, value, unit] = match
  const num = parseInt(value, 10)
  switch (unit) {
    case 'd': return num * 24 * 60 * 60 * 1000
    case 'h': return num * 60 * 60 * 1000
    case 'm': return num * 60 * 1000
    default: return 30 * 24 * 60 * 60 * 1000
  }
}

export async function createSession(
  db: DatabaseAdapter,
  user: User,
  options?: { ipAddress?: string; userAgent?: string }
): Promise<AuthResult> {
  const config = getConfig()
  const authConfig = typeof config.modules.auth === 'object' ? config.modules.auth : { sessionDuration: '30d' }
  const duration = parseSessionDuration(authConfig.sessionDuration || '30d')
  const expiresAt = new Date(Date.now() + duration)

  const secret = new TextEncoder().encode(config.jwtSecret)
  const token = await new jose.SignJWT({
    userId: user.id,
    email: user.email,
    role: user.role,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .setSubject(user.id)
    .sign(secret)

  const tokenHash = await bcrypt.hash(token.slice(-32), 8)
  const sessionId = crypto.randomUUID()

  await db.execute(
    `INSERT INTO vibekit_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, user.id, tokenHash, expiresAt.toISOString(), options?.ipAddress || null, options?.userAgent || null]
  )

  return { user, token, expiresAt }
}

export async function verifySession(
  db: DatabaseAdapter,
  token: string
): Promise<User | null> {
  const config = getConfig()
  const secret = new TextEncoder().encode(config.jwtSecret)

  try {
    const { payload } = await jose.jwtVerify(token, secret)
    const userId = payload.sub
    if (!userId) return null

    const user = await db.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE id = $1',
      [userId]
    )

    return user
  } catch {
    return null
  }
}

export async function revokeSession(db: DatabaseAdapter, userId: string): Promise<void> {
  await db.execute('DELETE FROM vibekit_sessions WHERE user_id = $1', [userId])
}

export async function revokeAllSessions(db: DatabaseAdapter, userId: string): Promise<void> {
  await db.execute('DELETE FROM vibekit_sessions WHERE user_id = $1', [userId])
}

export async function cleanExpiredSessions(db: DatabaseAdapter): Promise<number> {
  const result = await db.execute(
    "DELETE FROM vibekit_sessions WHERE expires_at < $1",
    [new Date().toISOString()]
  )
  return result.rowCount
}
