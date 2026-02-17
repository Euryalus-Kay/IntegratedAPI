import type { Command } from 'commander'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  table,
  badge,
  bold,
  dim,
  green,
  red,
  yellow,
  cyan,
  formatBytes,
  box,
  list,
  errorBox,
} from '../utils/format.js'
import { getProjectSummary, runHealthCheck, detectFramework } from '../utils/diagnostics.js'

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show comprehensive project dashboard')
    .action(async () => {
      try {
        const { getConfig, db, auth } = await import('vibekit')
        const config = getConfig()
        const modules = config.modules

        const dbEnabled = !!modules.db
        const authEnabled = typeof modules.auth === 'object' ? modules.auth.enabled : !!modules.auth
        const storageEnabled = typeof modules.storage === 'object' ? modules.storage.enabled : !!modules.storage
        const emailEnabled = typeof modules.email === 'object' ? modules.email.enabled : !!modules.email
        const realtimeEnabled = !!modules.realtime

        // ── Header ──────────────────────────────────────────────────────

        console.log('')
        console.log(cyan(bold(`  ${config.name}`)) + dim(` — VibeKit Project`))
        console.log('')

        // ── Module Status ───────────────────────────────────────────────

        console.log(bold('  Modules'))
        console.log('')

        const moduleIndicator = (name: string, enabled: boolean): string =>
          enabled
            ? `  ${green('●')} ${bold(name.padEnd(12))} ${badge('ENABLED', 'green')}`
            : `  ${dim('○')} ${dim(name.padEnd(12))} ${badge('DISABLED', 'yellow')}`

        console.log(moduleIndicator('Database', dbEnabled))
        console.log(moduleIndicator('Auth', authEnabled))
        console.log(moduleIndicator('Storage', storageEnabled))
        console.log(moduleIndicator('Email', emailEnabled))
        console.log(moduleIndicator('Realtime', realtimeEnabled))
        console.log('')

        // ── Database Info ───────────────────────────────────────────────

        console.log(bold('  Database'))
        console.log('')

        const dbPath = config.dbPath
        if (existsSync(dbPath)) {
          const stat = statSync(dbPath)
          console.log(`  ${dim('Path:')}       ${dbPath}`)
          console.log(`  ${dim('File size:')}  ${formatBytes(stat.size)}`)
          console.log(`  ${dim('Modified:')}   ${stat.mtime.toLocaleString()}`)

          try {
            const tablesResult = await db.query<{ name: string }>(
              "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
            let totalRows = 0
            const tableRows: string[][] = []
            for (const row of tablesResult.rows) {
              try {
                const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
                const count = countResult?.count ?? 0
                totalRows += count
                tableRows.push([row.name, String(count)])
              } catch {
                tableRows.push([row.name, '?'])
              }
            }

            console.log(`  ${dim('Tables:')}     ${tablesResult.rows.length}`)
            console.log(`  ${dim('Total rows:')} ${totalRows}`)

            if (tableRows.length > 0) {
              console.log('')
              console.log(table(['Table', 'Rows'], tableRows))
            }
          } catch {
            console.log(`  ${dim('Tables:')}     ${yellow('Unable to query')}`)
          }
        } else {
          console.log(`  ${dim('Status:')}     ${yellow('No database file yet')}`)
          console.log(`  ${dim('Path:')}       ${dbPath}`)
        }
        console.log('')

        // ── Storage Info ────────────────────────────────────────────────

        console.log(bold('  Storage'))
        console.log('')

        const storagePath = config.storagePath
        if (existsSync(storagePath)) {
          const { fileCount, totalSize } = getDirectoryStats(storagePath)
          console.log(`  ${dim('Path:')}       ${storagePath}`)
          console.log(`  ${dim('Files:')}      ${fileCount}`)
          console.log(`  ${dim('Total size:')} ${formatBytes(totalSize)}`)
        } else {
          console.log(`  ${dim('Status:')}     ${dim('No storage directory yet')}`)
          console.log(`  ${dim('Path:')}       ${storagePath}`)
        }
        console.log('')

        // ── Auth Info ───────────────────────────────────────────────────

        if (authEnabled) {
          console.log(bold('  Auth'))
          console.log('')

          try {
            const userCount = await auth.countUsers()
            console.log(`  ${dim('Users:')}      ${userCount}`)

            try {
              const sessionResult = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM vibekit_sessions')
              console.log(`  ${dim('Sessions:')}   ${sessionResult?.count ?? 0}`)
            } catch {
              console.log(`  ${dim('Sessions:')}   ${dim('N/A')}`)
            }
          } catch {
            console.log(`  ${dim('Status:')}     ${yellow('Auth tables not initialized')}`)
          }
          console.log('')
        }

        // ── Environment Info ────────────────────────────────────────────

        console.log(bold('  Environment'))
        console.log('')

        const framework = config.framework || detectFramework()
        console.log(`  ${dim('Node:')}       ${process.version}`)
        console.log(`  ${dim('Framework:')}  ${framework}`)
        console.log(`  ${dim('Env mode:')}   ${config.env}`)
        console.log(`  ${dim('Port:')}       ${config.port}`)
        console.log(`  ${dim('Data dir:')}   ${config.dataDir}`)
        console.log('')

        // ── Key Files ───────────────────────────────────────────────────

        console.log(bold('  Key Files'))
        console.log('')

        const keyFiles = [
          { path: 'vibekit.json', label: 'vibekit.json' },
          { path: 'vibekit/schema.ts', label: 'vibekit/schema.ts' },
          { path: 'vibekit/seed.ts', label: 'vibekit/seed.ts' },
          { path: '.vibekit/local.db', label: '.vibekit/local.db' },
          { path: 'package.json', label: 'package.json' },
        ]

        for (const file of keyFiles) {
          const fullPath = join(process.cwd(), file.path)
          if (existsSync(fullPath)) {
            const stat = statSync(fullPath)
            const modified = stat.mtime.toLocaleString()
            console.log(`  ${green('●')} ${file.label.padEnd(22)} ${dim(modified)}`)
          } else {
            console.log(`  ${dim('○')} ${dim(file.label.padEnd(22))} ${dim('not found')}`)
          }
        }
        console.log('')

      } catch (e: any) {
        console.log('')
        console.log(errorBox(
          'Project Status Error',
          e.message,
          'Make sure you are in a VibeKit project directory (with vibekit.json).'
        ))
      }
    })
}

// ─── Helper ────────────────────────────────────────────────────────────────

function getDirectoryStats(dirPath: string): { fileCount: number; totalSize: number } {
  const { readdirSync, statSync: statSyncLocal } = require('node:fs')
  const { join: joinLocal } = require('node:path')

  let fileCount = 0
  let totalSize = 0

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = joinLocal(dirPath, entry.name)
      if (entry.isFile()) {
        fileCount++
        try {
          totalSize += statSyncLocal(fullPath).size
        } catch {
          // skip
        }
      } else if (entry.isDirectory()) {
        const sub = getDirectoryStats(fullPath)
        fileCount += sub.fileCount
        totalSize += sub.totalSize
      }
    }
  } catch {
    // directory not readable
  }

  return { fileCount, totalSize }
}
