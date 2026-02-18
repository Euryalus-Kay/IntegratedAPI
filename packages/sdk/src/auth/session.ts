import crypto from 'node:crypto'
import type { DatabaseAdapter } from '../db/types.js'
import type { User, Session, SessionInfo } from './types.js'

/**
 * Session management utilities for VibeKit auth.
 */

export async function createSession(
  adapter: DatabaseAdapter | { execute: Function; query: Function; queryOne: Function },
  user: User,
  options?: { ip?: string; userAgent?: string; ipAddress?: string; metadata?: Record<string, unknown> }
): Promise<{ user: User; token: string; expiresAt: Date }> {
  const sessionId = crypto.randomUUID()
  const token = crypto.randomBytes(48).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  const ip = options?.ip || options?.ipAddress || null

  await (adapter as DatabaseAdapter).execute(
    `INSERT INTO vibekit_sessions (id, user_id, token_hash, expires_at, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      sessionId, user.id, tokenHash, expiresAt.toISOString(),
      ip, options?.userAgent || null,
      options?.metadata ? JSON.stringify(options.metadata) : null
    ]
  )

  return { user, token: `${sessionId}:${token}`, expiresAt }
}

export async function validateSession(
  adapter: DatabaseAdapter,
  sessionToken: string
): Promise<{ user: User; session: Session } | null> {
  const parts = sessionToken.split(':')
  if (parts.length !== 2) return null
  const [sessionId, token] = parts
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

  const session = await adapter.queryOne<Session>(
    `SELECT * FROM vibekit_sessions WHERE id = $1 AND token_hash = $2`,
    [sessionId, tokenHash]
  )

  if (!session) return null
  if (new Date(session.expires_at) < new Date()) {
    // Session expired, clean it up
    await adapter.execute(`DELETE FROM vibekit_sessions WHERE id = $1`, [sessionId])
    return null
  }

  const user = await adapter.queryOne<User>(
    `SELECT * FROM vibekit_users WHERE id = $1`,
    [session.user_id]
  )

  if (!user) return null
  return { user, session }
}

export async function revokeSession(adapter: DatabaseAdapter, sessionId: string): Promise<void> {
  await adapter.execute(`DELETE FROM vibekit_sessions WHERE id = $1`, [sessionId])
}

export async function revokeAllSessions(adapter: DatabaseAdapter, userId: string): Promise<number> {
  const result = await adapter.execute(
    `DELETE FROM vibekit_sessions WHERE user_id = $1`,
    [userId]
  )
  return result.rowCount
}

export async function getActiveSessions(adapter: DatabaseAdapter, userId: string, currentSessionId?: string): Promise<SessionInfo[]> {
  const { rows } = await adapter.query<Session>(
    `SELECT * FROM vibekit_sessions WHERE user_id = $1 AND expires_at > $2 ORDER BY created_at DESC`,
    [userId, new Date().toISOString()]
  )
  return rows.map(s => ({
    id: s.id,
    user_id: s.user_id,
    ip_address: s.ip_address,
    user_agent: s.user_agent,
    metadata: s.metadata ? JSON.parse(s.metadata) : {},
    expires_at: s.expires_at,
    created_at: s.created_at,
    is_current: s.id === currentSessionId,
  }))
}

/** Alias for validateSession (backwards compat with provider.ts) */
export const verifySession = validateSession

export async function cleanExpiredSessions(adapter: DatabaseAdapter): Promise<number> {
  const result = await adapter.execute(
    `DELETE FROM vibekit_sessions WHERE expires_at < $1`,
    [new Date().toISOString()]
  )
  return result.rowCount
}
