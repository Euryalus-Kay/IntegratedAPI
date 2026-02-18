/**
 * Enhanced Migrations System for VibeKit
 *
 * Provides a full-featured migration manager similar to Supabase/Prisma migrations.
 * Supports timestamped migration files, up/down/rollback, locking, seeding,
 * squashing, and schema diffing.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseAdapter, SeedContext, QueryResult, ExecuteResult } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('vibekit:migrations')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MigrationFile {
  version: string
  name: string
  filename: string
  up: (adapter: DatabaseAdapter) => Promise<void>
  down: (adapter: DatabaseAdapter) => Promise<void>
}

export interface MigrationRecord {
  version: string
  name: string
  applied_at: string
  checksum: string
}

export interface MigrationStatusEntry {
  version: string
  name: string
  status: 'pending' | 'applied'
  appliedAt: string | null
}

export interface SchemaDiff {
  tablesAdded: string[]
  tablesRemoved: string[]
  columnsAdded: Array<{ table: string; column: string; type: string }>
  columnsRemoved: Array<{ table: string; column: string }>
  sql: string[]
}

export interface MigrationManager {
  generate(name: string): Promise<string>
  up(): Promise<MigrationStatusEntry | null>
  upAll(): Promise<MigrationStatusEntry[]>
  down(): Promise<MigrationStatusEntry | null>
  downTo(version: string): Promise<MigrationStatusEntry[]>
  status(): Promise<MigrationStatusEntry[]>
  reset(): Promise<void>
  diff(): Promise<SchemaDiff>
  seed(seedFn: (ctx: SeedContext) => Promise<void>): Promise<void>
  squash(): Promise<string>
  lock(): Promise<boolean>
  unlock(): Promise<void>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIGRATIONS_TABLE = '_vibekit_migrations'
const LOCK_TABLE = '_vibekit_migration_lock'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTimestamp(): string {
  const now = new Date()
  const y = now.getFullYear()
  const mo = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const h = String(now.getHours()).padStart(2, '0')
  const mi = String(now.getMinutes()).padStart(2, '0')
  const s = String(now.getSeconds()).padStart(2, '0')
  return `${y}${mo}${d}${h}${mi}${s}`
}

function simpleChecksum(content: string): string {
  let hash = 0
  for (let i = 0; i < content.length; i++) {
    const ch = content.charCodeAt(i)
    hash = ((hash << 5) - hash + ch) | 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

function sanitizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

async function ensureMigrationsTable(adapter: DatabaseAdapter): Promise<void> {
  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS "${MIGRATIONS_TABLE}" (
      version TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now')),
      checksum TEXT NOT NULL DEFAULT ''
    )
  `)
}

async function ensureLockTable(adapter: DatabaseAdapter): Promise<void> {
  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS "${LOCK_TABLE}" (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      locked_at TEXT,
      locked_by TEXT
    )
  `)
  // Ensure single-row exists
  const existing = await adapter.queryOne<{ id: number }>(
    `SELECT id FROM "${LOCK_TABLE}" WHERE id = 1`
  )
  if (!existing) {
    await adapter.execute(
      `INSERT INTO "${LOCK_TABLE}" (id, locked_at, locked_by) VALUES (1, NULL, NULL)`
    )
  }
}

async function getAppliedMigrations(adapter: DatabaseAdapter): Promise<MigrationRecord[]> {
  const { rows } = await adapter.query<MigrationRecord>(
    `SELECT version, name, applied_at, checksum FROM "${MIGRATIONS_TABLE}" ORDER BY version ASC`
  )
  return rows
}

function discoverMigrationFiles(migrationsDir: string): Array<{ version: string; name: string; filename: string; filepath: string }> {
  if (!fs.existsSync(migrationsDir)) {
    return []
  }

  const entries = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.ts') || f.endsWith('.js'))
  const migrations: Array<{ version: string; name: string; filename: string; filepath: string }> = []

  for (const filename of entries) {
    // Format: 20240101120000_create_users.ts
    const match = filename.match(/^(\d{14})_(.+)\.(ts|js)$/)
    if (match) {
      migrations.push({
        version: match[1],
        name: match[2],
        filename,
        filepath: path.join(migrationsDir, filename),
      })
    }
  }

  migrations.sort((a, b) => a.version.localeCompare(b.version))
  return migrations
}

async function loadMigrationModule(filepath: string): Promise<{ up: (adapter: DatabaseAdapter) => Promise<void>; down: (adapter: DatabaseAdapter) => Promise<void> }> {
  // Use dynamic import which works for both .ts (with ts-node/tsx) and .js
  const mod = await import(filepath)
  if (typeof mod.up !== 'function') {
    throw new Error(`Migration file ${filepath} must export an 'up' function`)
  }
  if (typeof mod.down !== 'function') {
    throw new Error(`Migration file ${filepath} must export a 'down' function`)
  }
  return { up: mod.up, down: mod.down }
}

async function getAllTables(adapter: DatabaseAdapter): Promise<string[]> {
  const info = adapter.getInfo()
  if (info.mode === 'local') {
    const { rows } = await adapter.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_vibekit_%' ORDER BY name"
    )
    return rows.map(r => r.name)
  }
  // Postgres
  const { rows } = await adapter.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '_vibekit_%' ORDER BY tablename"
  )
  return rows.map(r => r.tablename)
}

async function getTableColumns(adapter: DatabaseAdapter, table: string): Promise<Array<{ name: string; type: string; notnull: boolean; dflt_value: string | null; pk: boolean }>> {
  const info = adapter.getInfo()
  if (info.mode === 'local') {
    const { rows } = await adapter.query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(
      `PRAGMA table_info("${table}")`
    )
    return rows.map(r => ({
      name: r.name,
      type: r.type,
      notnull: r.notnull === 1,
      dflt_value: r.dflt_value,
      pk: r.pk === 1,
    }))
  }
  // Postgres
  const { rows } = await adapter.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  )
  return rows.map(r => ({
    name: r.column_name,
    type: r.data_type,
    notnull: r.is_nullable === 'NO',
    dflt_value: r.column_default,
    pk: false, // Would need additional query for PG primary keys
  }))
}

// ---------------------------------------------------------------------------
// Migration Template
// ---------------------------------------------------------------------------

function generateMigrationTemplate(name: string): string {
  return `import type { DatabaseAdapter } from '@vibekit/sdk/db/types'

/**
 * Migration: ${name}
 */
export async function up(adapter: DatabaseAdapter): Promise<void> {
  // Write your migration here
  // Example:
  // await adapter.execute(\`
  //   CREATE TABLE IF NOT EXISTS "example" (
  //     "id" TEXT PRIMARY KEY,
  //     "name" TEXT NOT NULL,
  //     "created_at" TEXT DEFAULT (datetime('now'))
  //   )
  // \`)
}

export async function down(adapter: DatabaseAdapter): Promise<void> {
  // Write the rollback for this migration
  // Example:
  // await adapter.execute('DROP TABLE IF EXISTS "example"')
}
`
}

// ---------------------------------------------------------------------------
// Seed context builder
// ---------------------------------------------------------------------------

function buildSeedContext(adapter: DatabaseAdapter): SeedContext {
  return {
    async insert<T = Record<string, unknown>>(table: string, data: Record<string, unknown>): Promise<T | null> {
      const columns = Object.keys(data)
      const values = Object.values(data)
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
      const colStr = columns.map(c => `"${c}"`).join(', ')
      await adapter.execute(
        `INSERT INTO "${table}" (${colStr}) VALUES (${placeholders})`,
        values
      )
      const result = await adapter.queryOne<T>(
        `SELECT * FROM "${table}" ORDER BY rowid DESC LIMIT 1`
      )
      return result
    },
    async insertMany(table: string, data: Record<string, unknown>[]): Promise<void> {
      if (data.length === 0) return
      const columns = Object.keys(data[0])
      const colStr = columns.map(c => `"${c}"`).join(', ')
      for (const row of data) {
        const values = columns.map(c => row[c])
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        await adapter.execute(
          `INSERT INTO "${table}" (${colStr}) VALUES (${placeholders})`,
          values
        )
      }
    },
    async truncate(table: string): Promise<void> {
      await adapter.execute(`DELETE FROM "${table}"`)
    },
    async execute(sql: string, params?: unknown[]): Promise<ExecuteResult> {
      return adapter.execute(sql, params)
    },
    async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
      return adapter.query<T>(sql, params)
    },
    log(message: string): void {
      log.info(`[seed] ${message}`)
    },
  }
}

// ---------------------------------------------------------------------------
// Main factory
// ---------------------------------------------------------------------------

export function createMigrationManager(
  adapter: DatabaseAdapter,
  migrationsDir?: string,
): MigrationManager {
  const resolvedDir = migrationsDir || path.resolve(process.cwd(), 'migrations')
  let initialized = false

  async function ensureInit(): Promise<void> {
    if (initialized) return
    await ensureMigrationsTable(adapter)
    await ensureLockTable(adapter)
    initialized = true
  }

  const manager: MigrationManager = {
    async generate(name: string): Promise<string> {
      await ensureInit()
      const timestamp = generateTimestamp()
      const safeName = sanitizeName(name)
      const filename = `${timestamp}_${safeName}.ts`

      if (!fs.existsSync(resolvedDir)) {
        fs.mkdirSync(resolvedDir, { recursive: true })
      }

      const filepath = path.join(resolvedDir, filename)
      const template = generateMigrationTemplate(name)
      fs.writeFileSync(filepath, template, 'utf-8')

      log.info(`Generated: ${filename}`)
      return filepath
    },

    async up(): Promise<MigrationStatusEntry | null> {
      await ensureInit()
      const applied = await getAppliedMigrations(adapter)
      const appliedVersions = new Set(applied.map(m => m.version))
      const files = discoverMigrationFiles(resolvedDir)
      const pending = files.filter(f => !appliedVersions.has(f.version))

      if (pending.length === 0) {
        log.info('No pending migrations')
        return null
      }

      const next = pending[0]
      const mod = await loadMigrationModule(next.filepath)
      const content = fs.readFileSync(next.filepath, 'utf-8')
      const checksum = simpleChecksum(content)

      await adapter.transaction(async (tx) => {
        await mod.up(adapter)
        await tx.execute(
          `INSERT INTO "${MIGRATIONS_TABLE}" (version, name, checksum) VALUES ($1, $2, $3)`,
          [next.version, next.name, checksum]
        )
      })

      log.info(`Applied: ${next.version}_${next.name}`)
      return {
        version: next.version,
        name: next.name,
        status: 'applied',
        appliedAt: new Date().toISOString(),
      }
    },

    async upAll(): Promise<MigrationStatusEntry[]> {
      await ensureInit()
      const results: MigrationStatusEntry[] = []
      let result = await manager.up()
      while (result !== null) {
        results.push(result)
        result = await manager.up()
      }
      if (results.length === 0) {
        log.info('All migrations are up to date')
      } else {
        log.info(`Applied ${results.length} migration(s)`)
      }
      return results
    },

    async down(): Promise<MigrationStatusEntry | null> {
      await ensureInit()
      const applied = await getAppliedMigrations(adapter)

      if (applied.length === 0) {
        log.info('No migrations to roll back')
        return null
      }

      const last = applied[applied.length - 1]
      const files = discoverMigrationFiles(resolvedDir)
      const file = files.find(f => f.version === last.version)

      if (file) {
        const mod = await loadMigrationModule(file.filepath)
        await adapter.transaction(async (tx) => {
          await mod.down(adapter)
          await tx.execute(
            `DELETE FROM "${MIGRATIONS_TABLE}" WHERE version = $1`,
            [last.version]
          )
        })
      } else {
        // Migration file no longer exists; just remove the record
        await adapter.execute(
          `DELETE FROM "${MIGRATIONS_TABLE}" WHERE version = $1`,
          [last.version]
        )
      }

      log.info(`Rolled back: ${last.version}_${last.name}`)
      return {
        version: last.version,
        name: last.name,
        status: 'pending',
        appliedAt: null,
      }
    },

    async downTo(version: string): Promise<MigrationStatusEntry[]> {
      await ensureInit()
      const results: MigrationStatusEntry[] = []
      const applied = await getAppliedMigrations(adapter)

      // Find all migrations applied after the target version
      const toRollback = applied.filter(m => m.version > version).reverse()

      if (toRollback.length === 0) {
        log.info(`No migrations to roll back (already at or before ${version})`)
        return results
      }

      for (const migration of toRollback) {
        const result = await manager.down()
        if (result) {
          results.push(result)
        }
      }

      log.info(`Rolled back ${results.length} migration(s) to version ${version}`)
      return results
    },

    async status(): Promise<MigrationStatusEntry[]> {
      await ensureInit()
      const applied = await getAppliedMigrations(adapter)
      const appliedMap = new Map(applied.map(m => [m.version, m]))
      const files = discoverMigrationFiles(resolvedDir)
      const entries: MigrationStatusEntry[] = []

      // Add all discovered files with their status
      for (const file of files) {
        const record = appliedMap.get(file.version)
        entries.push({
          version: file.version,
          name: file.name,
          status: record ? 'applied' : 'pending',
          appliedAt: record ? record.applied_at : null,
        })
      }

      // Add applied migrations that no longer have files (orphans)
      for (const record of applied) {
        const hasFile = files.some(f => f.version === record.version)
        if (!hasFile) {
          entries.push({
            version: record.version,
            name: record.name,
            status: 'applied',
            appliedAt: record.applied_at,
          })
        }
      }

      entries.sort((a, b) => a.version.localeCompare(b.version))
      return entries
    },

    async reset(): Promise<void> {
      await ensureInit()

      // Roll back all applied migrations in reverse
      let result = await manager.down()
      while (result !== null) {
        result = await manager.down()
      }

      // Now apply all migrations
      await manager.upAll()
      log.info('Database reset complete')
    },

    async diff(): Promise<SchemaDiff> {
      await ensureInit()
      const diff: SchemaDiff = {
        tablesAdded: [],
        tablesRemoved: [],
        columnsAdded: [],
        columnsRemoved: [],
        sql: [],
      }

      const existingTables = await getAllTables(adapter)
      const existingTableSet = new Set(existingTables)

      // Discover what schema the migration files define by reading the DB state
      // and comparing against a "desired" state derived from re-running all up migrations
      // For a practical approach, we compare current DB tables/columns with what the
      // migration files would produce if all were applied on a fresh DB.

      // Simplified approach: discover tables currently in DB and build a column map
      const currentSchema = new Map<string, Map<string, string>>()
      for (const table of existingTables) {
        const columns = await getTableColumns(adapter, table)
        const colMap = new Map<string, string>()
        for (const col of columns) {
          colMap.set(col.name, col.type)
        }
        currentSchema.set(table, colMap)
      }

      // Check for tables that exist in the filesystem migrations but not in DB
      // by running a dry analysis of the migration SQL
      const files = discoverMigrationFiles(resolvedDir)
      const applied = await getAppliedMigrations(adapter)
      const appliedVersions = new Set(applied.map(m => m.version))
      const pendingFiles = files.filter(f => !appliedVersions.has(f.version))

      // For pending migration files, try to read them and detect CREATE TABLE statements
      for (const file of pendingFiles) {
        try {
          const content = fs.readFileSync(file.filepath, 'utf-8')
          const createTableMatches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)
          for (const match of createTableMatches) {
            const tableName = match[1]
            if (!existingTableSet.has(tableName)) {
              diff.tablesAdded.push(tableName)
              diff.sql.push(`-- From migration ${file.version}_${file.name}: CREATE TABLE "${tableName}" ...`)
            }
          }
          const dropTableMatches = content.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)
          for (const match of dropTableMatches) {
            const tableName = match[1]
            if (existingTableSet.has(tableName)) {
              diff.tablesRemoved.push(tableName)
              diff.sql.push(`DROP TABLE IF EXISTS "${tableName}";`)
            }
          }
          const alterTableMatches = content.matchAll(/ALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+"?(\w+)"?\s+(\w+)/gi)
          for (const match of alterTableMatches) {
            const tableName = match[1]
            const columnName = match[2]
            const columnType = match[3]
            const tableColumns = currentSchema.get(tableName)
            if (tableColumns && !tableColumns.has(columnName)) {
              diff.columnsAdded.push({ table: tableName, column: columnName, type: columnType })
              diff.sql.push(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnType};`)
            }
          }
        } catch {
          // Skip files that cannot be read or parsed
        }
      }

      return diff
    },

    async seed(seedFn: (ctx: SeedContext) => Promise<void>): Promise<void> {
      await ensureInit()
      const ctx = buildSeedContext(adapter)
      log.info('Running seed function...')
      await seedFn(ctx)
      log.info('Seed complete')
    },

    async squash(): Promise<string> {
      await ensureInit()
      const files = discoverMigrationFiles(resolvedDir)

      if (files.length <= 1) {
        log.info('Nothing to squash (0 or 1 migration)')
        return ''
      }

      // Collect all up SQL from existing migration files
      const upStatements: string[] = []
      const downStatements: string[] = []

      for (const file of files) {
        const content = fs.readFileSync(file.filepath, 'utf-8')

        // Extract the body of the up function
        const upMatch = content.match(/export\s+async\s+function\s+up\s*\([^)]*\)\s*:\s*Promise<void>\s*\{([\s\S]*?)\n\}/m)
        if (upMatch) {
          upStatements.push(`  // From: ${file.version}_${file.name}`)
          upStatements.push(upMatch[1].trim())
        }

        // Extract the body of the down function
        const downMatch = content.match(/export\s+async\s+function\s+down\s*\([^)]*\)\s*:\s*Promise<void>\s*\{([\s\S]*?)\n\}/m)
        if (downMatch) {
          downStatements.unshift(`  // From: ${file.version}_${file.name}`)
          downStatements.unshift(downMatch[1].trim())
        }
      }

      const timestamp = generateTimestamp()
      const squashedName = 'squashed_migrations'
      const filename = `${timestamp}_${squashedName}.ts`

      const squashedContent = `import type { DatabaseAdapter } from '@vibekit/sdk/db/types'

/**
 * Squashed migration combining ${files.length} migrations
 * Original versions: ${files[0].version} through ${files[files.length - 1].version}
 * Squashed at: ${new Date().toISOString()}
 */
export async function up(adapter: DatabaseAdapter): Promise<void> {
${upStatements.join('\n')}
}

export async function down(adapter: DatabaseAdapter): Promise<void> {
${downStatements.join('\n')}
}
`

      // Remove old migration files
      for (const file of files) {
        try {
          fs.unlinkSync(file.filepath)
        } catch {
          // Ignore errors when removing old files
        }
      }

      // Clear applied migration records
      await adapter.execute(`DELETE FROM "${MIGRATIONS_TABLE}"`)

      // Write squashed file
      const filepath = path.join(resolvedDir, filename)
      fs.writeFileSync(filepath, squashedContent, 'utf-8')

      // Record the squashed migration as applied
      const checksum = simpleChecksum(squashedContent)
      await adapter.execute(
        `INSERT INTO "${MIGRATIONS_TABLE}" (version, name, checksum) VALUES ($1, $2, $3)`,
        [timestamp, squashedName, checksum]
      )

      log.info(`Squashed ${files.length} migrations into ${filename}`)
      return filepath
    },

    async lock(): Promise<boolean> {
      await ensureInit()
      const row = await adapter.queryOne<{ locked_at: string | null }>(
        `SELECT locked_at FROM "${LOCK_TABLE}" WHERE id = 1`
      )

      if (row && row.locked_at !== null) {
        // Check if lock is stale (older than 10 minutes)
        const lockedAt = new Date(row.locked_at).getTime()
        const staleThreshold = 10 * 60 * 1000
        if (Date.now() - lockedAt < staleThreshold) {
          log.warn('Migrations are locked by another process')
          return false
        }
        // Lock is stale, allow override
        log.warn('Overriding stale migration lock')
      }

      await adapter.execute(
        `UPDATE "${LOCK_TABLE}" SET locked_at = $1, locked_by = $2 WHERE id = 1`,
        [new Date().toISOString(), `pid-${process.pid}`]
      )
      return true
    },

    async unlock(): Promise<void> {
      await ensureInit()
      await adapter.execute(
        `UPDATE "${LOCK_TABLE}" SET locked_at = NULL, locked_by = NULL WHERE id = 1`
      )
      log.info('Migration lock released')
    },
  }

  return manager
}
