// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Auth — Anonymous Authentication
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import { createSession } from './session.js'
import type { User, AuthResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface AnonymousSignInOptions {
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export interface AnonymousConvertResult {
  user: User
  token: string
  expiresAt: Date
}

// ── Migration ────────────────────────────────────────────────────────────────

const ANON_COLUMN_SQL = [
  'ALTER TABLE vibekit_users ADD COLUMN is_anonymous INTEGER DEFAULT 0',
]

let _anonInitialized = false

async function ensureAnonColumn(): Promise<void> {
  await ensureAuthTables()
  if (_anonInitialized) return
  const adapter = db._getAdapter()
  for (const sql of ANON_COLUMN_SQL) {
    try {
      await adapter.execute(sql)
    } catch {
      // Column already exists
    }
  }
  _anonInitialized = true
}

// ── Module ───────────────────────────────────────────────────────────────────

export const anonymous = {
  /**
   * Create an anonymous user with an auto-generated ID and return an
   * authenticated session. The user is stored in vibekit_users with
   * `is_anonymous = 1` and a placeholder email.
   */
  async signIn(options?: AnonymousSignInOptions): Promise<AuthResult> {
    await ensureAnonColumn()
    const adapter = db._getAdapter()
    const userId = crypto.randomUUID()
    const placeholderEmail = `anon-${userId}@anonymous.vibekit.local`
    const now = new Date().toISOString()
    const metadata = JSON.stringify(options?.metadata ?? {})

    await adapter.execute(
      `INSERT INTO vibekit_users (id, email, is_anonymous, metadata, last_login_at, login_count, created_at, updated_at)
       VALUES ($1, $2, 1, $3, $4, 1, $4, $4)`,
      [userId, placeholderEmail, metadata, now],
    )

    const user = await adapter.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE id = $1',
      [userId],
    )
    if (!user) {
      throw new VibeKitError('Failed to create anonymous user.', 'AUTH_ERROR', 500)
    }

    await logAuditEvent('signup', {
      userId: user.id,
      metadata: { anonymous: true },
      ip: options?.ipAddress,
      userAgent: options?.userAgent,
    })

    return createSession(adapter, user, {
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
    })
  },

  /**
   * Convert an anonymous user to a permanent account by assigning a real
   * email and hashed password. Returns a fresh session for the converted user.
   */
  async convert(
    userId: string,
    email: string,
    password: string,
  ): Promise<AnonymousConvertResult> {
    await ensureAnonColumn()
    const adapter = db._getAdapter()

    const user = await adapter.queryOne<User & { is_anonymous?: number }>(
      'SELECT * FROM vibekit_users WHERE id = $1',
      [userId],
    )
    if (!user) {
      throw new VibeKitError('Anonymous user not found.', 'AUTH_USER_NOT_FOUND', 404)
    }
    if (!user.is_anonymous) {
      throw new VibeKitError('User is not anonymous; cannot convert.', 'AUTH_ERROR', 400)
    }

    const normalizedEmail = email.toLowerCase().trim()
    const existing = await adapter.queryOne<{ id: string }>(
      'SELECT id FROM vibekit_users WHERE email = $1',
      [normalizedEmail],
    )
    if (existing) {
      throw new VibeKitError(
        `Email "${normalizedEmail}" is already in use.`,
        'AUTH_ERROR',
        409,
      )
    }

    const passwordHash = crypto.createHash('sha256').update(password).digest('hex')
    const now = new Date().toISOString()

    await adapter.execute(
      `UPDATE vibekit_users
       SET email = $1, is_anonymous = 0, email_verified = 0, metadata = json_set(COALESCE(metadata, '{}'), '$.password_hash', $2), updated_at = $3
       WHERE id = $4`,
      [normalizedEmail, passwordHash, now, userId],
    )

    const updated = await adapter.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE id = $1',
      [userId],
    )
    if (!updated) {
      throw new VibeKitError('Failed to retrieve converted user.', 'AUTH_ERROR', 500)
    }

    await logAuditEvent('user_update', {
      userId,
      metadata: { action: 'anonymous_convert', email: normalizedEmail },
    })

    return createSession(adapter, updated)
  },

  /**
   * Check whether a given user ID corresponds to an anonymous user.
   */
  async isAnonymous(userId: string): Promise<boolean> {
    await ensureAnonColumn()
    const row = await db.queryOne<{ is_anonymous: number }>(
      'SELECT is_anonymous FROM vibekit_users WHERE id = $1',
      [userId],
    )
    return row?.is_anonymous === 1
  },

  /**
   * Remove anonymous users older than the specified duration. The `olderThan`
   * argument is a number of milliseconds (e.g. 7 * 24 * 60 * 60 * 1000 for
   * 7 days). Returns the number of deleted rows.
   */
  async cleanup(olderThan: number): Promise<number> {
    await ensureAnonColumn()
    const cutoff = new Date(Date.now() - olderThan).toISOString()

    // Delete sessions first to satisfy FK constraints
    await db.execute(
      `DELETE FROM vibekit_sessions WHERE user_id IN (
         SELECT id FROM vibekit_users WHERE is_anonymous = 1 AND created_at < $1
       )`,
      [cutoff],
    )

    const result = await db.execute(
      'DELETE FROM vibekit_users WHERE is_anonymous = 1 AND created_at < $1',
      [cutoff],
    )

    return result.rowCount ?? 0
  },
}
