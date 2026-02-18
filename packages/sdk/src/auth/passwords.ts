import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { createSession } from './session.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import type { User, PasswordSignUpResult, PasswordSignInResult } from './types.js'

const PW_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_user_passwords (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES vibekit_users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vibekit_password_resets (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`

let _pwInitialized = false
async function ensurePwTables(): Promise<void> {
  await ensureAuthTables()
  if (_pwInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of PW_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _pwInitialized = true
}

function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
}

export const passwords = {
  async signUp(email: string, password: string, name?: string): Promise<PasswordSignUpResult> {
    await ensurePwTables()
    const adapter = db._getAdapter()
    const normalizedEmail = email.toLowerCase().trim()

    if (password.length < 8) throw new Error('Password must be at least 8 characters')

    const existing = await adapter.queryOne<{ id: string }>(`SELECT id FROM vibekit_users WHERE email = $1`, [normalizedEmail])
    if (existing) throw new Error('A user with this email already exists')

    const userId = crypto.randomUUID()
    const salt = crypto.randomBytes(32).toString('hex')
    const passwordHash = hashPassword(password, salt)
    const now = new Date().toISOString()

    await adapter.execute(
      `INSERT INTO vibekit_users (id, email, name, email_verified, last_login_at, login_count)
       VALUES ($1, $2, $3, 0, $4, 1)`,
      [userId, normalizedEmail, name || null, now]
    )

    await adapter.execute(
      `INSERT INTO vibekit_user_passwords (id, user_id, password_hash, salt) VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), userId, passwordHash, salt]
    )

    const user = await adapter.queryOne<User>(`SELECT * FROM vibekit_users WHERE id = $1`, [userId])
    if (!user) throw new Error('Failed to create user')

    await logAuditEvent('signup', { userId, metadata: { method: 'password' } })
    const session = await createSession(adapter, user)
    return { user, token: session.token, expiresAt: session.expiresAt }
  },

  async signIn(email: string, password: string): Promise<PasswordSignInResult> {
    await ensurePwTables()
    const adapter = db._getAdapter()
    const normalizedEmail = email.toLowerCase().trim()

    const user = await adapter.queryOne<User>(`SELECT * FROM vibekit_users WHERE email = $1`, [normalizedEmail])
    if (!user) throw new Error('Invalid email or password')

    if (user.banned) throw new Error('Account is banned')

    const pwRecord = await adapter.queryOne<{ password_hash: string; salt: string }>(
      `SELECT password_hash, salt FROM vibekit_user_passwords WHERE user_id = $1`, [user.id]
    )
    if (!pwRecord) throw new Error('Invalid email or password')

    const hash = hashPassword(password, pwRecord.salt)
    if (hash !== pwRecord.password_hash) throw new Error('Invalid email or password')

    const now = new Date().toISOString()
    await adapter.execute(
      `UPDATE vibekit_users SET last_login_at = $1, login_count = COALESCE(login_count, 0) + 1, updated_at = $1 WHERE id = $2`,
      [now, user.id]
    )

    await logAuditEvent('login', { userId: user.id, metadata: { method: 'password' } })
    const session = await createSession(adapter, user)
    return { user, token: session.token, expiresAt: session.expiresAt }
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    await ensurePwTables()
    const adapter = db._getAdapter()

    if (newPassword.length < 8) throw new Error('New password must be at least 8 characters')

    const pwRecord = await adapter.queryOne<{ password_hash: string; salt: string }>(
      `SELECT password_hash, salt FROM vibekit_user_passwords WHERE user_id = $1`, [userId]
    )
    if (!pwRecord) throw new Error('No password set for this user')

    const currentHash = hashPassword(currentPassword, pwRecord.salt)
    if (currentHash !== pwRecord.password_hash) throw new Error('Current password is incorrect')

    const newSalt = crypto.randomBytes(32).toString('hex')
    const newHash = hashPassword(newPassword, newSalt)
    await adapter.execute(
      `UPDATE vibekit_user_passwords SET password_hash = $1, salt = $2, updated_at = $3 WHERE user_id = $4`,
      [newHash, newSalt, new Date().toISOString(), userId]
    )
    await logAuditEvent('password_change', { userId })
  },

  async requestReset(email: string): Promise<{ success: boolean; expiresAt: Date }> {
    await ensurePwTables()
    const adapter = db._getAdapter()
    const normalizedEmail = email.toLowerCase().trim()
    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

    await adapter.execute(
      `INSERT INTO vibekit_password_resets (id, email, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), normalizedEmail, tokenHash, expiresAt.toISOString()]
    )
    console.log(`\n🔑 Password reset token for ${normalizedEmail}: ${token}\n`)
    return { success: true, expiresAt }
  },

  async resetPassword(email: string, token: string, newPassword: string): Promise<void> {
    await ensurePwTables()
    const adapter = db._getAdapter()
    const normalizedEmail = email.toLowerCase().trim()

    if (newPassword.length < 8) throw new Error('Password must be at least 8 characters')

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const record = await adapter.queryOne<{ id: string; expires_at: string; used: number }>(
      `SELECT * FROM vibekit_password_resets WHERE email = $1 AND token_hash = $2 AND used = 0`,
      [normalizedEmail, tokenHash]
    )

    if (!record) throw new Error('Invalid reset token')
    if (new Date(record.expires_at) < new Date()) throw new Error('Reset token expired')

    await adapter.execute(`UPDATE vibekit_password_resets SET used = 1 WHERE id = $1`, [record.id])

    const user = await adapter.queryOne<User>(`SELECT * FROM vibekit_users WHERE email = $1`, [normalizedEmail])
    if (!user) throw new Error('User not found')

    const salt = crypto.randomBytes(32).toString('hex')
    const hash = hashPassword(newPassword, salt)

    const existing = await adapter.queryOne<{ id: string }>(
      `SELECT id FROM vibekit_user_passwords WHERE user_id = $1`, [user.id]
    )

    if (existing) {
      await adapter.execute(
        `UPDATE vibekit_user_passwords SET password_hash = $1, salt = $2, updated_at = $3 WHERE user_id = $4`,
        [hash, salt, new Date().toISOString(), user.id]
      )
    } else {
      await adapter.execute(
        `INSERT INTO vibekit_user_passwords (id, user_id, password_hash, salt) VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), user.id, hash, salt]
      )
    }

    await logAuditEvent('password_reset', { userId: user.id })
  },

  async hasPassword(userId: string): Promise<boolean> {
    await ensurePwTables()
    const record = await db.queryOne<{ id: string }>(
      `SELECT id FROM vibekit_user_passwords WHERE user_id = $1`, [userId]
    )
    return !!record
  },
}
