/**
 * Connection Pooling for VibeKit
 *
 * Provides a connection pool with acquire/release semantics, transaction support,
 * dynamic resizing, statistics tracking, and graceful draining.
 *
 * For SQLite: the pool is a singleton (SQLite is single-writer) but exposes the same API.
 * For Postgres: maintains an actual pool of connections.
 */

import type { DatabaseAdapter, QueryResult, ExecuteResult, TransactionClient } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('vibekit:pool')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolConfig {
  /** Minimum number of connections to keep idle (default: 2) */
  min: number
  /** Maximum number of connections (default: 10) */
  max: number
  /** Time in ms before an idle connection is closed (default: 30000) */
  idleTimeout: number
  /** Time in ms to wait for a connection before throwing (default: 5000) */
  acquireTimeout: number
  /** Maximum number of requests waiting in queue (default: 100) */
  maxWaitQueue: number
  /** Connection factory for Postgres mode */
  createConnection?: () => Promise<DatabaseAdapter>
  /** Base adapter to use for SQLite mode (single-writer) */
  adapter?: DatabaseAdapter
}

export interface PoolConnection {
  id: number
  adapter: DatabaseAdapter
  createdAt: number
  lastUsedAt: number
  queryCount: number
  status: 'idle' | 'active'
}

export interface PoolStats {
  active: number
  idle: number
  waiting: number
  total: number
  maxSize: number
  totalQueries: number
  avgLatencyMs: number
  poolHits: number
  poolMisses: number
}

export interface ConnectionPoolManager {
  acquire(): Promise<PoolConnection>
  release(conn: PoolConnection): void
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>>
  transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T>
  getStats(): PoolStats
  drain(): Promise<void>
  resize(newMax: number): void
}

// ---------------------------------------------------------------------------
// Internal wait-queue entry
// ---------------------------------------------------------------------------

interface WaitQueueEntry {
  resolve: (conn: PoolConnection) => void
  reject: (err: Error) => void
  timeoutHandle: ReturnType<typeof setTimeout>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createConnectionPool(config: Partial<PoolConfig> & { adapter?: DatabaseAdapter; createConnection?: () => Promise<DatabaseAdapter> }): ConnectionPoolManager {
  const min = config.min ?? 2
  let max = config.max ?? 10
  const idleTimeout = config.idleTimeout ?? 30_000
  const acquireTimeout = config.acquireTimeout ?? 5_000
  const maxWaitQueue = config.maxWaitQueue ?? 100

  const isSqlite = !!config.adapter
  const createConn = config.createConnection

  // Pool state
  const connections: PoolConnection[] = []
  const waitQueue: WaitQueueEntry[] = []
  let nextId = 1
  let draining = false

  // Stats tracking
  let totalQueries = 0
  let totalLatencyMs = 0
  let poolHits = 0
  let poolMisses = 0

  // Idle timeout timers
  const idleTimers = new Map<number, ReturnType<typeof setTimeout>>()

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  function createPoolConnection(adapter: DatabaseAdapter): PoolConnection {
    return {
      id: nextId++,
      adapter,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      queryCount: 0,
      status: 'idle',
    }
  }

  async function createNewConnection(): Promise<PoolConnection> {
    if (isSqlite) {
      // SQLite is single-writer; all connections share the same adapter
      return createPoolConnection(config.adapter!)
    }
    if (!createConn) {
      throw new Error('createConnectionPool requires either an adapter (SQLite) or createConnection factory (Postgres)')
    }
    const adapter = await createConn()
    return createPoolConnection(adapter)
  }

  function scheduleIdleTimeout(conn: PoolConnection): void {
    clearIdleTimeout(conn)
    const handle = setTimeout(() => {
      if (conn.status === 'idle' && connections.length > min) {
        removeConnection(conn)
      }
    }, idleTimeout)
    idleTimers.set(conn.id, handle)
  }

  function clearIdleTimeout(conn: PoolConnection): void {
    const handle = idleTimers.get(conn.id)
    if (handle) {
      clearTimeout(handle)
      idleTimers.delete(conn.id)
    }
  }

  function removeConnection(conn: PoolConnection): void {
    const idx = connections.indexOf(conn)
    if (idx !== -1) {
      connections.splice(idx, 1)
    }
    clearIdleTimeout(conn)
    // Close the underlying connection (for Postgres; for SQLite we don't close the shared adapter)
    if (!isSqlite) {
      conn.adapter.close().catch(() => {})
    }
  }

  function getIdleConnection(): PoolConnection | null {
    for (const conn of connections) {
      if (conn.status === 'idle') {
        return conn
      }
    }
    return null
  }

  function processWaitQueue(): void {
    if (waitQueue.length === 0) return
    const idle = getIdleConnection()
    if (!idle) return

    const entry = waitQueue.shift()!
    clearTimeout(entry.timeoutHandle)
    idle.status = 'active'
    idle.lastUsedAt = Date.now()
    clearIdleTimeout(idle)
    poolHits++
    entry.resolve(idle)
  }

  // ---------------------------------------------------------------------------
  // Pool manager
  // ---------------------------------------------------------------------------

  const pool: ConnectionPoolManager = {
    async acquire(): Promise<PoolConnection> {
      if (draining) {
        throw new Error('Connection pool is draining; cannot acquire new connections')
      }

      // Try to find an idle connection
      const idle = getIdleConnection()
      if (idle) {
        idle.status = 'active'
        idle.lastUsedAt = Date.now()
        clearIdleTimeout(idle)
        poolHits++
        return idle
      }

      // Try to create a new connection if under max
      if (connections.length < max) {
        poolMisses++
        const conn = await createNewConnection()
        conn.status = 'active'
        connections.push(conn)
        return conn
      }

      // Wait in queue
      if (waitQueue.length >= maxWaitQueue) {
        throw new Error(`Connection pool wait queue is full (${maxWaitQueue} requests waiting)`)
      }

      poolMisses++
      return new Promise<PoolConnection>((resolve, reject) => {
        const timeoutHandle = setTimeout(() => {
          const idx = waitQueue.findIndex(e => e.resolve === resolve)
          if (idx !== -1) waitQueue.splice(idx, 1)
          reject(new Error(`Timed out waiting for connection after ${acquireTimeout}ms`))
        }, acquireTimeout)

        waitQueue.push({ resolve, reject, timeoutHandle })
      })
    },

    release(conn: PoolConnection): void {
      if (draining) {
        removeConnection(conn)
        return
      }

      conn.status = 'idle'
      conn.lastUsedAt = Date.now()

      // If there are waiters, give this connection to the next one
      if (waitQueue.length > 0) {
        processWaitQueue()
        return
      }

      // If we're over the max (from a resize-down), remove excess
      if (connections.length > max) {
        removeConnection(conn)
        return
      }

      // Schedule idle timeout
      scheduleIdleTimeout(conn)
    },

    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      const conn = await pool.acquire()
      const start = Date.now()
      try {
        const result = await conn.adapter.query<T>(sql, params)
        conn.queryCount++
        totalQueries++
        totalLatencyMs += Date.now() - start
        return result
      } finally {
        pool.release(conn)
      }
    },

    async transaction<T>(fn: (tx: TransactionClient) => Promise<T>): Promise<T> {
      const conn = await pool.acquire()
      const start = Date.now()
      try {
        const result = await conn.adapter.transaction(fn)
        conn.queryCount++
        totalQueries++
        totalLatencyMs += Date.now() - start
        return result
      } finally {
        pool.release(conn)
      }
    },

    getStats(): PoolStats {
      let active = 0
      let idle = 0
      for (const conn of connections) {
        if (conn.status === 'active') active++
        else idle++
      }
      return {
        active,
        idle,
        waiting: waitQueue.length,
        total: connections.length,
        maxSize: max,
        totalQueries,
        avgLatencyMs: totalQueries > 0 ? Math.round((totalLatencyMs / totalQueries) * 100) / 100 : 0,
        poolHits,
        poolMisses,
      }
    },

    async drain(): Promise<void> {
      draining = true

      // Reject all waiting requests
      for (const entry of waitQueue) {
        clearTimeout(entry.timeoutHandle)
        entry.reject(new Error('Connection pool is draining'))
      }
      waitQueue.length = 0

      // Wait for active connections to be released, with a timeout
      const drainTimeout = 10_000
      const drainStart = Date.now()

      while (connections.some(c => c.status === 'active')) {
        if (Date.now() - drainStart > drainTimeout) {
          log.warn('Drain timeout reached; forcibly closing remaining connections')
          break
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }

      // Close all connections
      for (const conn of [...connections]) {
        clearIdleTimeout(conn)
        if (!isSqlite) {
          try {
            await conn.adapter.close()
          } catch {
            // Swallow close errors during drain
          }
        }
      }
      connections.length = 0

      log.info('Pool drained')
    },

    resize(newMax: number): void {
      if (newMax < 1) {
        throw new Error('Pool max size must be at least 1')
      }
      const oldMax = max
      max = newMax
      log.info(`Pool resized from ${oldMax} to ${newMax}`)

      // If shrinking, remove excess idle connections
      if (newMax < oldMax) {
        const toRemove = connections.length - newMax
        if (toRemove > 0) {
          const idleConns = connections.filter(c => c.status === 'idle')
          const removeCount = Math.min(toRemove, idleConns.length)
          for (let i = 0; i < removeCount; i++) {
            removeConnection(idleConns[i])
          }
        }
      }

      // If growing and there are waiters, try to create connections for them
      if (newMax > oldMax && waitQueue.length > 0) {
        const canCreate = newMax - connections.length
        const toCreate = Math.min(canCreate, waitQueue.length)
        for (let i = 0; i < toCreate; i++) {
          createNewConnection()
            .then(conn => {
              conn.status = 'active'
              connections.push(conn)
              if (waitQueue.length > 0) {
                const entry = waitQueue.shift()!
                clearTimeout(entry.timeoutHandle)
                entry.resolve(conn)
              } else {
                conn.status = 'idle'
                scheduleIdleTimeout(conn)
              }
            })
            .catch(() => {
              // Failed to create connection; waiters will time out normally
            })
        }
      }
    },
  }

  // Pre-populate minimum connections
  if (isSqlite) {
    // For SQLite, we create virtual pool entries sharing the same adapter
    for (let i = 0; i < min; i++) {
      const conn = createPoolConnection(config.adapter!)
      connections.push(conn)
      scheduleIdleTimeout(conn)
    }
  } else if (createConn) {
    // For Postgres, asynchronously pre-populate
    const initPromises: Promise<void>[] = []
    for (let i = 0; i < min; i++) {
      initPromises.push(
        createNewConnection().then(conn => {
          connections.push(conn)
          scheduleIdleTimeout(conn)
        }).catch(err => {
          log.warn(`Failed to pre-create connection: ${err instanceof Error ? err.message : String(err)}`)
        })
      )
    }
    // Fire and forget; connections will be created on demand if pre-population fails
    Promise.all(initPromises).catch(() => {})
  }

  return pool
}
