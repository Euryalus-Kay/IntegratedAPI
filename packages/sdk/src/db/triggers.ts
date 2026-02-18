import type {
  DatabaseAdapter,
  TriggerManager,
  TriggerDefinition,
  TriggerConfig,
  TriggerTiming,
  TriggerEvent,
} from './types.js'

/**
 * Application-level triggers for SQLite.
 *
 * Since SQLite triggers are SQL-only (no JS callbacks), VibeKit implements
 * triggers at the application layer. Trigger metadata is stored in
 * `_vibekit_triggers` and the actual JS callback functions live in memory.
 * The QueryBuilder calls `fire()` before/after mutations.
 */

/** In-memory registry: trigger name -> callback function. */
const _triggerFunctions: Map<
  string,
  (oldRow: Record<string, unknown> | null, newRow: Record<string, unknown> | null) => void | Promise<void>
> = new Map()

export function createTriggerManager(adapter: DatabaseAdapter): TriggerManager {
  let initialized = false

  async function ensureTable(): Promise<void> {
    if (initialized) return
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_triggers (
        "name" TEXT PRIMARY KEY,
        "table_name" TEXT NOT NULL,
        "timing" TEXT NOT NULL,
        "event" TEXT NOT NULL,
        "created_at" TEXT DEFAULT (datetime('now'))
      )
    `)
    initialized = true
  }

  const manager: TriggerManager = {
    async create(definition: TriggerDefinition): Promise<void> {
      await ensureTable()

      // Store metadata in DB
      await adapter.execute(
        `INSERT OR REPLACE INTO _vibekit_triggers ("name", "table_name", "timing", "event")
         VALUES ($1, $2, $3, $4)`,
        [definition.name, definition.table, definition.timing, definition.event],
      )

      // Store callback in memory
      _triggerFunctions.set(definition.name, definition.fn)
    },

    async remove(name: string): Promise<void> {
      await ensureTable()
      await adapter.execute(
        `DELETE FROM _vibekit_triggers WHERE "name" = $1`,
        [name],
      )
      _triggerFunctions.delete(name)
    },

    async list(table?: string): Promise<TriggerConfig[]> {
      await ensureTable()
      let sql = 'SELECT * FROM _vibekit_triggers'
      const params: unknown[] = []
      if (table) {
        sql += ' WHERE "table_name" = $1'
        params.push(table)
      }
      sql += ' ORDER BY "name"'

      const { rows } = await adapter.query<{
        name: string
        table_name: string
        timing: string
        event: string
        created_at: string
      }>(sql, params)

      return rows.map(r => ({
        name: r.name,
        table: r.table_name,
        timing: r.timing as TriggerTiming,
        event: r.event as TriggerEvent,
        createdAt: r.created_at,
      }))
    },

    async fire(
      table: string,
      timing: TriggerTiming,
      event: TriggerEvent,
      oldRow: Record<string, unknown> | null,
      newRow: Record<string, unknown> | null,
    ): Promise<void> {
      await ensureTable()

      // Find matching triggers from DB metadata
      const { rows } = await adapter.query<{ name: string }>(
        `SELECT "name" FROM _vibekit_triggers
         WHERE "table_name" = $1 AND "timing" = $2 AND "event" = $3
         ORDER BY "name"`,
        [table, timing, event],
      )

      for (const row of rows) {
        const fn = _triggerFunctions.get(row.name)
        if (fn) {
          try {
            const result = fn(oldRow, newRow)
            // Await if it returns a promise
            if (result && typeof (result as any).then === 'function') {
              await result
            }
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err))
            throw new Error(
              `Trigger "${row.name}" (${timing} ${event} on "${table}") failed: ${error.message}`,
            )
          }
        }
      }
    },
  }

  return manager
}
