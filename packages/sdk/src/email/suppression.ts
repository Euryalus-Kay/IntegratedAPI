// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Email — Suppression List
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { VibeKitError } from '../utils/errors.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type SuppressionReason = 'bounce' | 'complaint' | 'unsubscribe' | 'manual' | 'invalid'

export interface SuppressedEmail {
  id: string
  email: string
  reason: SuppressionReason
  metadata: Record<string, unknown>
  createdAt: string
}

export interface SuppressionListOptions {
  reason?: SuppressionReason
  limit?: number
  offset?: number
  search?: string
}

export interface SuppressionListResult {
  entries: SuppressedEmail[]
  total: number
  limit: number
  offset: number
}

export interface BounceEvent {
  email: string
  type: 'hard' | 'soft'
  message?: string
  timestamp?: string
}

export interface ComplaintEvent {
  email: string
  feedbackType?: string
  message?: string
  timestamp?: string
}

// ── Table Setup ──────────────────────────────────────────────────────────────

const SUPPRESSION_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _vibekit_email_suppression (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  reason TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_suppression_email ON _vibekit_email_suppression(email);
CREATE INDEX IF NOT EXISTS idx_suppression_reason ON _vibekit_email_suppression(reason);
`

let _suppressionInitialized = false

async function ensureSuppressionTable(): Promise<void> {
  if (_suppressionInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of SUPPRESSION_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _suppressionInitialized = true
}

// ── Module ───────────────────────────────────────────────────────────────────

export const suppression = {
  /**
   * Add an email address to the suppression list. If the email already
   * exists, the existing entry is returned unchanged.
   */
  async add(email: string, reason: SuppressionReason, metadata?: Record<string, unknown>): Promise<SuppressedEmail> {
    await ensureSuppressionTable()
    const normalized = email.toLowerCase().trim()

    // Check if already suppressed
    const existing = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM _vibekit_email_suppression WHERE email = $1',
      [normalized],
    )
    if (existing) {
      return parseSuppressionRow(existing)
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await db.execute(
      `INSERT INTO _vibekit_email_suppression (id, email, reason, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, normalized, reason, JSON.stringify(metadata ?? {}), now],
    )

    return { id, email: normalized, reason, metadata: metadata ?? {}, createdAt: now }
  },

  /**
   * Remove an email address from the suppression list.
   */
  async remove(email: string): Promise<void> {
    await ensureSuppressionTable()
    const normalized = email.toLowerCase().trim()
    const result = await db.execute(
      'DELETE FROM _vibekit_email_suppression WHERE email = $1',
      [normalized],
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new VibeKitError(
        `Email "${normalized}" is not on the suppression list.`,
        'VALIDATION_FAILED',
        404,
      )
    }
  },

  /**
   * Check whether an email address is on the suppression list.
   */
  async check(email: string): Promise<{ suppressed: boolean; reason?: SuppressionReason; since?: string }> {
    await ensureSuppressionTable()
    const normalized = email.toLowerCase().trim()
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT reason, created_at FROM _vibekit_email_suppression WHERE email = $1',
      [normalized],
    )
    if (!row) return { suppressed: false }
    return {
      suppressed: true,
      reason: row.reason as SuppressionReason,
      since: row.created_at as string,
    }
  },

  /**
   * List suppressed email addresses with optional filtering and pagination.
   */
  async list(options?: SuppressionListOptions): Promise<SuppressionListResult> {
    await ensureSuppressionTable()
    const limit = options?.limit ?? 50
    const offset = options?.offset ?? 0

    let countSql = 'SELECT COUNT(*) as total FROM _vibekit_email_suppression WHERE 1=1'
    let querySql = 'SELECT * FROM _vibekit_email_suppression WHERE 1=1'
    const params: unknown[] = []
    let paramIdx = 1

    if (options?.reason) {
      countSql += ` AND reason = $${paramIdx}`
      querySql += ` AND reason = $${paramIdx}`
      params.push(options.reason)
      paramIdx++
    }

    if (options?.search) {
      countSql += ` AND email LIKE $${paramIdx}`
      querySql += ` AND email LIKE $${paramIdx}`
      params.push(`%${options.search}%`)
      paramIdx++
    }

    const countResult = await db.queryOne<{ total: number }>(countSql, params)
    const total = countResult?.total ?? 0

    querySql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`
    const { rows } = await db.query<Record<string, unknown>>(querySql, params)

    return {
      entries: rows.map(parseSuppressionRow),
      total,
      limit,
      offset,
    }
  },

  /**
   * Automatically suppress an email based on a bounce event. Hard
   * bounces are always suppressed; soft bounces are recorded but not
   * suppressed by default.
   */
  async handleBounce(event: BounceEvent): Promise<SuppressedEmail | null> {
    if (event.type === 'hard') {
      return suppression.add(event.email, 'bounce', {
        bounceType: event.type,
        message: event.message ?? null,
        bouncedAt: event.timestamp ?? new Date().toISOString(),
      })
    }
    // Soft bounces are logged but not automatically suppressed
    return null
  },

  /**
   * Automatically suppress an email based on a complaint/spam report event.
   */
  async handleComplaint(event: ComplaintEvent): Promise<SuppressedEmail> {
    return suppression.add(event.email, 'complaint', {
      feedbackType: event.feedbackType ?? null,
      message: event.message ?? null,
      reportedAt: event.timestamp ?? new Date().toISOString(),
    })
  },

  /**
   * Bulk import email addresses into the suppression list. Existing
   * entries are silently skipped.
   */
  async import(
    emails: Array<{ email: string; reason?: SuppressionReason }>,
  ): Promise<{ imported: number; skipped: number }> {
    await ensureSuppressionTable()
    let imported = 0
    let skipped = 0

    for (const item of emails) {
      const normalized = item.email.toLowerCase().trim()
      const existing = await db.queryOne<{ id: string }>(
        'SELECT id FROM _vibekit_email_suppression WHERE email = $1',
        [normalized],
      )
      if (existing) {
        skipped++
        continue
      }

      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      await db.execute(
        `INSERT INTO _vibekit_email_suppression (id, email, reason, metadata, created_at)
         VALUES ($1, $2, $3, '{}', $4)`,
        [id, normalized, item.reason ?? 'manual', now],
      )
      imported++
    }

    return { imported, skipped }
  },

  /**
   * Export the full suppression list as an array.
   */
  async export(): Promise<SuppressedEmail[]> {
    await ensureSuppressionTable()
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM _vibekit_email_suppression ORDER BY created_at DESC',
    )
    return rows.map(parseSuppressionRow)
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseSuppressionRow(row: Record<string, unknown>): SuppressedEmail {
  return {
    id: row.id as string,
    email: row.email as string,
    reason: row.reason as SuppressionReason,
    metadata: typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at as string,
  }
}
