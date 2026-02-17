import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { email as emailModule } from '../email/index.js'
import { generateCode, storeCode, validateCode } from './codes.js'
import { createSession, verifySession, revokeSession } from './session.js'
import { getConfig, isLocal } from '../config/index.js'
import type { User, AuthResult, SendCodeResult, ListUsersOptions, ListUsersResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'

const AUTH_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  email_verified INTEGER DEFAULT 0,
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
`

let _authInitialized = false

async function ensureAuthTables(): Promise<void> {
  if (_authInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of AUTH_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _authInitialized = true
}

export const auth = {
  async sendCode(emailAddr: string): Promise<SendCodeResult> {
    await ensureAuthTables()
    const adapter = db._getAdapter()
    const code = generateCode()

    const { expiresAt } = await storeCode(adapter, emailAddr, code)

    if (isLocal()) {
      console.log(`\n  ╔═══════════════════════════════════════╗`)
      console.log(`  ║  Verification code for ${emailAddr}`)
      console.log(`  ║  Code: ${code}`)
      console.log(`  ║  Expires: ${expiresAt.toLocaleTimeString()}`)
      console.log(`  ╚═══════════════════════════════════════╝\n`)
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

  async verifyCode(emailAddr: string, code: string, options?: { ipAddress?: string; userAgent?: string }): Promise<AuthResult> {
    await ensureAuthTables()
    const adapter = db._getAdapter()

    await validateCode(adapter, emailAddr.toLowerCase(), code)

    let user = await adapter.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE email = $1',
      [emailAddr.toLowerCase()]
    )

    if (!user) {
      const config = getConfig()
      const authConfig = typeof config.modules.auth === 'object' ? config.modules.auth : { allowSignup: true }

      if (authConfig.allowSignup === false) {
        throw new VibeKitError('New signups are not allowed.', 'AUTH_SIGNUP_DISABLED', 403)
      }

      const userId = crypto.randomUUID()
      await adapter.execute(
        `INSERT INTO vibekit_users (id, email, email_verified) VALUES ($1, $2, 1)`,
        [userId, emailAddr.toLowerCase()]
      )
      user = await adapter.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
      if (!user) throw new VibeKitError('Failed to create user', 'AUTH_ERROR', 500)
    } else {
      await adapter.execute(
        'UPDATE vibekit_users SET email_verified = 1, updated_at = $1 WHERE id = $2',
        [new Date().toISOString(), user.id]
      )
      user.email_verified = true
    }

    return createSession(adapter, user, options)
  },

  async getUser(request: any): Promise<User | null> {
    await ensureAuthTables()
    const token = extractToken(request)
    if (!token) return null
    return verifySession(db._getAdapter(), token)
  },

  async requireUser(request: any): Promise<User> {
    const user = await auth.getUser(request)
    if (!user) {
      throw new VibeKitError('Authentication required.', 'AUTH_UNAUTHORIZED', 401)
    }
    return user
  },

  async logout(request: any): Promise<void> {
    await ensureAuthTables()
    const user = await auth.getUser(request)
    if (user) {
      await revokeSession(db._getAdapter(), user.id)
    }
  },

  async updateUser(userId: string, updates: Partial<Pick<User, 'name' | 'avatar_url' | 'role' | 'metadata'>>): Promise<User> {
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
      values
    )

    const user = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
    if (!user) throw new VibeKitError('User not found', 'AUTH_USER_NOT_FOUND', 404)
    return user
  },

  async deleteUser(userId: string): Promise<void> {
    await ensureAuthTables()
    await db.execute('DELETE FROM vibekit_sessions WHERE user_id = $1', [userId])
    await db.execute('DELETE FROM vibekit_users WHERE id = $1', [userId])
  },

  async listUsers(options: ListUsersOptions = {}): Promise<ListUsersResult> {
    await ensureAuthTables()
    const { page = 1, limit = 50, role, search, orderBy = 'created_at', order = 'desc' } = options

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

  async getUserById(userId: string): Promise<User | null> {
    await ensureAuthTables()
    return db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
  },

  async getUserByEmail(email: string): Promise<User | null> {
    await ensureAuthTables()
    return db.queryOne<User>('SELECT * FROM vibekit_users WHERE email = $1', [email.toLowerCase()])
  },

  async countUsers(): Promise<number> {
    await ensureAuthTables()
    const result = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM vibekit_users')
    return result?.count ?? 0
  },
}

function extractToken(request: any): string | null {
  const authHeader = request?.headers?.authorization || request?.headers?.get?.('authorization')
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }

  const cookieHeader = request?.headers?.cookie || request?.headers?.get?.('cookie')
  if (cookieHeader && typeof cookieHeader === 'string') {
    const match = cookieHeader.match(/vibekit_session=([^;]+)/)
    if (match) return match[1]
  }

  return null
}
