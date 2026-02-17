import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { DatabaseAdapter } from '../db/types.js'
import { VibeKitError } from '../utils/errors.js'

const CODE_EXPIRY_MINUTES = 10
const MAX_ATTEMPTS = 5
const MAX_CODES_PER_WINDOW = 3
const RATE_WINDOW_MINUTES = 15

export function generateCode(): string {
  const max = 999999
  const min = 100000
  let code: number
  do {
    code = crypto.randomInt(0, 1000000)
  } while (code < min)
  return code.toString()
}

export async function hashCode(code: string): Promise<string> {
  return bcrypt.hash(code, 10)
}

export async function verifyCodeHash(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash)
}

export async function storeCode(db: DatabaseAdapter, email: string, code: string): Promise<{ expiresAt: Date }> {
  const windowStart = new Date(Date.now() - RATE_WINDOW_MINUTES * 60 * 1000).toISOString()
  const { rows } = await db.query<{ count: number }>(
    `SELECT COUNT(*) as count FROM vibekit_auth_codes WHERE email = $1 AND created_at > $2`,
    [email.toLowerCase(), windowStart]
  )

  if (rows[0] && rows[0].count >= MAX_CODES_PER_WINDOW) {
    throw new VibeKitError(
      'Too many verification codes requested. Try again in a few minutes.',
      'AUTH_RATE_LIMITED',
      429
    )
  }

  const codeHash = await hashCode(code)
  const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000)
  const id = crypto.randomUUID()

  await db.execute(
    `INSERT INTO vibekit_auth_codes (id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [id, email.toLowerCase(), codeHash, expiresAt.toISOString()]
  )

  return { expiresAt }
}

export async function validateCode(db: DatabaseAdapter, email: string, code: string): Promise<boolean> {
  const record = await db.queryOne<{
    id: string
    code_hash: string
    expires_at: string
    used: number
    attempts: number
  }>(
    `SELECT * FROM vibekit_auth_codes
     WHERE email = $1 AND used = 0
     ORDER BY created_at DESC
     LIMIT 1`,
    [email.toLowerCase()]
  )

  if (!record) {
    throw new VibeKitError('No verification code found. Request a new code.', 'AUTH_CODE_INVALID', 400)
  }

  if (new Date(record.expires_at) < new Date()) {
    throw new VibeKitError('Verification code has expired. Request a new code.', 'AUTH_CODE_EXPIRED', 400)
  }

  if (record.attempts >= MAX_ATTEMPTS) {
    throw new VibeKitError(
      'Too many incorrect attempts. Request a new code.',
      'AUTH_CODE_MAX_ATTEMPTS',
      400
    )
  }

  await db.execute(
    'UPDATE vibekit_auth_codes SET attempts = attempts + 1 WHERE id = $1',
    [record.id]
  )

  const valid = await verifyCodeHash(code, record.code_hash)
  if (!valid) {
    throw new VibeKitError('Invalid verification code.', 'AUTH_CODE_INVALID', 400)
  }

  await db.execute('UPDATE vibekit_auth_codes SET used = 1 WHERE id = $1', [record.id])

  return true
}
