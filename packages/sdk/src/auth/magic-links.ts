import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { createSession } from './session.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import type { User, MagicLinkOptions, MagicLinkResult } from './types.js'

const MAGIC_LINK_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_magic_links (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  redirect_uri TEXT,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_magic_links_email ON vibekit_magic_links(email);
`

let _mlInitialized = false
async function ensureMagicLinkTable(): Promise<void> {
  await ensureAuthTables()
  if (_mlInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of MAGIC_LINK_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _mlInitialized = true
}

export const magicLinks = {
  async send(email: string, options?: MagicLinkOptions): Promise<MagicLinkResult> {
    await ensureMagicLinkTable()
    const adapter = db._getAdapter()
    const normalizedEmail = email.toLowerCase().trim()

    const token = crypto.randomBytes(32).toString('base64url')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const expiresInMinutes = options?.expiresInMinutes ?? 15
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000)

    await adapter.execute(
      `INSERT INTO vibekit_magic_links (id, email, token_hash, redirect_uri, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [crypto.randomUUID(), normalizedEmail, tokenHash, options?.redirectUri || null, expiresAt.toISOString()]
    )

    // In dev mode, log the magic link URL
    const linkUrl = `${options?.redirectUri || '/auth/verify'}?token=${token}&email=${encodeURIComponent(normalizedEmail)}`
    console.log(`\n🔗 Magic Link for ${normalizedEmail}:\n   ${linkUrl}\n   Token: ${token}\n`)

    return {
      success: true,
      message: `Magic link sent to ${normalizedEmail}`,
      expiresAt,
    }
  },

  async verify(email: string, token: string): Promise<{ user: User; token: string; expiresAt: Date; isNewUser: boolean }> {
    await ensureMagicLinkTable()
    const adapter = db._getAdapter()
    const normalizedEmail = email.toLowerCase().trim()
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const record = await adapter.queryOne<{ id: string; expires_at: string; used: number }>(
      `SELECT id, expires_at, used FROM vibekit_magic_links WHERE email = $1 AND token_hash = $2`,
      [normalizedEmail, tokenHash]
    )

    if (!record) throw new Error('Invalid magic link token')
    if (record.used) throw new Error('Magic link already used')
    if (new Date(record.expires_at) < new Date()) throw new Error('Magic link expired')

    // Mark as used
    await adapter.execute(`UPDATE vibekit_magic_links SET used = 1 WHERE id = $1`, [record.id])

    // Find or create user
    let user = await adapter.queryOne<User>(`SELECT * FROM vibekit_users WHERE email = $1`, [normalizedEmail])
    let isNewUser = false

    if (!user) {
      isNewUser = true
      const userId = crypto.randomUUID()
      const now = new Date().toISOString()
      await adapter.execute(
        `INSERT INTO vibekit_users (id, email, email_verified, last_login_at, login_count)
         VALUES ($1, $2, 1, $3, 1)`,
        [userId, normalizedEmail, now]
      )
      user = await adapter.queryOne<User>(`SELECT * FROM vibekit_users WHERE id = $1`, [userId])
      if (!user) throw new Error('Failed to create user')
      await logAuditEvent('signup', { userId, metadata: { method: 'magic_link' } })
    } else {
      await adapter.execute(
        `UPDATE vibekit_users SET email_verified = 1, last_login_at = $1, login_count = COALESCE(login_count, 0) + 1, updated_at = $1 WHERE id = $2`,
        [new Date().toISOString(), user.id]
      )
      await logAuditEvent('login', { userId: user.id, metadata: { method: 'magic_link' } })
    }

    const session = await createSession(adapter, user)
    return { user, token: session.token, expiresAt: session.expiresAt, isNewUser }
  },
}
