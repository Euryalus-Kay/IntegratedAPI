import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { email as emailModule } from '../email/index.js'
import { generateCode, storeCode, validateCode } from './codes.js'
import { createSession, verifySession, revokeSession } from './session.js'
import { getConfig, isLocal } from '../config/index.js'
import type { User, AuthResult, SendCodeResult, ListUsersOptions, ListUsersResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'

// ---------------------------------------------------------------------------
// Audit log types
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'login'
  | 'logout'
  | 'code_sent'
  | 'role_change'
  | 'ban'
  | 'unban'
  | 'signup'
  | 'session_revoke'
  | 'user_update'
  | 'user_delete'

export interface AuditLogEntry {
  id: string
  user_id: string | null
  action: AuditAction
  metadata: Record<string, unknown>
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface AuditLogOptions {
  userId?: string
  action?: AuditAction
  limit?: number
  offset?: number
  since?: string | Date
  until?: string | Date
}

export interface ActiveSession {
  id: string
  user_id: string
  ip_address: string | null
  user_agent: string | null
  expires_at: string
  created_at: string
}

// ---------------------------------------------------------------------------
// SQL: table definitions
// ---------------------------------------------------------------------------

const AUTH_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  email_verified INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0,
  banned_reason TEXT,
  last_login_at TEXT,
  login_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vibekit_auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON vibekit_auth_codes(email);

CREATE TABLE IF NOT EXISTS vibekit_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vibekit_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON vibekit_sessions(user_id);

CREATE TABLE IF NOT EXISTS vibekit_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON vibekit_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON vibekit_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON vibekit_audit_log(created_at);
`

// ---------------------------------------------------------------------------
// Migration: add columns that may not exist yet on older databases
// ---------------------------------------------------------------------------

const MIGRATION_COLUMNS_SQL = [
  "ALTER TABLE vibekit_users ADD COLUMN banned INTEGER DEFAULT 0",
  "ALTER TABLE vibekit_users ADD COLUMN banned_reason TEXT",
  "ALTER TABLE vibekit_users ADD COLUMN last_login_at TEXT",
  "ALTER TABLE vibekit_users ADD COLUMN login_count INTEGER DEFAULT 0",
]

let _authInitialized = false

async function ensureAuthTables(): Promise<void> {
  if (_authInitialized) return
  const adapter = db._getAdapter()

  // Create tables
  for (const stmt of AUTH_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }

  // Safely add new columns (ignore errors if they already exist)
  for (const sql of MIGRATION_COLUMNS_SQL) {
    try {
      await adapter.execute(sql)
    } catch {
      // Column already exists -- this is expected on subsequent runs
    }
  }

  _authInitialized = true
}

// ---------------------------------------------------------------------------
// Audit logging helper
// ---------------------------------------------------------------------------

async function logAuditEvent(
  action: AuditAction,
  options: {
    userId?: string | null
    metadata?: Record<string, unknown>
    ipAddress?: string | null
    userAgent?: string | null
  } = {},
): Promise<void> {
  try {
    const adapter = db._getAdapter()
    const id = crypto.randomUUID()
    await adapter.execute(
      `INSERT INTO vibekit_audit_log (id, user_id, action, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        options.userId ?? null,
        action,
        JSON.stringify(options.metadata ?? {}),
        options.ipAddress ?? null,
        options.userAgent ?? null,
      ],
    )
  } catch {
    // Audit logging should never break the main flow. If the table is
    // unreachable we silently swallow the error. In production you would
    // want to forward this to an external logger.
  }
}

// ---------------------------------------------------------------------------
// Auth provider
// ---------------------------------------------------------------------------

export const auth = {
  /**
   * Send a one-time verification code to the given email address.
   *
   * In local development the code is printed to the terminal. In production
   * it is sent via the configured email provider.
   */
  async sendCode(emailAddr: string): Promise<SendCodeResult> {
    await ensureAuthTables()
    const adapter = db._getAdapter()
    const code = generateCode()

    const { expiresAt } = await storeCode(adapter, emailAddr, code)

    // Audit: code_sent
    await logAuditEvent('code_sent', {
      metadata: { email: emailAddr },
    })

    if (isLocal()) {
      console.log(`\n  \u2554${'═'.repeat(39)}\u2557`)
      console.log(`  \u2551  Verification code for ${emailAddr}`)
      console.log(`  \u2551  Code: ${code}`)
      console.log(`  \u2551  Expires: ${expiresAt.toLocaleTimeString()}`)
      console.log(`  \u255A${'═'.repeat(39)}\u255D\n`)
    } else {
      await emailModule.send({
        to: emailAddr,
        template: 'verification-code',
        data: { code, expiresInMinutes: 10 },
      })
    }

    return {
      success: true,
      message: `Verification code sent to ${emailAddr}`,
      expiresAt,
    }
  },

  /**
   * Verify a one-time code and create an authenticated session.
   *
   * If the email does not correspond to an existing user, a new account is
   * created (unless signup is disabled in the config).
   *
   * Throws if the user is banned.
   */
  async verifyCode(
    emailAddr: string,
    code: string,
    options?: { ipAddress?: string; userAgent?: string },
  ): Promise<AuthResult> {
    await ensureAuthTables()
    const adapter = db._getAdapter()

    await validateCode(adapter, emailAddr.toLowerCase(), code)

    let user = await adapter.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE email = $1',
      [emailAddr.toLowerCase()],
    )

    if (!user) {
      // ------ New user signup ------
      const config = getConfig()
      const authConfig =
        typeof config.modules.auth === 'object'
          ? config.modules.auth
          : { allowSignup: true }

      if (authConfig.allowSignup === false) {
        throw new VibeKitError(
          'New signups are not allowed. Contact the administrator if you believe this is a mistake.',
          'AUTH_SIGNUP_DISABLED',
          403,
        )
      }

      const userId = crypto.randomUUID()
      const now = new Date().toISOString()

      await adapter.execute(
        `INSERT INTO vibekit_users (id, email, email_verified, last_login_at, login_count)
         VALUES ($1, $2, 1, $3, 1)`,
        [userId, emailAddr.toLowerCase(), now],
      )

      user = await adapter.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
      if (!user) {
        throw new VibeKitError(
          'Failed to create user account. Please try again.',
          'AUTH_ERROR',
          500,
        )
      }

      // Audit: signup
      await logAuditEvent('signup', {
        userId: user.id,
        metadata: { email: emailAddr.toLowerCase() },
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
      })
    } else {
      // ------ Existing user ------

      // Check ban status
      if ((user as any).banned === 1 || (user as any).banned === true) {
        const reason = (user as any).banned_reason
        const message = reason
          ? `Your account has been suspended: ${reason}`
          : 'Your account has been suspended. Contact the administrator for more information.'
        throw new VibeKitError(message, 'AUTH_USER_BANNED', 403)
      }

      // Update email_verified, last_login_at, login_count
      const now = new Date().toISOString()
      await adapter.execute(
        `UPDATE vibekit_users
         SET email_verified = 1,
             last_login_at = $1,
             login_count = COALESCE(login_count, 0) + 1,
             updated_at = $1
         WHERE id = $2`,
        [now, user.id],
      )
      user.email_verified = true
    }

    // Audit: login
    await logAuditEvent('login', {
      userId: user.id,
      metadata: { email: emailAddr.toLowerCase() },
      ipAddress: options?.ipAddress,
      userAgent: options?.userAgent,
    })

    return createSession(adapter, user, options)
  },

  /**
   * Extract and verify the session token from the request, returning the
   * associated user or `null` if the request is unauthenticated.
   */
  async getUser(request: any): Promise<User | null> {
    await ensureAuthTables()
    const token = extractToken(request)
    if (!token) return null
    return verifySession(db._getAdapter(), token)
  },

  /**
   * Like {@link getUser} but throws a 401 error when unauthenticated.
   */
  async requireUser(request: any): Promise<User> {
    const user = await auth.getUser(request)
    if (!user) {
      throw new VibeKitError(
        'Authentication required. Please log in and include a valid session token.',
        'AUTH_UNAUTHORIZED',
        401,
      )
    }
    return user
  },

  /**
   * Log the current user out by revoking their session.
   */
  async logout(request: any): Promise<void> {
    await ensureAuthTables()
    const user = await auth.getUser(request)
    if (user) {
      await revokeSession(db._getAdapter(), user.id)
      await logAuditEvent('logout', {
        userId: user.id,
      })
    }
  },

  /**
   * Update specific fields on a user record.
   */
  async updateUser(
    userId: string,
    updates: Partial<Pick<User, 'name' | 'avatar_url' | 'role' | 'metadata'>>,
  ): Promise<User> {
    await ensureAuthTables()
    const fields: string[] = []
    const values: unknown[] = []
    let paramIdx = 1

    for (const [key, value] of Object.entries(updates)) {
      if (key === 'metadata') {
        fields.push(`metadata = $${paramIdx}`)
        values.push(JSON.stringify(value))
      } else {
        fields.push(`"${key}" = $${paramIdx}`)
        values.push(value)
      }
      paramIdx++
    }

    fields.push(`updated_at = $${paramIdx}`)
    values.push(new Date().toISOString())
    paramIdx++

    values.push(userId)
    await db.execute(
      `UPDATE vibekit_users SET ${fields.join(', ')} WHERE id = $${paramIdx}`,
      values,
    )

    const user = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
    if (!user) {
      throw new VibeKitError(
        'User not found. The account may have been deleted.',
        'AUTH_USER_NOT_FOUND',
        404,
      )
    }

    await logAuditEvent('user_update', {
      userId,
      metadata: { updatedFields: Object.keys(updates) },
    })

    return user
  },

  /**
   * Permanently delete a user and all associated sessions.
   */
  async deleteUser(userId: string): Promise<void> {
    await ensureAuthTables()
    await db.execute('DELETE FROM vibekit_sessions WHERE user_id = $1', [userId])
    await db.execute('DELETE FROM vibekit_users WHERE id = $1', [userId])

    await logAuditEvent('user_delete', {
      userId,
    })
  },

  /**
   * List users with pagination, filtering, and search support.
   */
  async listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
    await ensureAuthTables()
    const {
      page = 1,
      limit = 50,
      role,
      search,
      orderBy = 'created_at',
      order = 'desc',
    } = options

    let countSql = 'SELECT COUNT(*) as total FROM vibekit_users WHERE 1=1'
    let querySql = 'SELECT * FROM vibekit_users WHERE 1=1'
    const params: unknown[] = []
    let paramIdx = 1

    if (role) {
      countSql += ` AND role = $${paramIdx}`
      querySql += ` AND role = $${paramIdx}`
      params.push(role)
      paramIdx++
    }

    if (search) {
      countSql += ` AND (email LIKE $${paramIdx} OR name LIKE $${paramIdx})`
      querySql += ` AND (email LIKE $${paramIdx} OR name LIKE $${paramIdx})`
      params.push(`%${search}%`)
      paramIdx++
    }

    const countResult = await db.queryOne<{ total: number }>(countSql, params)
    const total = countResult?.total ?? 0

    querySql += ` ORDER BY "${orderBy}" ${order.toUpperCase()}`
    querySql += ` LIMIT ${limit} OFFSET ${(page - 1) * limit}`

    const { rows } = await db.query<User>(querySql, params)

    return {
      users: rows,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    }
  },

  /**
   * Retrieve a single user by their ID.
   */
  async getUserById(userId: string): Promise<User | null> {
    await ensureAuthTables()
    return db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
  },

  /**
   * Retrieve a single user by their email address.
   */
  async getUserByEmail(email: string): Promise<User | null> {
    await ensureAuthTables()
    return db.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE email = $1',
      [email.toLowerCase()],
    )
  },

  /**
   * Return the total number of users.
   */
  async countUsers(): Promise<number> {
    await ensureAuthTables()
    const result = await db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM vibekit_users',
    )
    return result?.count ?? 0
  },

  // =========================================================================
  // New methods
  // =========================================================================

  /**
   * Revoke all active sessions for a user, forcing them to re-authenticate
   * on every device.
   */
  async revokeAllSessions(userId: string): Promise<void> {
    await ensureAuthTables()
    const adapter = db._getAdapter()
    await adapter.execute('DELETE FROM vibekit_sessions WHERE user_id = $1', [userId])

    await logAuditEvent('session_revoke', {
      userId,
      metadata: { scope: 'all' },
    })
  },

  /**
   * List all active (non-expired) sessions for a given user. Useful for
   * "active devices" UIs.
   */
  async getActiveSessions(userId: string): Promise<ActiveSession[]> {
    await ensureAuthTables()
    const now = new Date().toISOString()
    const { rows } = await db.query<ActiveSession>(
      `SELECT id, user_id, ip_address, user_agent, expires_at, created_at
       FROM vibekit_sessions
       WHERE user_id = $1 AND expires_at > $2
       ORDER BY created_at DESC`,
      [userId, now],
    )
    return rows
  },

  /**
   * Set the role for a user and log the change.
   */
  async setRole(userId: string, role: string): Promise<User> {
    await ensureAuthTables()

    const user = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
    if (!user) {
      throw new VibeKitError(
        'User not found. Cannot assign role to a non-existent user.',
        'AUTH_USER_NOT_FOUND',
        404,
      )
    }

    const previousRole = user.role

    await db.execute(
      'UPDATE vibekit_users SET role = $1, updated_at = $2 WHERE id = $3',
      [role, new Date().toISOString(), userId],
    )

    await logAuditEvent('role_change', {
      userId,
      metadata: { previousRole, newRole: role },
    })

    return { ...user, role }
  },

  /**
   * Check whether the authenticated user in the given request holds the
   * specified role. Returns `false` if the request is unauthenticated.
   */
  async hasRole(request: any, role: string): Promise<boolean> {
    const user = await auth.getUser(request)
    if (!user) return false
    return user.role === role
  },

  /**
   * Ban a user, immediately revoking all their sessions.
   *
   * @param userId  - The user to ban.
   * @param reason  - An optional human-readable reason stored on the user record.
   */
  async banUser(userId: string, reason?: string): Promise<User> {
    await ensureAuthTables()

    const user = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
    if (!user) {
      throw new VibeKitError(
        'User not found. Cannot ban a non-existent user.',
        'AUTH_USER_NOT_FOUND',
        404,
      )
    }

    const now = new Date().toISOString()
    await db.execute(
      `UPDATE vibekit_users SET banned = 1, banned_reason = $1, updated_at = $2 WHERE id = $3`,
      [reason ?? null, now, userId],
    )

    // Revoke all sessions immediately so the ban takes effect right away
    await db.execute('DELETE FROM vibekit_sessions WHERE user_id = $1', [userId])

    await logAuditEvent('ban', {
      userId,
      metadata: { reason: reason ?? null },
    })

    return {
      ...user,
      banned: true as any,
      banned_reason: reason ?? null,
    } as User
  },

  /**
   * Remove the ban flag from a user, allowing them to log in again.
   */
  async unbanUser(userId: string): Promise<User> {
    await ensureAuthTables()

    const user = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
    if (!user) {
      throw new VibeKitError(
        'User not found. Cannot unban a non-existent user.',
        'AUTH_USER_NOT_FOUND',
        404,
      )
    }

    const now = new Date().toISOString()
    await db.execute(
      `UPDATE vibekit_users SET banned = 0, banned_reason = NULL, updated_at = $1 WHERE id = $2`,
      [now, userId],
    )

    await logAuditEvent('unban', {
      userId,
    })

    return {
      ...user,
      banned: false as any,
      banned_reason: null,
    } as User
  },

  /**
   * Query the audit log with optional filters.
   *
   * @example
   * ```ts
   * // Last 50 events for a specific user
   * const log = await auth.getAuditLog({ userId: 'abc', limit: 50 })
   *
   * // All login events in the last 24 hours
   * const logins = await auth.getAuditLog({
   *   action: 'login',
   *   since: new Date(Date.now() - 86_400_000),
   * })
   * ```
   */
  async getAuditLog(options: AuditLogOptions = {}): Promise<AuditLogEntry[]> {
    await ensureAuthTables()

    const {
      userId,
      action,
      limit = 100,
      offset = 0,
      since,
      until,
    } = options

    let sql = 'SELECT * FROM vibekit_audit_log WHERE 1=1'
    const params: unknown[] = []
    let paramIdx = 1

    if (userId) {
      sql += ` AND user_id = $${paramIdx}`
      params.push(userId)
      paramIdx++
    }

    if (action) {
      sql += ` AND action = $${paramIdx}`
      params.push(action)
      paramIdx++
    }

    if (since) {
      const sinceStr = since instanceof Date ? since.toISOString() : since
      sql += ` AND created_at >= $${paramIdx}`
      params.push(sinceStr)
      paramIdx++
    }

    if (until) {
      const untilStr = until instanceof Date ? until.toISOString() : until
      sql += ` AND created_at <= $${paramIdx}`
      params.push(untilStr)
      paramIdx++
    }

    sql += ` ORDER BY created_at DESC`
    sql += ` LIMIT ${limit} OFFSET ${offset}`

    const { rows } = await db.query<AuditLogEntry>(sql, params)

    // Parse metadata from JSON string to object
    return rows.map((row) => ({
      ...row,
      metadata:
        typeof row.metadata === 'string'
          ? JSON.parse(row.metadata as string)
          : (row.metadata ?? {}),
    }))
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractToken(request: any): string | null {
  // Support plain object headers (Express / Node) and Headers API (Fetch / Hono)
  const authHeader =
    request?.headers?.authorization || request?.headers?.get?.('authorization')
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  const cookieHeader =
    request?.headers?.cookie || request?.headers?.get?.('cookie')
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/vibekit_session=([^;]+)/)
    if (match) return match[1]
  }

  return null
}
