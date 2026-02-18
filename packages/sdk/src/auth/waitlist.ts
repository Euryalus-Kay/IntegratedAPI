import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables } from './internals.js'
import type { WaitlistEntry, WaitlistAddOptions, WaitlistListOptions, WaitlistListResult, WaitlistStats, WaitlistStatus } from './types.js'

const WAITLIST_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_waitlist (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  status TEXT DEFAULT 'pending',
  metadata TEXT DEFAULT '{}',
  reason TEXT,
  approved_at TEXT,
  rejected_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`

let _waitlistInitialized = false
async function ensureWaitlistTable(): Promise<void> {
  await ensureAuthTables()
  if (_waitlistInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of WAITLIST_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _waitlistInitialized = true
}

export const waitlist = {
  async add(email: string, options?: WaitlistAddOptions): Promise<WaitlistEntry> {
    await ensureWaitlistTable()
    const id = crypto.randomUUID()
    await db.execute(
      `INSERT OR IGNORE INTO vibekit_waitlist (id, email, metadata) VALUES ($1, $2, $3)`,
      [id, email.toLowerCase(), JSON.stringify(options?.metadata || {})]
    )
    return (await db.queryOne<WaitlistEntry>(`SELECT * FROM vibekit_waitlist WHERE email = $1`, [email.toLowerCase()]))!
  },

  async approve(email: string, reason?: string): Promise<WaitlistEntry> {
    await ensureWaitlistTable()
    await db.execute(
      `UPDATE vibekit_waitlist SET status = 'approved', reason = $1, approved_at = $2 WHERE email = $3`,
      [reason || null, new Date().toISOString(), email.toLowerCase()]
    )
    return (await db.queryOne<WaitlistEntry>(`SELECT * FROM vibekit_waitlist WHERE email = $1`, [email.toLowerCase()]))!
  },

  async reject(email: string, reason?: string): Promise<WaitlistEntry> {
    await ensureWaitlistTable()
    await db.execute(
      `UPDATE vibekit_waitlist SET status = 'rejected', reason = $1, rejected_at = $2 WHERE email = $3`,
      [reason || null, new Date().toISOString(), email.toLowerCase()]
    )
    return (await db.queryOne<WaitlistEntry>(`SELECT * FROM vibekit_waitlist WHERE email = $1`, [email.toLowerCase()]))!
  },

  async remove(email: string): Promise<void> {
    await ensureWaitlistTable()
    await db.execute(`DELETE FROM vibekit_waitlist WHERE email = $1`, [email.toLowerCase()])
  },

  async getStatus(email: string): Promise<WaitlistStatus | null> {
    await ensureWaitlistTable()
    const entry = await db.queryOne<{ status: WaitlistStatus }>(`SELECT status FROM vibekit_waitlist WHERE email = $1`, [email.toLowerCase()])
    return entry?.status ?? null
  },

  async list(options?: WaitlistListOptions): Promise<WaitlistListResult> {
    await ensureWaitlistTable()
    const limit = options?.limit ?? 20
    const page = options?.page ?? 1
    const offset = (page - 1) * limit

    let where = ''
    const params: unknown[] = []
    if (options?.status) { where = `WHERE status = $1`; params.push(options.status) }

    const cnt = await db.queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM vibekit_waitlist ${where}`, params)
    const total = cnt?.cnt ?? 0

    const { rows } = await db.query<WaitlistEntry>(
      `SELECT * FROM vibekit_waitlist ${where} ORDER BY created_at ASC LIMIT ${limit} OFFSET ${offset}`, params
    )
    return { entries: rows, total, page, limit, totalPages: Math.ceil(total / limit) }
  },

  async stats(): Promise<WaitlistStats> {
    await ensureWaitlistTable()
    const result = await db.queryOne<{ total: number; pending: number; approved: number; rejected: number }>(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM vibekit_waitlist
    `)
    return {
      total: result?.total ?? 0,
      pending: result?.pending ?? 0,
      approved: result?.approved ?? 0,
      rejected: result?.rejected ?? 0,
    }
  },

  async approveAll(): Promise<number> {
    await ensureWaitlistTable()
    const result = await db.execute(
      `UPDATE vibekit_waitlist SET status = 'approved', approved_at = $1 WHERE status = 'pending'`,
      [new Date().toISOString()]
    )
    return result.rowCount
  },
}
