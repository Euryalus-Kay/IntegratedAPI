/**
 * Read Replicas for VibeKit
 *
 * Provides read replica management with automatic read/write splitting,
 * round-robin load balancing, health checks, and replica promotion.
 *
 * For SQLite: "replicas" are read-only copies of the DB file synced periodically.
 * For Postgres: connects to actual read replica instances.
 */

import fs from 'node:fs'
import path from 'node:path'
import type {
  DatabaseAdapter,
  QueryResult,
  ExecuteResult,
  TransactionClient,
} from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('vibekit:replicas')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReplicaConfig {
  /** Sync interval for SQLite replicas in ms (default: 5000) */
  syncIntervalMs: number
  /** Directory for SQLite replica files (default: ./replicas) */
  replicasDir: string
  /** Factory for creating Postgres replica adapters */
  createAdapter?: (connectionString: string) => DatabaseAdapter
}

export interface ReplicaInfo {
  name: string
  connectionString: string
  status: 'active' | 'inactive' | 'error'
  lagMs: number
  lastSyncAt: string | null
  queriesServed: number
}

export interface ReplicaManager {
  addReplica(name: string, connectionString: string): Promise<void>
  removeReplica(name: string): Promise<void>
  listReplicas(): ReplicaInfo[]
  getReadAdapter(): DatabaseAdapter
  getWriteAdapter(): DatabaseAdapter
  getReplicaLag(name?: string): Promise<number>
  promoteReplica(name: string): Promise<void>
  healthCheck(): Promise<Array<{ name: string; healthy: boolean; latencyMs: number }>>
}

// ---------------------------------------------------------------------------
// Internal replica entry
// ---------------------------------------------------------------------------

interface ReplicaEntry {
  name: string
  connectionString: string
  adapter: DatabaseAdapter
  status: 'active' | 'inactive' | 'error'
  lastSyncAt: string | null
  queriesServed: number
  syncTimer: ReturnType<typeof setInterval> | null
  lagMs: number
}

// ---------------------------------------------------------------------------
// Read/write splitting adapter
// ---------------------------------------------------------------------------

function createReadSplittingAdapter(
  primary: DatabaseAdapter,
  getNextReplica: () => ReplicaEntry | null,
): DatabaseAdapter {
  function isReadQuery(sql: string): boolean {
    const trimmed = sql.trim().toUpperCase()
    return (
      trimmed.startsWith('SELECT') ||
      trimmed.startsWith('EXPLAIN') ||
      trimmed.startsWith('PRAGMA') ||
      trimmed.startsWith('WITH')
    )
  }

  return {
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      if (isReadQuery(sql)) {
        const replica = getNextReplica()
        if (replica) {
          try {
            const result = await replica.adapter.query<T>(sql, params)
            replica.queriesServed++
            return result
          } catch {
            // Fallback to primary on replica failure
            replica.status = 'error'
          }
        }
      }
      return primary.query<T>(sql, params)
    },

    async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
      if (isReadQuery(sql)) {
        const replica = getNextReplica()
        if (replica) {
          try {
            const result = await replica.adapter.queryOne<T>(sql, params)
            replica.queriesServed++
            return result
          } catch {
            replica.status = 'error'
          }
        }
      }
      return primary.queryOne<T>(sql, params)
    },

    async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
      // Writes always go to primary
      return primary.execute(sql, params)
    },

    async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
      // Transactions always go to primary
      return primary.transaction(fn)
    },

    async close(): Promise<void> {
      // Only close the primary; replicas are managed separately
      return primary.close()
    },

    getInfo() {
      return primary.getInfo()
    },
  }
}

// ---------------------------------------------------------------------------
// SQLite replica sync
// ---------------------------------------------------------------------------

function syncSqliteReplica(primaryDbPath: string, replicaDbPath: string): void {
  try {
    fs.copyFileSync(primaryDbPath, replicaDbPath)
    // Also copy WAL and SHM if they exist
    const walPath = primaryDbPath + '-wal'
    const shmPath = primaryDbPath + '-shm'
    const replicaWalPath = replicaDbPath + '-wal'
    const replicaShmPath = replicaDbPath + '-shm'

    if (fs.existsSync(walPath)) {
      fs.copyFileSync(walPath, replicaWalPath)
    } else if (fs.existsSync(replicaWalPath)) {
      fs.unlinkSync(replicaWalPath)
    }

    if (fs.existsSync(shmPath)) {
      fs.copyFileSync(shmPath, replicaShmPath)
    } else if (fs.existsSync(replicaShmPath)) {
      fs.unlinkSync(replicaShmPath)
    }
  } catch (err) {
    log.warn(`Sync failed: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createReplicaManager(
  primaryAdapter: DatabaseAdapter,
  config?: Partial<ReplicaConfig>,
): ReplicaManager {
  const syncIntervalMs = config?.syncIntervalMs ?? 5_000
  const replicasDir = config?.replicasDir ?? path.resolve(process.cwd(), 'replicas')
  const createAdapterFn = config?.createAdapter

  const replicas = new Map<string, ReplicaEntry>()
  let roundRobinIndex = 0

  function isLocalMode(): boolean {
    return primaryAdapter.getInfo().mode === 'local'
  }

  function getPrimaryDbPath(): string {
    return primaryAdapter.getInfo().database
  }

  function getActiveReplicas(): ReplicaEntry[] {
    return Array.from(replicas.values()).filter(r => r.status === 'active')
  }

  function getNextReplica(): ReplicaEntry | null {
    const active = getActiveReplicas()
    if (active.length === 0) return null
    const replica = active[roundRobinIndex % active.length]
    roundRobinIndex = (roundRobinIndex + 1) % active.length
    return replica
  }

  const manager: ReplicaManager = {
    async addReplica(name: string, connectionString: string): Promise<void> {
      if (replicas.has(name)) {
        throw new Error(`Replica "${name}" already exists`)
      }

      let adapter: DatabaseAdapter
      let syncTimer: ReturnType<typeof setInterval> | null = null

      if (isLocalMode()) {
        // SQLite: create a read-only copy of the database
        if (!fs.existsSync(replicasDir)) {
          fs.mkdirSync(replicasDir, { recursive: true })
        }

        const replicaDbPath = connectionString || path.join(replicasDir, `${name}.db`)

        // Initial sync
        syncSqliteReplica(getPrimaryDbPath(), replicaDbPath)

        // Create a read-only adapter for the replica
        // We dynamically import to avoid circular dependencies
        const { createSqliteAdapter } = await import('./sqlite.js')
        adapter = createSqliteAdapter(replicaDbPath)

        // Set up periodic sync
        syncTimer = setInterval(() => {
          const entry = replicas.get(name)
          if (entry && entry.status === 'active') {
            const start = Date.now()
            syncSqliteReplica(getPrimaryDbPath(), replicaDbPath)
            entry.lastSyncAt = new Date().toISOString()
            entry.lagMs = Date.now() - start
          }
        }, syncIntervalMs)
      } else {
        // Postgres: connect to the replica
        if (!createAdapterFn) {
          throw new Error('createAdapter function required in config for Postgres replicas')
        }
        adapter = createAdapterFn(connectionString)
        syncTimer = null
      }

      const entry: ReplicaEntry = {
        name,
        connectionString,
        adapter,
        status: 'active',
        lastSyncAt: isLocalMode() ? new Date().toISOString() : null,
        queriesServed: 0,
        syncTimer,
        lagMs: 0,
      }

      replicas.set(name, entry)
      log.info(`Added replica: ${name}`)
    },

    async removeReplica(name: string): Promise<void> {
      const entry = replicas.get(name)
      if (!entry) {
        throw new Error(`Replica "${name}" not found`)
      }

      // Stop sync timer
      if (entry.syncTimer) {
        clearInterval(entry.syncTimer)
      }

      // Close the adapter
      try {
        await entry.adapter.close()
      } catch {
        // Swallow close errors
      }

      // Remove SQLite replica file
      if (isLocalMode() && entry.connectionString) {
        try {
          if (fs.existsSync(entry.connectionString)) {
            fs.unlinkSync(entry.connectionString)
          }
          const walPath = entry.connectionString + '-wal'
          const shmPath = entry.connectionString + '-shm'
          if (fs.existsSync(walPath)) fs.unlinkSync(walPath)
          if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath)
        } catch {
          // Ignore cleanup errors
        }
      }

      replicas.delete(name)
      log.info(`Removed replica: ${name}`)
    },

    listReplicas(): ReplicaInfo[] {
      return Array.from(replicas.values()).map(entry => ({
        name: entry.name,
        connectionString: entry.connectionString,
        status: entry.status,
        lagMs: entry.lagMs,
        lastSyncAt: entry.lastSyncAt,
        queriesServed: entry.queriesServed,
      }))
    },

    getReadAdapter(): DatabaseAdapter {
      return createReadSplittingAdapter(primaryAdapter, getNextReplica)
    },

    getWriteAdapter(): DatabaseAdapter {
      return primaryAdapter
    },

    async getReplicaLag(name?: string): Promise<number> {
      if (name) {
        const entry = replicas.get(name)
        if (!entry) throw new Error(`Replica "${name}" not found`)
        return entry.lagMs
      }

      // Average lag across all active replicas
      const active = getActiveReplicas()
      if (active.length === 0) return 0

      if (isLocalMode()) {
        // For SQLite, lag is measured by sync time
        const totalLag = active.reduce((sum, r) => sum + r.lagMs, 0)
        return Math.round(totalLag / active.length)
      }

      // For Postgres, measure replication lag using pg_stat_replication
      let totalLag = 0
      for (const entry of active) {
        try {
          const start = Date.now()
          // Write a timestamp to primary
          const now = new Date().toISOString()
          await primaryAdapter.execute(
            `CREATE TABLE IF NOT EXISTS _vibekit_repl_check (id INTEGER PRIMARY KEY CHECK (id = 1), ts TEXT)`
          )
          await primaryAdapter.execute(
            `INSERT OR REPLACE INTO _vibekit_repl_check (id, ts) VALUES (1, $1)`,
            [now]
          )

          // Read from replica
          const result = await entry.adapter.queryOne<{ ts: string }>(
            `SELECT ts FROM _vibekit_repl_check WHERE id = 1`
          )

          if (result) {
            const primaryTs = new Date(now).getTime()
            const replicaTs = new Date(result.ts).getTime()
            entry.lagMs = Math.max(0, primaryTs - replicaTs)
          } else {
            entry.lagMs = Date.now() - start
          }
          totalLag += entry.lagMs
        } catch {
          entry.lagMs = -1
          entry.status = 'error'
        }
      }

      const healthyReplicas = active.filter(r => r.lagMs >= 0)
      return healthyReplicas.length > 0
        ? Math.round(totalLag / healthyReplicas.length)
        : -1
    },

    async promoteReplica(name: string): Promise<void> {
      const entry = replicas.get(name)
      if (!entry) throw new Error(`Replica "${name}" not found`)

      if (isLocalMode()) {
        // For SQLite: copy the replica file back to the primary location
        const primaryDbPath = getPrimaryDbPath()
        const replicaDbPath = entry.connectionString || path.join(replicasDir, `${name}.db`)

        if (!fs.existsSync(replicaDbPath)) {
          throw new Error(`Replica file not found: ${replicaDbPath}`)
        }

        // Stop sync to prevent overwriting
        if (entry.syncTimer) {
          clearInterval(entry.syncTimer)
          entry.syncTimer = null
        }

        // Copy replica to primary location
        fs.copyFileSync(replicaDbPath, primaryDbPath)
        const walPath = replicaDbPath + '-wal'
        const shmPath = replicaDbPath + '-shm'
        if (fs.existsSync(walPath)) fs.copyFileSync(walPath, primaryDbPath + '-wal')
        if (fs.existsSync(shmPath)) fs.copyFileSync(shmPath, primaryDbPath + '-shm')

        log.info(`Promoted replica "${name}" to primary (SQLite file copy)`)
      } else {
        // For Postgres: this is a manual operation; we just note it
        log.info(
          `Replica "${name}" marked for promotion. Actual Postgres promotion must be done at the infrastructure level (e.g., pg_ctl promote, or via your cloud provider).`
        )
      }

      // Mark other replicas as needing resync
      for (const [rName, rEntry] of replicas) {
        if (rName !== name) {
          rEntry.status = 'inactive'
        }
      }

      entry.status = 'active'
    },

    async healthCheck(): Promise<Array<{ name: string; healthy: boolean; latencyMs: number }>> {
      const results: Array<{ name: string; healthy: boolean; latencyMs: number }> = []

      for (const [name, entry] of replicas) {
        const start = Date.now()
        let healthy = false

        try {
          await entry.adapter.query('SELECT 1')
          healthy = true
          if (entry.status === 'error') {
            entry.status = 'active'
          }
        } catch {
          entry.status = 'error'
          healthy = false
        }

        const latencyMs = Date.now() - start

        results.push({ name, healthy, latencyMs })
      }

      return results
    },
  }

  return manager
}
