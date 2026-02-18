import crypto from 'node:crypto'
import type { DatabaseAdapter, WebhookManager, WebhookDefinition, WebhookConfig, WebhookDeliveryLog } from './types.js'

/**
 * Webhook system for VibeKit.
 * Stores webhook configs in _vibekit_webhooks, delivery logs in _vibekit_webhook_logs.
 */

export function createWebhookManager(adapter: DatabaseAdapter): WebhookManager {
  let initialized = false

  async function ensureTables(): Promise<void> {
    if (initialized) return
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_webhooks (
        "id" TEXT PRIMARY KEY,
        "url" TEXT NOT NULL,
        "events" TEXT NOT NULL,
        "secret" TEXT,
        "headers" TEXT DEFAULT '{}',
        "enabled" INTEGER DEFAULT 1,
        "created_at" TEXT DEFAULT (datetime('now'))
      )
    `)
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_webhook_logs (
        "id" TEXT PRIMARY KEY,
        "webhook_id" TEXT NOT NULL,
        "event" TEXT NOT NULL,
        "url" TEXT NOT NULL,
        "request_body" TEXT NOT NULL,
        "response_status" INTEGER,
        "response_body" TEXT,
        "success" INTEGER NOT NULL,
        "error" TEXT,
        "delivered_at" TEXT DEFAULT (datetime('now')),
        "duration_ms" INTEGER NOT NULL
      )
    `)
    initialized = true
  }

  const manager: WebhookManager = {
    async create(definition: WebhookDefinition): Promise<WebhookConfig> {
      await ensureTables()
      const id = crypto.randomUUID()
      const secret = definition.secret || crypto.randomBytes(32).toString('hex')
      await adapter.execute(
        `INSERT INTO _vibekit_webhooks ("id", "url", "events", "secret", "headers", "enabled")
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, definition.url, JSON.stringify(definition.events), secret,
         JSON.stringify(definition.headers || {}), definition.enabled !== false ? 1 : 0]
      )
      const row = await adapter.queryOne<any>(`SELECT * FROM _vibekit_webhooks WHERE "id" = $1`, [id])
      return {
        id: row.id, url: row.url, events: JSON.parse(row.events),
        secret: row.secret, headers: JSON.parse(row.headers || '{}'),
        enabled: row.enabled === 1, createdAt: row.created_at,
      }
    },

    async remove(id: string): Promise<void> {
      await ensureTables()
      await adapter.execute(`DELETE FROM _vibekit_webhooks WHERE "id" = $1`, [id])
    },

    async update(id: string, updates: Partial<WebhookDefinition>): Promise<WebhookConfig> {
      await ensureTables()
      const existing = await adapter.queryOne<any>(`SELECT * FROM _vibekit_webhooks WHERE "id" = $1`, [id])
      if (!existing) throw new Error(`Webhook "${id}" not found`)

      const url = updates.url ?? existing.url
      const events = updates.events ? JSON.stringify(updates.events) : existing.events
      const secret = updates.secret ?? existing.secret
      const headers = updates.headers ? JSON.stringify(updates.headers) : existing.headers
      const enabled = updates.enabled !== undefined ? (updates.enabled ? 1 : 0) : existing.enabled

      await adapter.execute(
        `UPDATE _vibekit_webhooks SET "url" = $1, "events" = $2, "secret" = $3, "headers" = $4, "enabled" = $5 WHERE "id" = $6`,
        [url, events, secret, headers, enabled, id]
      )
      const row = await adapter.queryOne<any>(`SELECT * FROM _vibekit_webhooks WHERE "id" = $1`, [id])
      return {
        id: row.id, url: row.url, events: JSON.parse(row.events),
        secret: row.secret, headers: JSON.parse(row.headers || '{}'),
        enabled: row.enabled === 1, createdAt: row.created_at,
      }
    },

    async list(): Promise<WebhookConfig[]> {
      await ensureTables()
      const { rows } = await adapter.query<any>(`SELECT * FROM _vibekit_webhooks ORDER BY "created_at"`)
      return rows.map((r: any) => ({
        id: r.id, url: r.url, events: JSON.parse(r.events),
        secret: r.secret, headers: JSON.parse(r.headers || '{}'),
        enabled: r.enabled === 1, createdAt: r.created_at,
      }))
    },

    async get(id: string): Promise<WebhookConfig | null> {
      await ensureTables()
      const row = await adapter.queryOne<any>(`SELECT * FROM _vibekit_webhooks WHERE "id" = $1`, [id])
      if (!row) return null
      return {
        id: row.id, url: row.url, events: JSON.parse(row.events),
        secret: row.secret, headers: JSON.parse(row.headers || '{}'),
        enabled: row.enabled === 1, createdAt: row.created_at,
      }
    },

    async test(id: string): Promise<WebhookDeliveryLog> {
      await ensureTables()
      const webhook = await manager.get(id)
      if (!webhook) throw new Error(`Webhook "${id}" not found`)
      const testPayload = { event: 'webhook.test', data: { message: 'Test delivery', timestamp: new Date().toISOString() } }
      return deliverWebhook(adapter, webhook, 'webhook.test', testPayload)
    },

    async getDeliveryLog(id: string, limit = 20): Promise<WebhookDeliveryLog[]> {
      await ensureTables()
      const { rows } = await adapter.query<any>(
        `SELECT * FROM _vibekit_webhook_logs WHERE "webhook_id" = $1 ORDER BY "delivered_at" DESC LIMIT $2`,
        [id, limit]
      )
      return rows.map((r: any) => ({
        id: r.id, webhookId: r.webhook_id, event: r.event, url: r.url,
        requestBody: r.request_body, responseStatus: r.response_status,
        responseBody: r.response_body, success: r.success === 1,
        error: r.error, deliveredAt: r.delivered_at, durationMs: r.duration_ms,
      }))
    },

    async fire(event: string, payload: Record<string, unknown>): Promise<void> {
      await ensureTables()
      const { rows } = await adapter.query<any>(
        `SELECT * FROM _vibekit_webhooks WHERE "enabled" = 1`
      )
      const webhooks = rows
        .map((r: any) => ({
          id: r.id, url: r.url, events: JSON.parse(r.events),
          secret: r.secret, headers: JSON.parse(r.headers || '{}'),
          enabled: true, createdAt: r.created_at,
        }))
        .filter((w: WebhookConfig) => w.events.includes(event) || w.events.includes('*'))

      await Promise.allSettled(
        webhooks.map((w: WebhookConfig) => deliverWebhook(adapter, w, event, payload))
      )
    },
  }

  return manager
}

async function deliverWebhook(
  adapter: DatabaseAdapter,
  webhook: WebhookConfig,
  event: string,
  payload: Record<string, unknown>,
): Promise<WebhookDeliveryLog> {
  const logId = crypto.randomUUID()
  const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString() })
  const start = Date.now()
  let responseStatus: number | null = null
  let responseBody: string | null = null
  let success = false
  let error: string | null = null

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': event,
      'X-Webhook-Id': webhook.id,
      ...webhook.headers,
    }

    if (webhook.secret) {
      const hmac = crypto.createHmac('sha256', webhook.secret)
      hmac.update(body)
      headers['X-Webhook-Signature'] = `sha256=${hmac.digest('hex')}`
    }

    const response = await fetch(webhook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) })
    responseStatus = response.status
    responseBody = await response.text().catch(() => null)
    success = response.ok
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const durationMs = Date.now() - start

  await adapter.execute(
    `INSERT INTO _vibekit_webhook_logs ("id", "webhook_id", "event", "url", "request_body", "response_status", "response_body", "success", "error", "duration_ms")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [logId, webhook.id, event, webhook.url, body, responseStatus, responseBody, success ? 1 : 0, error, durationMs]
  )

  return {
    id: logId, webhookId: webhook.id, event, url: webhook.url,
    requestBody: body, responseStatus, responseBody,
    success, error, deliveredAt: new Date().toISOString(), durationMs,
  }
}
