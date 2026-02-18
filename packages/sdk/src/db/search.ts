import type {
  DatabaseAdapter,
  SearchManager,
  FTSIndexOptions,
  FTSSearchOptions,
  FTSResult,
} from './types.js'

/**
 * Full-Text Search (FTS) for SQLite using FTS5.
 *
 * Creates FTS5 virtual tables that mirror content from regular tables.
 * Supports MATCH queries, BM25 ranking, highlight(), and snippet().
 *
 * Convention: The FTS virtual table for a table named "posts" is
 * named "_vibekit_fts_posts".
 */

function ftsTableName(table: string): string {
  return `_vibekit_fts_${table}`
}

export function createSearchManager(adapter: DatabaseAdapter): SearchManager {
  const manager: SearchManager = {
    async createIndex(
      table: string,
      columns: string[],
      options?: FTSIndexOptions,
    ): Promise<void> {
      if (!columns || columns.length === 0) {
        throw new Error('db.search.createIndex: at least one column is required')
      }

      const ftsName = ftsTableName(table)
      const tokenizer = options?.tokenizer ?? 'unicode61'
      const prefix = options?.prefix ? `, prefix='${options.prefix}'` : ''

      if (options?.contentTable) {
        // External-content FTS5 table: references an existing table
        const colList = columns.join(', ')
        const sql = `CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsName}"
          USING fts5(${colList}, content='${options.contentTable}', tokenize='${tokenizer}'${prefix})`
        await adapter.execute(sql)

        // Populate from existing data
        await adapter.execute(`
          INSERT INTO "${ftsName}"("${ftsName}", rowid, ${colList})
          SELECT 'delete', rowid, ${colList} FROM "${options.contentTable}" WHERE 0
        `)
        // Rebuild to populate
        await adapter.execute(
          `INSERT INTO "${ftsName}"(${colList}) SELECT ${colList} FROM "${options.contentTable}"`,
        )
      } else {
        // Stand-alone FTS5 table that mirrors the source table
        const colList = columns.join(', ')
        const sql = `CREATE VIRTUAL TABLE IF NOT EXISTS "${ftsName}"
          USING fts5(${colList}, content='${table}', content_rowid='rowid', tokenize='${tokenizer}'${prefix})`
        await adapter.execute(sql)

        // Create triggers to keep FTS in sync with the source table
        const colInsertVals = columns.map(c => `new."${c}"`).join(', ')
        const colDeleteVals = columns.map(c => `old."${c}"`).join(', ')

        // After INSERT trigger
        await adapter.execute(`
          CREATE TRIGGER IF NOT EXISTS "${ftsName}_ai" AFTER INSERT ON "${table}" BEGIN
            INSERT INTO "${ftsName}"(rowid, ${colList}) VALUES (new.rowid, ${colInsertVals});
          END
        `)

        // After DELETE trigger
        await adapter.execute(`
          CREATE TRIGGER IF NOT EXISTS "${ftsName}_ad" AFTER DELETE ON "${table}" BEGIN
            INSERT INTO "${ftsName}"("${ftsName}", rowid, ${colList}) VALUES ('delete', old.rowid, ${colDeleteVals});
          END
        `)

        // After UPDATE trigger
        await adapter.execute(`
          CREATE TRIGGER IF NOT EXISTS "${ftsName}_au" AFTER UPDATE ON "${table}" BEGIN
            INSERT INTO "${ftsName}"("${ftsName}", rowid, ${colList}) VALUES ('delete', old.rowid, ${colDeleteVals});
            INSERT INTO "${ftsName}"(rowid, ${colList}) VALUES (new.rowid, ${colInsertVals});
          END
        `)

        // Populate with existing data
        await adapter.execute(
          `INSERT INTO "${ftsName}"(rowid, ${colList}) SELECT rowid, ${colList} FROM "${table}"`,
        )
      }
    },

    async search<T = Record<string, unknown>>(
      table: string,
      query: string,
      options?: FTSSearchOptions,
    ): Promise<FTSResult<T>> {
      const ftsName = ftsTableName(table)
      const limit = options?.limit ?? 20
      const offset = options?.offset ?? 0
      const orderByRank = options?.orderByRank !== false

      // Build select columns
      const selectParts: string[] = []

      // Always include all columns from the FTS table
      selectParts.push(`"${ftsName}".*`)

      // Add rank
      selectParts.push('rank')

      // Add highlight if requested
      if (options?.highlight) {
        const [openTag, closeTag] = options.highlightTags ?? ['<b>', '</b>']
        // Highlight for each column – we'll use column index 0 by default
        selectParts.push(
          `highlight("${ftsName}", 0, '${openTag}', '${closeTag}') as _highlight`,
        )
      }

      // Add snippet if requested
      if (options?.snippet) {
        const snippetCol = options.snippetColumn ?? 0
        const snippetTokens = options.snippetTokens ?? 16
        const [openTag, closeTag] = options.highlightTags ?? ['<b>', '</b>']
        selectParts.push(
          `snippet("${ftsName}", ${snippetCol}, '${openTag}', '${closeTag}', '...', ${snippetTokens}) as _snippet`,
        )
      }

      let sql = `SELECT ${selectParts.join(', ')} FROM "${ftsName}" WHERE "${ftsName}" MATCH ?`

      if (orderByRank) {
        sql += ' ORDER BY rank'
      }

      sql += ` LIMIT ${limit}`
      if (offset > 0) {
        sql += ` OFFSET ${offset}`
      }

      // FTS5 uses ? placeholders natively, and we pass the query directly
      // We need to use the raw adapter here. The convertParams in sqlite.ts
      // handles $1 style, so let's use that.
      const sqlWithParam = sql.replace('?', '$1')
      const { rows } = await adapter.query<T>(sqlWithParam, [query])

      return {
        rows,
        rowCount: rows.length,
      }
    },

    async dropIndex(table: string): Promise<void> {
      const ftsName = ftsTableName(table)

      // Drop triggers first
      await adapter.execute(`DROP TRIGGER IF EXISTS "${ftsName}_ai"`)
      await adapter.execute(`DROP TRIGGER IF EXISTS "${ftsName}_ad"`)
      await adapter.execute(`DROP TRIGGER IF EXISTS "${ftsName}_au"`)

      // Drop FTS table
      await adapter.execute(`DROP TABLE IF EXISTS "${ftsName}"`)
    },

    async rebuild(table: string): Promise<void> {
      const ftsName = ftsTableName(table)
      await adapter.execute(`INSERT INTO "${ftsName}"("${ftsName}") VALUES ('rebuild')`)
    },
  }

  return manager
}
