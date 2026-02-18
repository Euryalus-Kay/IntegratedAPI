import type { DatabaseAdapter, VectorManager, VectorEntry, VectorSearchOptions, VectorSearchResult } from './types.js'

/**
 * Vector Embeddings for SQLite.
 * Stores vectors as JSON arrays, computes cosine similarity in JS.
 * Tables: _vibekit_vector_collections, _vibekit_vectors_{collection}
 */

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, magA = 0, magB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    magA += a[i] * a[i]
    magB += b[i] * b[i]
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB)
  return mag === 0 ? 0 : dot / mag
}

export function createVectorManager(adapter: DatabaseAdapter): VectorManager {
  let initialized = false

  async function ensureTables(): Promise<void> {
    if (initialized) return
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_vector_collections (
        "name" TEXT PRIMARY KEY,
        "dimensions" INTEGER NOT NULL,
        "created_at" TEXT DEFAULT (datetime('now'))
      )
    `)
    initialized = true
  }

  function collectionTable(name: string): string {
    return `_vibekit_vectors_${name.replace(/[^a-zA-Z0-9_]/g, '_')}`
  }

  const manager: VectorManager = {
    async createCollection(name: string, dimensions: number): Promise<void> {
      await ensureTables()
      await adapter.execute(
        `INSERT OR IGNORE INTO _vibekit_vector_collections ("name", "dimensions") VALUES ($1, $2)`,
        [name, dimensions]
      )
      const tbl = collectionTable(name)
      await adapter.execute(`
        CREATE TABLE IF NOT EXISTS "${tbl}" (
          "id" TEXT PRIMARY KEY,
          "vector" TEXT NOT NULL,
          "metadata" TEXT DEFAULT '{}',
          "created_at" TEXT DEFAULT (datetime('now'))
        )
      `)
    },

    async insert(collection: string, entry: VectorEntry): Promise<void> {
      const tbl = collectionTable(collection)
      await adapter.execute(
        `INSERT OR REPLACE INTO "${tbl}" ("id", "vector", "metadata") VALUES ($1, $2, $3)`,
        [entry.id, JSON.stringify(entry.vector), JSON.stringify(entry.metadata || {})]
      )
    },

    async insertBatch(collection: string, entries: VectorEntry[]): Promise<void> {
      const tbl = collectionTable(collection)
      await adapter.transaction(async (tx) => {
        for (const entry of entries) {
          await tx.execute(
            `INSERT OR REPLACE INTO "${tbl}" ("id", "vector", "metadata") VALUES ($1, $2, $3)`,
            [entry.id, JSON.stringify(entry.vector), JSON.stringify(entry.metadata || {})]
          )
        }
      })
    },

    async search(collection: string, queryVector: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]> {
      const tbl = collectionTable(collection)
      const limit = options?.limit ?? 10
      const minScore = options?.minScore ?? 0

      // Get all vectors (for local/dev this is fine; production would use ANN index)
      const { rows } = await adapter.query<{ id: string; vector: string; metadata: string }>(
        `SELECT "id", "vector", "metadata" FROM "${tbl}"`
      )

      let results: VectorSearchResult[] = rows.map(row => {
        const vector = JSON.parse(row.vector) as number[]
        const score = cosineSimilarity(queryVector, vector)
        const metadata = JSON.parse(row.metadata || '{}')
        return { id: row.id, score, vector, metadata }
      })

      // Apply filter
      if (options?.filter) {
        results = results.filter(r => {
          for (const [key, value] of Object.entries(options.filter!)) {
            if (r.metadata[key] !== value) return false
          }
          return true
        })
      }

      // Apply minScore
      results = results.filter(r => r.score >= minScore)

      // Sort by score descending and limit
      results.sort((a, b) => b.score - a.score)
      return results.slice(0, limit)
    },

    async delete(collection: string, id: string): Promise<void> {
      const tbl = collectionTable(collection)
      await adapter.execute(`DELETE FROM "${tbl}" WHERE "id" = $1`, [id])
    },

    async get(collection: string, id: string): Promise<VectorEntry | null> {
      const tbl = collectionTable(collection)
      const row = await adapter.queryOne<{ id: string; vector: string; metadata: string }>(
        `SELECT "id", "vector", "metadata" FROM "${tbl}" WHERE "id" = $1`, [id]
      )
      if (!row) return null
      return {
        id: row.id,
        vector: JSON.parse(row.vector),
        metadata: JSON.parse(row.metadata || '{}')
      }
    },

    async count(collection: string): Promise<number> {
      const tbl = collectionTable(collection)
      const row = await adapter.queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM "${tbl}"`)
      return row?.cnt ?? 0
    },

    async dropCollection(collection: string): Promise<void> {
      await ensureTables()
      const tbl = collectionTable(collection)
      await adapter.execute(`DROP TABLE IF EXISTS "${tbl}"`)
      await adapter.execute(`DELETE FROM _vibekit_vector_collections WHERE "name" = $1`, [collection])
    },

    async listCollections(): Promise<Array<{ name: string; dimensions: number; count: number }>> {
      await ensureTables()
      const { rows } = await adapter.query<{ name: string; dimensions: number }>(
        `SELECT "name", "dimensions" FROM _vibekit_vector_collections ORDER BY "name"`
      )
      const result: Array<{ name: string; dimensions: number; count: number }> = []
      for (const row of rows) {
        const tbl = collectionTable(row.name)
        try {
          const cnt = await adapter.queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM "${tbl}"`)
          result.push({ name: row.name, dimensions: row.dimensions, count: cnt?.cnt ?? 0 })
        } catch {
          result.push({ name: row.name, dimensions: row.dimensions, count: 0 })
        }
      }
      return result
    },
  }

  return manager
}
