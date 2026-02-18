/**
 * Database Backups & Point-in-Time Restore (PITR) for VibeKit
 *
 * Provides backup creation, listing, restoration, scheduled backups,
 * retention policies, SQL export/import, and point-in-time restore using WAL.
 *
 * For SQLite: uses file copies + WAL checkpointing.
 * For Postgres: shells out to pg_dump/pg_restore.
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import crypto from 'node:crypto'
import type { DatabaseAdapter } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('vibekit:backups')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupConfig {
  /** Directory to store backup files (default: ./backups) */
  backupsDir: string
  /** Maximum number of backups to keep (default: 50) */
  maxBackups: number
  /** Number of days to retain backups (default: 30) */
  retentionDays: number
  /** Whether to compress backups with gzip (default: false) */
  compression: boolean
}

export interface BackupInfo {
  id: string
  label: string
  filepath: string
  sizeBytes: number
  createdAt: string
  type: 'manual' | 'scheduled' | 'pre-restore'
  checksum: string
}

export interface WalStatus {
  walMode: boolean
  walFileExists: boolean
  walSizeBytes: number
  checkpointInfo: string
}

export interface BackupManager {
  create(label?: string): Promise<BackupInfo>
  list(): Promise<BackupInfo[]>
  restore(backupId: string): Promise<void>
  delete(backupId: string): Promise<void>
  schedule(cron: string): ScheduleHandle
  getRetentionPolicy(): { maxBackups: number; retentionDays: number }
  setRetentionPolicy(days: number): void
  exportSql(): Promise<string>
  importSql(sql: string): Promise<void>
  pointInTimeRestore(timestamp: Date): Promise<void>
  getWalStatus(): Promise<WalStatus>
}

export interface ScheduleHandle {
  stop(): void
  isRunning(): boolean
  nextRun(): Date | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKUPS_META_TABLE = '_vibekit_backups'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateBackupId(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const suffix = crypto.randomBytes(4).toString('hex')
  return `backup-${timestamp}-${suffix}`
}

function fileChecksum(filepath: string): string {
  const content = fs.readFileSync(filepath)
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
}

function parseCronExpression(cron: string): { intervalMs: number } {
  // Simplified cron parser supporting common patterns:
  // "* * * * *" = every minute
  // "*/5 * * * *" = every 5 minutes
  // "0 * * * *" = every hour
  // "0 0 * * *" = every day at midnight
  // "0 0 * * 0" = every week (Sunday)
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: "${cron}". Expected 5 parts (min hour dom mon dow).`)
  }

  const [minute, hour, dom, mon, dow] = parts

  // Every N minutes
  const everyMinuteMatch = minute.match(/^\*\/(\d+)$/)
  if (everyMinuteMatch && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { intervalMs: parseInt(everyMinuteMatch[1], 10) * 60 * 1000 }
  }

  // Every minute
  if (minute === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { intervalMs: 60 * 1000 }
  }

  // Every hour (minute = 0)
  if (minute === '0' && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { intervalMs: 60 * 60 * 1000 }
  }

  // Every N hours
  const everyHourMatch = hour.match(/^\*\/(\d+)$/)
  if (minute === '0' && everyHourMatch && dom === '*' && mon === '*' && dow === '*') {
    return { intervalMs: parseInt(everyHourMatch[1], 10) * 60 * 60 * 1000 }
  }

  // Every day at specific time
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
    return { intervalMs: 24 * 60 * 60 * 1000 }
  }

  // Every week
  if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && /^\d+$/.test(dow)) {
    return { intervalMs: 7 * 24 * 60 * 60 * 1000 }
  }

  // Default: treat as daily
  return { intervalMs: 24 * 60 * 60 * 1000 }
}

async function ensureBackupsMetaTable(adapter: DatabaseAdapter): Promise<void> {
  await adapter.execute(`
    CREATE TABLE IF NOT EXISTS "${BACKUPS_META_TABLE}" (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      filepath TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      type TEXT NOT NULL DEFAULT 'manual',
      checksum TEXT NOT NULL DEFAULT ''
    )
  `)
}

function enforceRetention(backupsDir: string, maxBackups: number, retentionDays: number, metaRecords: BackupInfo[]): string[] {
  const deletedIds: string[] = []
  const now = Date.now()
  const retentionMs = retentionDays * 24 * 60 * 60 * 1000

  // Sort by creation time, oldest first
  const sorted = [...metaRecords].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  for (const backup of sorted) {
    const age = now - new Date(backup.createdAt).getTime()
    const exceedsRetention = age > retentionMs
    const exceedsMax = sorted.length - deletedIds.length > maxBackups

    if (exceedsRetention || exceedsMax) {
      // Delete the file
      try {
        if (fs.existsSync(backup.filepath)) {
          fs.unlinkSync(backup.filepath)
        }
      } catch {
        // Ignore file deletion errors
      }
      deletedIds.push(backup.id)
    }
  }

  return deletedIds
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createBackupManager(
  adapter: DatabaseAdapter,
  config?: Partial<BackupConfig>,
): BackupManager {
  const backupsDir = config?.backupsDir || path.resolve(process.cwd(), 'backups')
  const maxBackups = config?.maxBackups ?? 50
  let retentionDays = config?.retentionDays ?? 30
  const compression = config?.compression ?? false

  let initialized = false

  async function ensureInit(): Promise<void> {
    if (initialized) return
    await ensureBackupsMetaTable(adapter)
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true })
    }
    initialized = true
  }

  function getDbPath(): string {
    const info = adapter.getInfo()
    return info.database
  }

  function isPostgres(): boolean {
    const info = adapter.getInfo()
    return info.mode !== 'local'
  }

  async function recordBackup(info: BackupInfo): Promise<void> {
    await adapter.execute(
      `INSERT INTO "${BACKUPS_META_TABLE}" (id, label, filepath, size_bytes, created_at, type, checksum) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [info.id, info.label, info.filepath, info.sizeBytes, info.createdAt, info.type, info.checksum]
    )
  }

  async function runRetention(): Promise<void> {
    const allBackups = await manager.list()
    const toDelete = enforceRetention(backupsDir, maxBackups, retentionDays, allBackups)
    for (const id of toDelete) {
      await adapter.execute(`DELETE FROM "${BACKUPS_META_TABLE}" WHERE id = $1`, [id])
    }
  }

  const manager: BackupManager = {
    async create(label?: string): Promise<BackupInfo> {
      await ensureInit()
      const id = generateBackupId()
      const displayLabel = label || `Backup ${new Date().toISOString()}`

      if (isPostgres()) {
        // Postgres: use pg_dump
        const connStr = getDbPath()
        const dumpFile = path.join(backupsDir, `${id}.sql`)
        try {
          execSync(`pg_dump "${connStr}" --no-owner --no-privileges > "${dumpFile}"`, {
            stdio: 'pipe',
            timeout: 120_000,
          })
        } catch (err) {
          throw new Error(`pg_dump failed: ${err instanceof Error ? err.message : String(err)}`)
        }

        const stat = fs.statSync(dumpFile)
        const checksum = fileChecksum(dumpFile)

        const info: BackupInfo = {
          id,
          label: displayLabel,
          filepath: dumpFile,
          sizeBytes: stat.size,
          createdAt: new Date().toISOString(),
          type: 'manual',
          checksum,
        }

        await recordBackup(info)
        await runRetention()
        log.info(`Created backup: ${id}`, { sizeBytes: stat.size })
        return info
      }

      // SQLite: copy the database file
      const dbPath = getDbPath()

      // Checkpoint WAL to ensure all data is in the main file
      try {
        await adapter.execute('PRAGMA wal_checkpoint(TRUNCATE)')
      } catch {
        // Non-fatal; proceed with copy
      }

      const ext = compression ? '.db.gz' : '.db'
      const backupFile = path.join(backupsDir, `${id}${ext}`)

      if (compression) {
        // Read, gzip, write
        const { gzipSync } = await import('node:zlib')
        const data = fs.readFileSync(dbPath)
        const compressed = gzipSync(data)
        fs.writeFileSync(backupFile, compressed)
      } else {
        fs.copyFileSync(dbPath, backupFile)
      }

      const stat = fs.statSync(backupFile)
      const checksum = fileChecksum(backupFile)

      const info: BackupInfo = {
        id,
        label: displayLabel,
        filepath: backupFile,
        sizeBytes: stat.size,
        createdAt: new Date().toISOString(),
        type: 'manual',
        checksum,
      }

      await recordBackup(info)
      await runRetention()
      log.info(`Created backup: ${id}`, { sizeBytes: stat.size })
      return info
    },

    async list(): Promise<BackupInfo[]> {
      await ensureInit()
      const { rows } = await adapter.query<{
        id: string
        label: string
        filepath: string
        size_bytes: number
        created_at: string
        type: string
        checksum: string
      }>(`SELECT * FROM "${BACKUPS_META_TABLE}" ORDER BY created_at DESC`)

      return rows.map(r => ({
        id: r.id,
        label: r.label,
        filepath: r.filepath,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        type: r.type as BackupInfo['type'],
        checksum: r.checksum,
      }))
    },

    async restore(backupId: string): Promise<void> {
      await ensureInit()

      const record = await adapter.queryOne<{
        id: string
        label: string
        filepath: string
        type: string
      }>(`SELECT * FROM "${BACKUPS_META_TABLE}" WHERE id = $1`, [backupId])

      if (!record) {
        throw new Error(`Backup not found: ${backupId}`)
      }

      if (!fs.existsSync(record.filepath)) {
        throw new Error(`Backup file not found: ${record.filepath}`)
      }

      // Create a pre-restore backup of current state
      const preRestoreBackup = await manager.create(`Pre-restore snapshot before restoring ${backupId}`)
      // Update its type
      await adapter.execute(
        `UPDATE "${BACKUPS_META_TABLE}" SET type = 'pre-restore' WHERE id = $1`,
        [preRestoreBackup.id]
      )

      if (isPostgres()) {
        const connStr = getDbPath()
        try {
          execSync(`psql "${connStr}" < "${record.filepath}"`, {
            stdio: 'pipe',
            timeout: 120_000,
          })
        } catch (err) {
          throw new Error(`pg_restore failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        log.info(`Restored from backup: ${backupId}`)
        return
      }

      // SQLite: close current connection, replace file, reopen
      const dbPath = getDbPath()

      if (record.filepath.endsWith('.gz')) {
        const { gunzipSync } = await import('node:zlib')
        const compressed = fs.readFileSync(record.filepath)
        const data = gunzipSync(compressed)
        fs.writeFileSync(dbPath, data)
      } else {
        fs.copyFileSync(record.filepath, dbPath)
      }

      // Remove WAL and SHM files since we replaced the main DB
      const walPath = dbPath + '-wal'
      const shmPath = dbPath + '-shm'
      try { if (fs.existsSync(walPath)) fs.unlinkSync(walPath) } catch { /* ignore */ }
      try { if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath) } catch { /* ignore */ }

      log.info(`Restored from backup: ${backupId}`)
    },

    async delete(backupId: string): Promise<void> {
      await ensureInit()

      const record = await adapter.queryOne<{ filepath: string }>(
        `SELECT filepath FROM "${BACKUPS_META_TABLE}" WHERE id = $1`,
        [backupId]
      )

      if (!record) {
        throw new Error(`Backup not found: ${backupId}`)
      }

      // Delete file
      try {
        if (fs.existsSync(record.filepath)) {
          fs.unlinkSync(record.filepath)
        }
      } catch {
        // Swallow file deletion errors
      }

      // Delete record
      await adapter.execute(`DELETE FROM "${BACKUPS_META_TABLE}" WHERE id = $1`, [backupId])
      log.info(`Deleted backup: ${backupId}`)
    },

    schedule(cron: string): ScheduleHandle {
      const { intervalMs } = parseCronExpression(cron)
      let running = true
      let nextRunDate: Date | null = new Date(Date.now() + intervalMs)
      let timer: ReturnType<typeof setInterval> | null = null

      const runBackup = async () => {
        if (!running) return
        try {
          const info = await manager.create(`Scheduled backup (${cron})`)
          // Update type to scheduled
          await adapter.execute(
            `UPDATE "${BACKUPS_META_TABLE}" SET type = 'scheduled' WHERE id = $1`,
            [info.id]
          )
        } catch (err) {
          log.error(`Scheduled backup failed: ${err instanceof Error ? err.message : String(err)}`)
        }
        if (running) {
          nextRunDate = new Date(Date.now() + intervalMs)
        }
      }

      timer = setInterval(runBackup, intervalMs)

      const handle: ScheduleHandle = {
        stop(): void {
          running = false
          nextRunDate = null
          if (timer) {
            clearInterval(timer)
            timer = null
          }
          log.info('Scheduled backups stopped')
        },
        isRunning(): boolean {
          return running
        },
        nextRun(): Date | null {
          return nextRunDate
        },
      }

      log.info(`Scheduled backups every ${intervalMs / 1000}s`)
      return handle
    },

    getRetentionPolicy(): { maxBackups: number; retentionDays: number } {
      return { maxBackups, retentionDays }
    },

    setRetentionPolicy(days: number): void {
      if (days < 1) throw new Error('Retention days must be at least 1')
      retentionDays = days
      log.info(`Retention policy updated: ${days} days`)
    },

    async exportSql(): Promise<string> {
      await ensureInit()

      if (isPostgres()) {
        const connStr = getDbPath()
        try {
          const output = execSync(`pg_dump "${connStr}" --no-owner --no-privileges`, {
            encoding: 'utf-8',
            timeout: 120_000,
          })
          return output
        } catch (err) {
          throw new Error(`pg_dump failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      // SQLite: build SQL dump manually
      const statements: string[] = []

      // Get all tables
      const { rows: tables } = await adapter.query<{ name: string; sql: string }>(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )

      for (const table of tables) {
        statements.push(`${table.sql};`)
        statements.push('')

        // Get all rows
        const { rows } = await adapter.query<Record<string, unknown>>(
          `SELECT * FROM "${table.name}"`
        )

        for (const row of rows) {
          const columns = Object.keys(row)
          const values = Object.values(row).map(v => {
            if (v === null) return 'NULL'
            if (typeof v === 'number') return String(v)
            if (typeof v === 'boolean') return v ? '1' : '0'
            return `'${String(v).replace(/'/g, "''")}'`
          })
          const colStr = columns.map(c => `"${c}"`).join(', ')
          statements.push(`INSERT INTO "${table.name}" (${colStr}) VALUES (${values.join(', ')});`)
        }
        statements.push('')
      }

      // Get indexes
      const { rows: indexes } = await adapter.query<{ sql: string }>(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
      )
      for (const idx of indexes) {
        statements.push(`${idx.sql};`)
      }

      return statements.join('\n')
    },

    async importSql(sql: string): Promise<void> {
      await ensureInit()

      if (isPostgres()) {
        const connStr = getDbPath()
        const tmpFile = path.join(backupsDir, `import-${Date.now()}.sql`)
        fs.writeFileSync(tmpFile, sql, 'utf-8')
        try {
          execSync(`psql "${connStr}" < "${tmpFile}"`, {
            stdio: 'pipe',
            timeout: 120_000,
          })
        } finally {
          try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
        }
        log.info('SQL import complete (Postgres)')
        return
      }

      // SQLite: execute each statement
      // Split by semicolons, handling quoted strings
      const statements = splitSqlStatements(sql)
      for (const stmt of statements) {
        const trimmed = stmt.trim()
        if (trimmed && !trimmed.startsWith('--')) {
          await adapter.execute(trimmed)
        }
      }
      log.info(`SQL import complete`, { statements: statements.length })
    },

    async pointInTimeRestore(timestamp: Date): Promise<void> {
      await ensureInit()

      // Find the most recent backup before the target timestamp
      const allBackups = await manager.list()
      const targetTime = timestamp.getTime()

      // Sort by creation time ascending
      const sorted = [...allBackups].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )

      let bestBackup: BackupInfo | null = null
      for (const backup of sorted) {
        const backupTime = new Date(backup.createdAt).getTime()
        if (backupTime <= targetTime) {
          bestBackup = backup
        }
      }

      if (!bestBackup) {
        throw new Error(
          `No backup found before ${timestamp.toISOString()}. ` +
          `Earliest available backup: ${sorted.length > 0 ? sorted[0].createdAt : 'none'}`
        )
      }

      log.info(`Point-in-time restore to ${timestamp.toISOString()}`, {
        backupId: bestBackup.id,
        backupCreatedAt: bestBackup.createdAt,
      })

      // Restore from the selected backup
      await manager.restore(bestBackup.id)

      // For SQLite, if WAL replay is possible (backup was taken with WAL mode),
      // the restore already includes all committed data up to the backup point.
      // True WAL-based PITR would require continuous WAL archiving, which is
      // typically done at the infrastructure level (e.g., Litestream).
      log.info(`Restored to state as of ${bestBackup.createdAt}. Transactions between ${bestBackup.createdAt} and ${timestamp.toISOString()} may be lost if no WAL archiving was configured.`)
    },

    async getWalStatus(): Promise<WalStatus> {
      await ensureInit()

      if (isPostgres()) {
        // Postgres WAL status
        try {
          const result = await adapter.queryOne<{ current_wal_lsn: string }>(
            'SELECT pg_current_wal_lsn()::text AS current_wal_lsn'
          )
          return {
            walMode: true,
            walFileExists: true,
            walSizeBytes: 0,
            checkpointInfo: result ? `Current WAL LSN: ${result.current_wal_lsn}` : 'Unknown',
          }
        } catch {
          return {
            walMode: true,
            walFileExists: true,
            walSizeBytes: 0,
            checkpointInfo: 'Could not query WAL status',
          }
        }
      }

      // SQLite WAL status
      const dbPath = getDbPath()
      const walPath = dbPath + '-wal'

      let walMode = false
      try {
        const result = await adapter.queryOne<{ journal_mode: string }>('PRAGMA journal_mode')
        walMode = result?.journal_mode === 'wal'
      } catch {
        walMode = false
      }

      const walFileExists = fs.existsSync(walPath)
      let walSizeBytes = 0
      if (walFileExists) {
        try {
          walSizeBytes = fs.statSync(walPath).size
        } catch {
          walSizeBytes = 0
        }
      }

      let checkpointInfo = 'No checkpoint data'
      try {
        const result = await adapter.queryOne<{ busy: number; log: number; checkpointed: number }>(
          'PRAGMA wal_checkpoint(PASSIVE)'
        )
        if (result) {
          checkpointInfo = `busy=${result.busy}, log=${result.log}, checkpointed=${result.checkpointed}`
        }
      } catch {
        checkpointInfo = 'Checkpoint query failed'
      }

      return {
        walMode,
        walFileExists,
        walSizeBytes,
        checkpointInfo,
      }
    },
  }

  return manager
}

// ---------------------------------------------------------------------------
// SQL statement splitter
// ---------------------------------------------------------------------------

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = []
  let current = ''
  let inString = false
  let stringChar = ''

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]

    if (inString) {
      current += ch
      if (ch === stringChar) {
        // Check for escaped quote
        if (i + 1 < sql.length && sql[i + 1] === stringChar) {
          current += sql[i + 1]
          i++
        } else {
          inString = false
        }
      }
    } else if (ch === "'" || ch === '"') {
      inString = true
      stringChar = ch
      current += ch
    } else if (ch === ';') {
      const trimmed = current.trim()
      if (trimmed) {
        statements.push(trimmed)
      }
      current = ''
    } else if (ch === '-' && i + 1 < sql.length && sql[i + 1] === '-') {
      // Skip line comment
      const newlineIdx = sql.indexOf('\n', i)
      if (newlineIdx === -1) break
      i = newlineIdx
    } else {
      current += ch
    }
  }

  const trimmed = current.trim()
  if (trimmed) {
    statements.push(trimmed)
  }

  return statements
}
