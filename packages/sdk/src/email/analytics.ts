// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Email — Analytics & Event Tracking
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { db } from '../db/client.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type EmailEventType = 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced' | 'complained'

export interface EmailEvent {
  id: string
  messageId: string
  event: EmailEventType
  recipient: string
  metadata: Record<string, unknown>
  timestamp: string
}

export interface EmailAnalyticsSummary {
  sent: number
  delivered: number
  opened: number
  clicked: number
  bounced: number
  complained: number
  deliveryRate: number
  openRate: number
  clickRate: number
  bounceRate: number
  complaintRate: number
  period: { from: string; to: string }
}

export interface TopLink {
  url: string
  clicks: number
  uniqueClicks: number
}

export interface DomainStats {
  domain: string
  sent: number
  delivered: number
  bounced: number
  complained: number
  deliveryRate: number
  bounceRate: number
}

export interface AnalyticsSummaryOptions {
  from?: string
  to?: string
}

export interface TopLinksOptions {
  limit?: number
  from?: string
  to?: string
}

// ── Table Setup ──────────────────────────────────────────────────────────────

const ANALYTICS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS _vibekit_email_events (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  event TEXT NOT NULL,
  recipient TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  timestamp TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_email_events_message ON _vibekit_email_events(message_id);
CREATE INDEX IF NOT EXISTS idx_email_events_event ON _vibekit_email_events(event);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient ON _vibekit_email_events(recipient);
CREATE INDEX IF NOT EXISTS idx_email_events_timestamp ON _vibekit_email_events(timestamp);
`

let _analyticsInitialized = false

async function ensureAnalyticsTable(): Promise<void> {
  if (_analyticsInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of ANALYTICS_TABLE_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _analyticsInitialized = true
}

// ── Module ───────────────────────────────────────────────────────────────────

export const emailAnalytics = {
  /**
   * Track an email event (sent, delivered, opened, clicked, etc.).
   */
  async track(
    messageId: string,
    event: EmailEventType,
    metadata?: { recipient?: string; url?: string; [key: string]: unknown },
  ): Promise<EmailEvent> {
    await ensureAnalyticsTable()

    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const recipient = metadata?.recipient ?? ''
    const meta = { ...metadata }
    delete meta.recipient

    await db.execute(
      `INSERT INTO _vibekit_email_events (id, message_id, event, recipient, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, messageId, event, recipient, JSON.stringify(meta), now],
    )

    return { id, messageId, event, recipient, metadata: meta, timestamp: now }
  },

  /**
   * Get all events for a specific email message.
   */
  async getMessageEvents(messageId: string): Promise<EmailEvent[]> {
    await ensureAnalyticsTable()
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM _vibekit_email_events WHERE message_id = $1 ORDER BY timestamp ASC',
      [messageId],
    )
    return rows.map(parseEventRow)
  },

  /**
   * Get an analytics summary with delivery rates, open rates, etc.
   * Optionally filter by date range.
   */
  async getSummary(options?: AnalyticsSummaryOptions): Promise<EmailAnalyticsSummary> {
    await ensureAnalyticsTable()

    const from = options?.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const to = options?.to ?? new Date().toISOString()

    const { rows } = await db.query<{ event: string; count: number }>(
      `SELECT event, COUNT(*) as count
       FROM _vibekit_email_events
       WHERE timestamp >= $1 AND timestamp <= $2
       GROUP BY event`,
      [from, to],
    )

    const counts: Record<string, number> = {}
    for (const row of rows) {
      counts[row.event] = row.count
    }

    const sent = counts['sent'] ?? 0
    const delivered = counts['delivered'] ?? 0
    const opened = counts['opened'] ?? 0
    const clicked = counts['clicked'] ?? 0
    const bounced = counts['bounced'] ?? 0
    const complained = counts['complained'] ?? 0

    return {
      sent,
      delivered,
      opened,
      clicked,
      bounced,
      complained,
      deliveryRate: sent > 0 ? Number(((delivered / sent) * 100).toFixed(2)) : 0,
      openRate: delivered > 0 ? Number(((opened / delivered) * 100).toFixed(2)) : 0,
      clickRate: delivered > 0 ? Number(((clicked / delivered) * 100).toFixed(2)) : 0,
      bounceRate: sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0,
      complaintRate: sent > 0 ? Number(((complained / sent) * 100).toFixed(2)) : 0,
      period: { from, to },
    }
  },

  /**
   * Get the most clicked links across all tracked emails.
   */
  async getTopLinks(options?: TopLinksOptions): Promise<TopLink[]> {
    await ensureAnalyticsTable()

    const limit = options?.limit ?? 10
    const from = options?.from ?? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const to = options?.to ?? new Date().toISOString()

    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT metadata FROM _vibekit_email_events
       WHERE event = 'clicked' AND timestamp >= $1 AND timestamp <= $2`,
      [from, to],
    )

    // Aggregate clicks by URL
    const urlCounts = new Map<string, { total: number; recipients: Set<string> }>()

    for (const row of rows) {
      const meta = typeof row.metadata === 'string'
        ? JSON.parse(row.metadata as string)
        : (row.metadata as Record<string, unknown>)
      const url = meta?.url as string
      if (!url) continue

      if (!urlCounts.has(url)) {
        urlCounts.set(url, { total: 0, recipients: new Set() })
      }
      const entry = urlCounts.get(url)!
      entry.total++
      if (row.recipient) entry.recipients.add(row.recipient as string)
    }

    const links: TopLink[] = []
    for (const [url, data] of urlCounts) {
      links.push({
        url,
        clicks: data.total,
        uniqueClicks: data.recipients.size,
      })
    }

    links.sort((a, b) => b.clicks - a.clicks)
    return links.slice(0, limit)
  },

  /**
   * Get email delivery statistics for a specific sending domain.
   */
  async getDomainStats(domain: string): Promise<DomainStats> {
    await ensureAnalyticsTable()
    const normalized = domain.toLowerCase().trim()
    const pattern = `%@${normalized}`

    const { rows } = await db.query<{ event: string; count: number }>(
      `SELECT event, COUNT(*) as count
       FROM _vibekit_email_events
       WHERE recipient LIKE $1
       GROUP BY event`,
      [pattern],
    )

    const counts: Record<string, number> = {}
    for (const row of rows) {
      counts[row.event] = row.count
    }

    const sent = counts['sent'] ?? 0
    const delivered = counts['delivered'] ?? 0
    const bounced = counts['bounced'] ?? 0
    const complained = counts['complained'] ?? 0

    return {
      domain: normalized,
      sent,
      delivered,
      bounced,
      complained,
      deliveryRate: sent > 0 ? Number(((delivered / sent) * 100).toFixed(2)) : 0,
      bounceRate: sent > 0 ? Number(((bounced / sent) * 100).toFixed(2)) : 0,
    }
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseEventRow(row: Record<string, unknown>): EmailEvent {
  return {
    id: row.id as string,
    messageId: row.message_id as string,
    event: row.event as EmailEventType,
    recipient: row.recipient as string,
    metadata: typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : (row.metadata as Record<string, unknown>) ?? {},
    timestamp: row.timestamp as string,
  }
}
