// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Realtime — Change Data Capture (CDC)
// ──────────────────────────────────────────────────────────────────────────────

import { db } from '../db/client.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type CDCEventType = 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'

export interface CDCChange {
  type: 'INSERT' | 'UPDATE' | 'DELETE'
  table: string
  old: Record<string, unknown> | null
  new: Record<string, unknown> | null
  timestamp: string
  schema: string
}

export type CDCCallback = (change: CDCChange) => void

export interface CDCFilterOptions {
  filter?: string
}

export interface CDCSubscription {
  id: string
  table: string
  event: CDCEventType
  filter: string | null
  createdAt: string
  active: boolean
}

interface InternalSubscription {
  id: string
  table: string
  event: CDCEventType
  callback: CDCCallback
  filter: ParsedFilter | null
  createdAt: string
  active: boolean
}

interface ParsedFilter {
  column: string
  operator: string
  value: string
}

interface TableSnapshot {
  rows: Map<string, Record<string, unknown>>
  primaryKey: string
}

// ── State ────────────────────────────────────────────────────────────────────

const _subscriptions: Map<string, InternalSubscription> = new Map()
const _snapshots: Map<string, TableSnapshot> = new Map()
let _pollInterval: ReturnType<typeof setInterval> | null = null
let _pollMs = 1000
let _subCounter = 0
let _initialized = false

function generateSubId(): string {
  return `cdc_${++_subCounter}_${Date.now().toString(36)}`
}

// ── Polling engine ───────────────────────────────────────────────────────────

async function initSnapshot(table: string, primaryKey: string): Promise<TableSnapshot> {
  const existing = _snapshots.get(table)
  if (existing) return existing

  const snapshot: TableSnapshot = { rows: new Map(), primaryKey }
  try {
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT * FROM "${table}"`,
    )
    for (const row of rows) {
      const key = String(row[primaryKey] ?? '')
      snapshot.rows.set(key, { ...row })
    }
  } catch {
    // Table may not exist yet; start with empty snapshot
  }
  _snapshots.set(table, snapshot)
  return snapshot
}

async function detectPrimaryKey(table: string): Promise<string> {
  // Try to detect primary key from table info (SQLite-specific)
  try {
    const { rows } = await db.query<{ name: string; pk: number }>(
      `PRAGMA table_info("${table}")`,
    )
    const pkCol = rows.find(r => r.pk === 1)
    if (pkCol) return pkCol.name
  } catch {
    // Fallback for non-SQLite databases
  }
  // Default fallback
  return 'id'
}

function matchesFilter(row: Record<string, unknown>, filter: ParsedFilter | null): boolean {
  if (!filter) return true
  const value = String(row[filter.column] ?? '')
  switch (filter.operator) {
    case 'eq': return value === filter.value
    case 'neq': return value !== filter.value
    case 'gt': return Number(value) > Number(filter.value)
    case 'gte': return Number(value) >= Number(filter.value)
    case 'lt': return Number(value) < Number(filter.value)
    case 'lte': return Number(value) <= Number(filter.value)
    case 'like': return value.includes(filter.value)
    default: return true
  }
}

function parseFilter(filterStr: string): ParsedFilter | null {
  // Format: "column=op.value" e.g. "author_id=eq.123"
  const eqIdx = filterStr.indexOf('=')
  if (eqIdx === -1) return null
  const column = filterStr.slice(0, eqIdx)
  const rest = filterStr.slice(eqIdx + 1)
  const dotIdx = rest.indexOf('.')
  if (dotIdx === -1) return null
  const operator = rest.slice(0, dotIdx)
  const value = rest.slice(dotIdx + 1)
  return { column, operator, value }
}

async function pollForChanges(): Promise<void> {
  // Group subscriptions by table
  const tables = new Map<string, InternalSubscription[]>()
  for (const sub of _subscriptions.values()) {
    if (!sub.active) continue
    if (!tables.has(sub.table)) tables.set(sub.table, [])
    tables.get(sub.table)!.push(sub)
  }

  for (const [table, subs] of tables) {
    try {
      const pk = await detectPrimaryKey(table)
      const snapshot = await initSnapshot(table, pk)
      const { rows: currentRows } = await db.query<Record<string, unknown>>(
        `SELECT * FROM "${table}"`,
      )

      const currentMap = new Map<string, Record<string, unknown>>()
      for (const row of currentRows) {
        const key = String(row[pk] ?? '')
        currentMap.set(key, row)
      }

      const now = new Date().toISOString()

      // Detect INSERTs and UPDATEs
      for (const [key, newRow] of currentMap) {
        const oldRow = snapshot.rows.get(key)
        if (!oldRow) {
          // INSERT
          const change: CDCChange = {
            type: 'INSERT',
            table,
            old: null,
            new: newRow,
            timestamp: now,
            schema: 'public',
          }
          dispatchChange(subs, change)
        } else {
          // Check for UPDATE
          let changed = false
          for (const col of Object.keys(newRow)) {
            if (String(newRow[col]) !== String(oldRow[col])) {
              changed = true
              break
            }
          }
          if (changed) {
            const change: CDCChange = {
              type: 'UPDATE',
              table,
              old: oldRow,
              new: newRow,
              timestamp: now,
              schema: 'public',
            }
            dispatchChange(subs, change)
          }
        }
      }

      // Detect DELETEs
      for (const [key, oldRow] of snapshot.rows) {
        if (!currentMap.has(key)) {
          const change: CDCChange = {
            type: 'DELETE',
            table,
            old: oldRow,
            new: null,
            timestamp: now,
            schema: 'public',
          }
          dispatchChange(subs, change)
        }
      }

      // Update snapshot
      snapshot.rows = currentMap
    } catch {
      // Table may have been dropped or unavailable; skip silently
    }
  }
}

function dispatchChange(subs: InternalSubscription[], change: CDCChange): void {
  for (const sub of subs) {
    if (!sub.active) continue
    if (sub.event !== 'ALL' && sub.event !== change.type) continue

    // Apply filter on the relevant row (new for INSERT/UPDATE, old for DELETE)
    const targetRow = change.new ?? change.old
    if (targetRow && !matchesFilter(targetRow, sub.filter)) continue

    try {
      sub.callback(change)
    } catch {
      // Subscriber errors should not break the polling loop
    }
  }
}

function startPolling(): void {
  if (_pollInterval) return
  _pollInterval = setInterval(() => {
    pollForChanges().catch(() => { /* swallow async errors in poll cycle */ })
  }, _pollMs)

  // Allow the process to exit naturally without waiting for this timer
  if (_pollInterval && typeof _pollInterval === 'object' && 'unref' in _pollInterval) {
    (_pollInterval as NodeJS.Timeout).unref()
  }
}

function stopPollingIfEmpty(): void {
  let hasActive = false
  for (const sub of _subscriptions.values()) {
    if (sub.active) { hasActive = true; break }
  }
  if (!hasActive && _pollInterval) {
    clearInterval(_pollInterval)
    _pollInterval = null
  }
}

// ── Module ───────────────────────────────────────────────────────────────────

export const cdc = {
  /**
   * Subscribe to changes on a database table.
   *
   * @param table    - The table name to watch.
   * @param event    - The event type: INSERT, UPDATE, DELETE, or ALL.
   * @param callback - Function called when a matching change is detected.
   * @param options  - Optional filter in PostgREST-style: `"column=op.value"`.
   *
   * @returns A subscription ID that can be used with `unsubscribe`.
   *
   * @example
   * ```ts
   * cdc.subscribe('posts', 'INSERT', (change) => {
   *   console.log('New post:', change.new)
   * }, { filter: 'author_id=eq.123' })
   * ```
   */
  subscribe(
    table: string,
    event: CDCEventType,
    callback: CDCCallback,
    options?: CDCFilterOptions,
  ): string {
    const id = generateSubId()
    const filter = options?.filter ? parseFilter(options.filter) : null

    const sub: InternalSubscription = {
      id,
      table,
      event,
      callback,
      filter,
      createdAt: new Date().toISOString(),
      active: true,
    }

    _subscriptions.set(id, sub)
    startPolling()

    return id
  },

  /**
   * Unsubscribe from change notifications. The subscription is removed
   * and polling is stopped if no active subscriptions remain.
   */
  unsubscribe(subscriptionId: string): void {
    _subscriptions.delete(subscriptionId)
    _snapshots.clear() // Force fresh snapshot on next poll
    stopPollingIfEmpty()
  },

  /**
   * List all active CDC subscriptions.
   */
  getSubscriptions(): CDCSubscription[] {
    const result: CDCSubscription[] = []
    for (const sub of _subscriptions.values()) {
      result.push({
        id: sub.id,
        table: sub.table,
        event: sub.event,
        filter: sub.filter
          ? `${sub.filter.column}=${sub.filter.operator}.${sub.filter.value}`
          : null,
        createdAt: sub.createdAt,
        active: sub.active,
      })
    }
    return result
  },

  /**
   * Pause a subscription without removing it.
   */
  pause(subscriptionId: string): void {
    const sub = _subscriptions.get(subscriptionId)
    if (sub) sub.active = false
    stopPollingIfEmpty()
  },

  /**
   * Resume a paused subscription.
   */
  resume(subscriptionId: string): void {
    const sub = _subscriptions.get(subscriptionId)
    if (sub) {
      sub.active = true
      startPolling()
    }
  },

  /**
   * Set the polling interval in milliseconds (default: 1000).
   * Lower values increase responsiveness but use more CPU.
   */
  setPollInterval(ms: number): void {
    _pollMs = Math.max(100, ms)
    if (_pollInterval) {
      clearInterval(_pollInterval)
      _pollInterval = null
      startPolling()
    }
  },

  /**
   * Force an immediate poll for changes (instead of waiting for the
   * next interval). Returns a promise that resolves once the poll
   * cycle completes.
   */
  async poll(): Promise<void> {
    await pollForChanges()
  },

  /**
   * Clear all subscriptions, snapshots, and stop polling.
   */
  reset(): void {
    _subscriptions.clear()
    _snapshots.clear()
    _subCounter = 0
    if (_pollInterval) {
      clearInterval(_pollInterval)
      _pollInterval = null
    }
  },
}
