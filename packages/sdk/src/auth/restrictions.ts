import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables } from './internals.js'
import type { AuthRestriction, CheckAccessResult, RestrictionType, RestrictionIdentifierType } from './types.js'

const RESTRICTIONS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_auth_restrictions (
  id TEXT PRIMARY KEY,
  list_type TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  identifier TEXT NOT NULL,
  added_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(list_type, identifier_type, identifier)
);
`

let _restrictionsInitialized = false
async function ensureRestrictionsTable(): Promise<void> {
  await ensureAuthTables()
  if (_restrictionsInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of RESTRICTIONS_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _restrictionsInitialized = true
}

export const restrictions = {
  async add(listType: RestrictionType, identifierType: RestrictionIdentifierType, identifier: string, addedBy?: string): Promise<AuthRestriction> {
    await ensureRestrictionsTable()
    const id = crypto.randomUUID()
    await db.execute(
      `INSERT OR IGNORE INTO vibekit_auth_restrictions (id, list_type, identifier_type, identifier, added_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, listType, identifierType, identifier.toLowerCase(), addedBy || null]
    )
    return (await db.queryOne<AuthRestriction>(`SELECT * FROM vibekit_auth_restrictions WHERE id = $1`, [id]))!
  },

  async remove(listType: RestrictionType, identifierType: RestrictionIdentifierType, identifier: string): Promise<void> {
    await ensureRestrictionsTable()
    await db.execute(
      `DELETE FROM vibekit_auth_restrictions WHERE list_type = $1 AND identifier_type = $2 AND identifier = $3`,
      [listType, identifierType, identifier.toLowerCase()]
    )
  },

  async list(listType?: RestrictionType): Promise<AuthRestriction[]> {
    await ensureRestrictionsTable()
    if (listType) {
      const { rows } = await db.query<AuthRestriction>(
        `SELECT * FROM vibekit_auth_restrictions WHERE list_type = $1 ORDER BY created_at`, [listType]
      )
      return rows
    }
    const { rows } = await db.query<AuthRestriction>(`SELECT * FROM vibekit_auth_restrictions ORDER BY list_type, created_at`)
    return rows
  },

  async checkAccess(email: string): Promise<CheckAccessResult> {
    await ensureRestrictionsTable()
    const normalized = email.toLowerCase()
    const domain = normalized.split('@')[1] || ''

    // Check blocklist first
    const blocked = await db.queryOne<AuthRestriction>(
      `SELECT * FROM vibekit_auth_restrictions WHERE list_type = 'blocklist' AND (
        (identifier_type = 'email' AND identifier = $1) OR
        (identifier_type = 'domain' AND identifier = $2)
      ) LIMIT 1`, [normalized, domain]
    )
    if (blocked) return { allowed: false, reason: 'Email or domain is blocked', matchedRule: blocked }

    // Check if allowlist is active
    const allowlistCount = await db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM vibekit_auth_restrictions WHERE list_type = 'allowlist'`
    )
    if (!allowlistCount || allowlistCount.cnt === 0) {
      return { allowed: true, reason: 'No restrictions configured' }
    }

    const allowed = await db.queryOne<AuthRestriction>(
      `SELECT * FROM vibekit_auth_restrictions WHERE list_type = 'allowlist' AND (
        (identifier_type = 'email' AND identifier = $1) OR
        (identifier_type = 'domain' AND identifier = $2)
      ) LIMIT 1`, [normalized, domain]
    )
    if (allowed) return { allowed: true, reason: 'Email or domain is in allowlist', matchedRule: allowed }
    return { allowed: false, reason: 'Email not in allowlist' }
  },
}
