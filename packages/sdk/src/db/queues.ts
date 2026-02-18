import crypto from 'node:crypto'
import type { DatabaseAdapter, QueueManager, QueueOptions, QueueMessage, QueueReadOptions, QueueMetrics } from './types.js'

/**
 * Message Queue system for VibeKit (like pgmq).
 * Tables: _vibekit_queues, _vibekit_queue_{name}
 */

function queueTable(name: string): string {
  return `_vibekit_queue_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`
}

export function createQueueManager(adapter: DatabaseAdapter): QueueManager {
  let initialized = false

  async function ensureMeta(): Promise<void> {
    if (initialized) return
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_queues (
        "name" TEXT PRIMARY KEY,
        "visibility_timeout" INTEGER DEFAULT 30,
        "max_retries" INTEGER DEFAULT 3,
        "delivery_delay" INTEGER DEFAULT 0,
        "created_at" TEXT DEFAULT (datetime('now'))
      )
    `)
    initialized = true
  }

  const manager: QueueManager = {
    async create(name: string, options?: QueueOptions): Promise<void> {
      await ensureMeta()
      const vt = options?.visibilityTimeout ?? 30
      const mr = options?.maxRetries ?? 3
      const dd = options?.deliveryDelay ?? 0
      await adapter.execute(
        `INSERT OR IGNORE INTO _vibekit_queues ("name", "visibility_timeout", "max_retries", "delivery_delay") VALUES ($1, $2, $3, $4)`,
        [name, vt, mr, dd]
      )
      const tbl = queueTable(name)
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS "${tbl}" (
          "id" TEXT PRIMARY KEY,
          "body" TEXT NOT NULL,
          "status" TEXT DEFAULT 'pending',
          "retry_count" INTEGER DEFAULT 0,
          "visible_at" TEXT NOT NULL,
          "processed_at" TEXT,
          "error" TEXT,
          "created_at" TEXT DEFAULT (datetime('now'))
        )
      `)
      await adapter.execute(`CREATE INDEX IF NOT EXISTS "idx_${tbl}_status" ON "${tbl}" ("status", "visible_at")`)
    },

    async send<T = unknown>(queue: string, message: T): Promise<string> {
      const tbl = queueTable(queue)
      const id = crypto.randomUUID()
      const queueMeta = await adapter.queryOne<{ delivery_delay: number }>(
        `SELECT "delivery_delay" FROM _vibekit_queues WHERE "name" = $1`, [queue]
      )
      const delay = queueMeta?.delivery_delay ?? 0
      const visibleAt = new Date(Date.now() + delay * 1000).toISOString()
      await adapter.execute(
        `INSERT INTO "${tbl}" ("id", "body", "status", "visible_at") VALUES ($1, $2, 'pending', $3)`,
        [id, JSON.stringify(message), visibleAt]
      )
      return id
    },

    async sendBatch<T = unknown>(queue: string, messages: T[]): Promise<string[]> {
      const ids: string[] = []
      await adapter.transaction(async (tx) => {
        const tbl = queueTable(queue)
        const queueMeta = await adapter.queryOne<{ delivery_delay: number }>(
          `SELECT "delivery_delay" FROM _vibekit_queues WHERE "name" = $1`, [queue]
        )
        const delay = queueMeta?.delivery_delay ?? 0
        const visibleAt = new Date(Date.now() + delay * 1000).toISOString()
        for (const msg of messages) {
          const id = crypto.randomUUID()
          await tx.execute(
            `INSERT INTO "${tbl}" ("id", "body", "status", "visible_at") VALUES ($1, $2, 'pending', $3)`,
            [id, JSON.stringify(msg), visibleAt]
          )
          ids.push(id)
        }
      })
      return ids
    },

    async read<T = unknown>(queue: string, options?: QueueReadOptions): Promise<QueueMessage<T>[]> {
      const tbl = queueTable(queue)
      const batchSize = options?.batchSize ?? 1
      const now = new Date().toISOString()

      const queueMeta = await adapter.queryOne<{ visibility_timeout: number }>(
        `SELECT "visibility_timeout" FROM _vibekit_queues WHERE "name" = $1`, [queue]
      )
      const vt = options?.visibilityTimeout ?? queueMeta?.visibility_timeout ?? 30
      const newVisibleAt = new Date(Date.now() + vt * 1000).toISOString()

      const { rows } = await adapter.query<{
        id: string; body: string; status: string; retry_count: number;
        visible_at: string; processed_at: string | null; created_at: string
      }>(
        `SELECT * FROM "${tbl}" WHERE "status" = 'pending' AND "visible_at" <= $1 ORDER BY "created_at" ASC LIMIT $2`,
        [now, batchSize]
      )

      const messages: QueueMessage<T>[] = []
      for (const row of rows) {
        await adapter.execute(
          `UPDATE "${tbl}" SET "status" = 'processing', "visible_at" = $1 WHERE "id" = $2`,
          [newVisibleAt, row.id]
        )
        messages.push({
          id: row.id,
          queue,
          body: JSON.parse(row.body) as T,
          status: 'processing',
          retryCount: row.retry_count,
          createdAt: row.created_at,
          visibleAt: newVisibleAt,
        })
      }
      return messages
    },

    async delete(queue: string, messageId: string): Promise<void> {
      const tbl = queueTable(queue)
      await adapter.execute(`DELETE FROM "${tbl}" WHERE "id" = $1`, [messageId])
    },

    async complete(queue: string, messageId: string): Promise<void> {
      const tbl = queueTable(queue)
      await adapter.execute(
        `UPDATE "${tbl}" SET "status" = 'completed', "processed_at" = $1 WHERE "id" = $2`,
        [new Date().toISOString(), messageId]
      )
    },

    async fail(queue: string, messageId: string, error?: string): Promise<void> {
      const tbl = queueTable(queue)
      const queueMeta = await adapter.queryOne<{ max_retries: number }>(
        `SELECT "max_retries" FROM _vibekit_queues WHERE "name" = $1`, [queue]
      )
      const maxRetries = queueMeta?.max_retries ?? 3

      const msg = await adapter.queryOne<{ retry_count: number }>(
        `SELECT "retry_count" FROM "${tbl}" WHERE "id" = $1`, [messageId]
      )
      const retryCount = (msg?.retry_count ?? 0) + 1
      const newStatus = retryCount >= maxRetries ? 'dead_letter' : 'pending'
      const visibleAt = retryCount >= maxRetries
        ? new Date().toISOString()
        : new Date(Date.now() + retryCount * 5000).toISOString() // exponential-ish backoff

      await adapter.execute(
        `UPDATE "${tbl}" SET "status" = $1, "retry_count" = $2, "error" = $3, "visible_at" = $4 WHERE "id" = $5`,
        [newStatus, retryCount, error || null, visibleAt, messageId]
      )
    },

    async archive(queue: string, messageId: string): Promise<void> {
      const tbl = queueTable(queue)
      await adapter.execute(
        `UPDATE "${tbl}" SET "status" = 'archived' WHERE "id" = $1`, [messageId]
      )
    },

    async purge(queue: string): Promise<void> {
      const tbl = queueTable(queue)
      await adapter.execute(`DELETE FROM "${tbl}"`)
    },

    async metrics(queue: string): Promise<QueueMetrics> {
      const tbl = queueTable(queue)
      const counts = await adapter.queryOne<{
        pending: number; processing: number; completed: number;
        failed: number; dead_letter: number; archived: number; total: number
      }>(`
        SELECT
          SUM(CASE WHEN "status" = 'pending' THEN 1 ELSE 0 END) as pending,
          SUM(CASE WHEN "status" = 'processing' THEN 1 ELSE 0 END) as processing,
          SUM(CASE WHEN "status" = 'completed' THEN 1 ELSE 0 END) as completed,
          SUM(CASE WHEN "status" = 'failed' THEN 1 ELSE 0 END) as failed,
          SUM(CASE WHEN "status" = 'dead_letter' THEN 1 ELSE 0 END) as dead_letter,
          SUM(CASE WHEN "status" = 'archived' THEN 1 ELSE 0 END) as archived,
          COUNT(*) as total
        FROM "${tbl}"
      `)

      const oldest = await adapter.queryOne<{ created_at: string }>(
        `SELECT "created_at" FROM "${tbl}" WHERE "status" = 'pending' ORDER BY "created_at" ASC LIMIT 1`
      )
      const newest = await adapter.queryOne<{ created_at: string }>(
        `SELECT "created_at" FROM "${tbl}" ORDER BY "created_at" DESC LIMIT 1`
      )

      return {
        queue,
        pending: counts?.pending ?? 0,
        processing: counts?.processing ?? 0,
        completed: counts?.completed ?? 0,
        failed: counts?.failed ?? 0,
        deadLetter: counts?.dead_letter ?? 0,
        archived: counts?.archived ?? 0,
        total: counts?.total ?? 0,
        oldestMessage: oldest?.created_at,
        newestMessage: newest?.created_at,
      }
    },

    async listQueues(): Promise<Array<{ name: string; options: QueueOptions; createdAt: string }>> {
      await ensureMeta()
      const { rows } = await adapter.query<{
        name: string; visibility_timeout: number; max_retries: number;
        delivery_delay: number; created_at: string
      }>(`SELECT * FROM _vibekit_queues ORDER BY "name"`)
      return rows.map(r => ({
        name: r.name,
        options: {
          visibilityTimeout: r.visibility_timeout,
          maxRetries: r.max_retries,
          deliveryDelay: r.delivery_delay,
        },
        createdAt: r.created_at,
      }))
    },

    async drop(queue: string): Promise<void> {
      await ensureMeta()
      const tbl = queueTable(queue)
      await adapter.execute(`DROP TABLE IF EXISTS "${tbl}"`)
      await adapter.execute(`DELETE FROM _vibekit_queues WHERE "name" = $1`, [queue])
    },
  }

  return manager
}
