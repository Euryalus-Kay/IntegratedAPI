import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import type { MfaEnrollResult, MfaChallengeResult, MfaFactor } from './types.js'

const MFA_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_mfa_factors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vibekit_users(id) ON DELETE CASCADE,
  factor_type TEXT NOT NULL DEFAULT 'totp',
  secret TEXT,
  verified INTEGER DEFAULT 0,
  friendly_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vibekit_mfa_backup_codes (
  id TEXT PRIMARY KEY,
  factor_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  used INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mfa_user ON vibekit_mfa_factors(user_id);
`

let _mfaInitialized = false
async function ensureMfaTables(): Promise<void> {
  await ensureAuthTables()
  if (_mfaInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of MFA_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _mfaInitialized = true
}

function generateBackupCodes(count = 10): string[] {
  return Array.from({ length: count }, () =>
    crypto.randomBytes(4).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')
  )
}

// Simple TOTP implementation (RFC 6238)
function generateTOTP(secret: string, timeStep = 30, digits = 6): string {
  const time = Math.floor(Date.now() / 1000 / timeStep)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(time))
  const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex'))
  hmac.update(buffer)
  const hash = hmac.digest()
  const offset = hash[hash.length - 1] & 0xf
  const code = (hash.readUInt32BE(offset) & 0x7fffffff) % Math.pow(10, digits)
  return String(code).padStart(digits, '0')
}

function verifyTOTP(secret: string, code: string, window = 1): boolean {
  const timeStep = 30
  const time = Math.floor(Date.now() / 1000 / timeStep)
  for (let i = -window; i <= window; i++) {
    const t = time + i
    const buffer = Buffer.alloc(8)
    buffer.writeBigUInt64BE(BigInt(t))
    const hmac = crypto.createHmac('sha1', Buffer.from(secret, 'hex'))
    hmac.update(buffer)
    const hash = hmac.digest()
    const offset = hash[hash.length - 1] & 0xf
    const computed = (hash.readUInt32BE(offset) & 0x7fffffff) % 1000000
    if (String(computed).padStart(6, '0') === code) return true
  }
  return false
}

export const mfa = {
  async enroll(userId: string, friendlyName?: string): Promise<MfaEnrollResult> {
    await ensureMfaTables()
    const adapter = db._getAdapter()
    const factorId = crypto.randomUUID()
    const secret = crypto.randomBytes(20).toString('hex')
    const backupCodes = generateBackupCodes()

    await adapter.execute(
      `INSERT INTO vibekit_mfa_factors (id, user_id, factor_type, secret, friendly_name)
       VALUES ($1, $2, 'totp', $3, $4)`,
      [factorId, userId, secret, friendlyName || 'Authenticator App']
    )

    for (const code of backupCodes) {
      const codeHash = crypto.createHash('sha256').update(code).digest('hex')
      await adapter.execute(
        `INSERT INTO vibekit_mfa_backup_codes (id, factor_id, code_hash) VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), factorId, codeHash]
      )
    }

    // Generate QR code URL (otpauth:// URI)
    const user = await adapter.queryOne<{ email: string }>(`SELECT email FROM vibekit_users WHERE id = $1`, [userId])
    const qrCodeUrl = `otpauth://totp/VibeKit:${user?.email || userId}?secret=${secret}&issuer=VibeKit&digits=6&period=30`

    await logAuditEvent('mfa_enroll', { userId, metadata: { factorId, type: 'totp' } })

    return { factorId, secret, qrCodeUrl, backupCodes }
  },

  async verify(userId: string, factorId: string, code: string): Promise<MfaChallengeResult> {
    await ensureMfaTables()
    const adapter = db._getAdapter()

    const factor = await adapter.queryOne<MfaFactor>(
      `SELECT * FROM vibekit_mfa_factors WHERE id = $1 AND user_id = $2`,
      [factorId, userId]
    )
    if (!factor) throw new Error('MFA factor not found')
    if (!factor.secret) throw new Error('MFA factor has no secret')

    // Try TOTP verification
    const verified = verifyTOTP(factor.secret, code)
    if (verified) {
      if (!factor.verified) {
        await adapter.execute(
          `UPDATE vibekit_mfa_factors SET verified = 1, updated_at = $1 WHERE id = $2`,
          [new Date().toISOString(), factorId]
        )
      }
      await logAuditEvent('mfa_verify', { userId, metadata: { factorId, method: 'totp', success: true } })
      return { verified: true, factorId }
    }

    // Try backup code
    const codeHash = crypto.createHash('sha256').update(code).digest('hex')
    const backupCode = await adapter.queryOne<{ id: string }>(
      `SELECT id FROM vibekit_mfa_backup_codes WHERE factor_id = $1 AND code_hash = $2 AND used = 0`,
      [factorId, codeHash]
    )
    if (backupCode) {
      await adapter.execute(`UPDATE vibekit_mfa_backup_codes SET used = 1 WHERE id = $1`, [backupCode.id])
      await logAuditEvent('mfa_verify', { userId, metadata: { factorId, method: 'backup_code', success: true } })
      return { verified: true, factorId }
    }

    await logAuditEvent('mfa_verify', { userId, metadata: { factorId, success: false } })
    return { verified: false, factorId }
  },

  async unenroll(userId: string, factorId: string): Promise<void> {
    await ensureMfaTables()
    const adapter = db._getAdapter()
    await adapter.execute(`DELETE FROM vibekit_mfa_backup_codes WHERE factor_id = $1`, [factorId])
    await adapter.execute(`DELETE FROM vibekit_mfa_factors WHERE id = $1 AND user_id = $2`, [factorId, userId])
    await logAuditEvent('mfa_unenroll', { userId, metadata: { factorId } })
  },

  async listFactors(userId: string): Promise<MfaFactor[]> {
    await ensureMfaTables()
    const { rows } = await db.query<MfaFactor>(
      `SELECT * FROM vibekit_mfa_factors WHERE user_id = $1 ORDER BY created_at`,
      [userId]
    )
    return rows.map(f => ({ ...f, secret: null })) // Don't expose secrets
  },

  async isEnabled(userId: string): Promise<boolean> {
    await ensureMfaTables()
    const factor = await db.queryOne<{ id: string }>(
      `SELECT id FROM vibekit_mfa_factors WHERE user_id = $1 AND verified = 1 LIMIT 1`,
      [userId]
    )
    return !!factor
  },

  async getBackupCodesRemaining(userId: string, factorId: string): Promise<number> {
    await ensureMfaTables()
    const result = await db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM vibekit_mfa_backup_codes WHERE factor_id = $1 AND used = 0`,
      [factorId]
    )
    return result?.cnt ?? 0
  },

  async regenerateBackupCodes(userId: string, factorId: string): Promise<string[]> {
    await ensureMfaTables()
    const adapter = db._getAdapter()
    await adapter.execute(`DELETE FROM vibekit_mfa_backup_codes WHERE factor_id = $1`, [factorId])
    const codes = generateBackupCodes()
    for (const code of codes) {
      const codeHash = crypto.createHash('sha256').update(code).digest('hex')
      await adapter.execute(
        `INSERT INTO vibekit_mfa_backup_codes (id, factor_id, code_hash) VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), factorId, codeHash]
      )
    }
    return codes
  },
}
