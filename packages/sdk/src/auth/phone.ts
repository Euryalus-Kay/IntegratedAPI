import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { createSession } from './session.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import type { User, PhoneVerifyResult } from './types.js'

const PHONE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_phone_codes (
  id TEXT PRIMARY KEY,
  phone_number TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_phone_codes ON vibekit_phone_codes(phone_number);
`

let _phoneInitialized = false
async function ensurePhoneTable(): Promise<void> {
  await ensureAuthTables()
  if (_phoneInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of PHONE_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _phoneInitialized = true
}

export const phone = {
  async sendCode(phoneNumber: string): Promise<{ success: boolean; message: string; expiresAt: Date }> {
    await ensurePhoneTable()
    const adapter = db._getAdapter()
    const normalized = phoneNumber.replace(/\s+/g, '').trim()
    const code = String(Math.floor(100000 + Math.random() * 900000))
    const codeHash = crypto.createHash('sha256').update(code).digest('hex')
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await adapter.execute(
      `INSERT INTO vibekit_phone_codes (id, phone_number, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [crypto.randomUUID(), normalized, codeHash, expiresAt.toISOString()]
    )

    console.log(`\n📱 Phone verification code for ${normalized}: ${code}\n`)

    return { success: true, message: `Verification code sent to ${normalized}`, expiresAt }
  },

  async verifyCode(phoneNumber: string, code: string): Promise<PhoneVerifyResult> {
    await ensurePhoneTable()
    const adapter = db._getAdapter()
    const normalized = phoneNumber.replace(/\s+/g, '').trim()
    const codeHash = crypto.createHash('sha256').update(code).digest('hex')

    const record = await adapter.queryOne<{ id: string; expires_at: string; used: number; attempts: number }>(
      `SELECT * FROM vibekit_phone_codes WHERE phone_number = $1 AND code_hash = $2 AND used = 0 ORDER BY created_at DESC LIMIT 1`,
      [normalized, codeHash]
    )

    if (!record) throw new Error('Invalid verification code')
    if (new Date(record.expires_at) < new Date()) throw new Error('Verification code expired')
    if (record.attempts >= 5) throw new Error('Too many attempts')

    await adapter.execute(`UPDATE vibekit_phone_codes SET used = 1 WHERE id = $1`, [record.id])

    let user = await adapter.queryOne<User>(`SELECT * FROM vibekit_users WHERE phone = $1`, [normalized])
    let isNewUser = false

    if (!user) {
      isNewUser = true
      const userId = crypto.randomUUID()
      const now = new Date().toISOString()
      await adapter.execute(
        `INSERT INTO vibekit_users (id, email, phone, phone_verified, last_login_at, login_count)
         VALUES ($1, $2, $3, 1, $4, 1)`,
        [userId, `phone_${normalized}@vibekit.dev`, normalized, now]
      )
      user = await adapter.queryOne<User>(`SELECT * FROM vibekit_users WHERE id = $1`, [userId])
      if (!user) throw new Error('Failed to create user')
      await logAuditEvent('signup', { userId, metadata: { method: 'phone' } })
    } else {
      await adapter.execute(
        `UPDATE vibekit_users SET phone_verified = 1, last_login_at = $1, login_count = COALESCE(login_count, 0) + 1, updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), user.id]
      )
      await logAuditEvent('login', { userId: user.id, metadata: { method: 'phone' } })
    }

    const session = await createSession(adapter, user)
    return { user, token: session.token, expiresAt: session.expiresAt, isNewUser }
  },
}
