import type { Command } from 'commander'
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import prompts from 'prompts'
import {
  table,
  badge,
  bold,
  dim,
  green,
  red,
  yellow,
  cyan,
  spinner,
  progressBar,
  formatBytes,
  successBox,
  errorBox,
} from '../utils/format.js'

export function registerDbCommands(program: Command): void {
  const dbCmd = program
    .command('db')
    .description('Database management commands')

  // ── db push ──────────────────────────────────────────────────────────────

  dbCmd
    .command('push')
    .description('Sync schema definitions to database')
    .action(async () => {
      const s = spinner('Syncing schema to database...')
      try {
        const { db } = await import('vibekit')
        const result = await db.sync()

        if (result.created.length === 0 && result.modified.length === 0) {
          s.succeed('Database is up to date. No changes needed.')
          return
        }

        s.succeed('Schema synced successfully.')
        console.log('')

        if (result.created.length > 0) {
          console.log(green(bold('  Created tables:')))
          for (const tableName of result.created) {
            console.log(`    ${green('+')} ${bold(tableName)}`)
          }
          console.log('')
        }

        if (result.modified.length > 0) {
          console.log(yellow(bold('  Modified columns:')))
          for (const col of result.modified) {
            console.log(`    ${yellow('~')} ${col}`)
          }
          console.log('')
        }

        const summary = [
          result.created.length > 0 ? green(`${result.created.length} table(s) created`) : null,
          result.modified.length > 0 ? yellow(`${result.modified.length} column(s) modified`) : null,
        ].filter(Boolean).join(', ')

        console.log(`  ${badge('DONE', 'green')} ${summary}`)
        console.log('')
      } catch (e: any) {
        s.fail('Schema sync failed.')
        console.log('')
        console.log(errorBox('Database Sync Error', e.message, 'Check your schema definitions in vibekit/ directory.'))
      }
    })

  // ── db studio ────────────────────────────────────────────────────────────

  dbCmd
    .command('studio')
    .description('Browse database tables in terminal')
    .option('--table <name>', 'Show only a specific table')
    .option('--limit <rows>', 'Rows per table', '10')
    .action(async (options: { table?: string; limit: string }) => {
      const rowLimit = parseInt(options.limit, 10) || 10
      try {
        const { db } = await import('vibekit')
        const info = db.getConnectionInfo()
        console.log('')
        console.log(`  ${bold('Database:')} ${info.mode} ${dim(`(${info.database})`)}`)
        console.log('')

        let tableNames: string[] = []

        if (options.table) {
          tableNames = [options.table]
        } else {
          const result = await db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
          )
          tableNames = result.rows.map(r => r.name)
        }

        if (tableNames.length === 0) {
          console.log(dim('  No tables found. Run "vibekit db push" to create tables.'))
          console.log('')
          return
        }

        for (const tableName of tableNames) {
          // Get column info
          const columnsResult = await db.query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }>(
            `PRAGMA table_info("${tableName}")`
          )

          const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${tableName}"`)
          const totalRows = countResult?.count ?? 0

          console.log(`  ${cyan(bold(tableName))} ${dim(`(${totalRows} rows)`)}`)

          // Show column types
          const colTypeHeaders = ['Column', 'Type', 'Nullable', 'Default', 'PK']
          const colTypeRows = columnsResult.rows.map(col => [
            col.name,
            col.type || 'TEXT',
            col.notnull ? red('NOT NULL') : dim('nullable'),
            col.dflt_value !== null ? dim(String(col.dflt_value)) : dim('-'),
            col.pk ? yellow('YES') : dim('-'),
          ])
          console.log(table(colTypeHeaders, colTypeRows))
          console.log('')

          // Show data
          if (totalRows === 0) {
            console.log(dim('    (empty table)'))
          } else {
            const dataResult = await db.query<Record<string, unknown>>(`SELECT * FROM "${tableName}" LIMIT ${rowLimit}`)
            if (dataResult.rows.length > 0) {
              const columnNames = Object.keys(dataResult.rows[0])
              const dataHeaders = columnNames
              const dataRows = dataResult.rows.map(row =>
                columnNames.map(col => {
                  const val = row[col]
                  if (val === null || val === undefined) return dim('NULL')
                  const str = String(val)
                  return str.length > 40 ? str.slice(0, 37) + '...' : str
                })
              )
              console.log(table(dataHeaders, dataRows))

              if (totalRows > rowLimit) {
                console.log(dim(`    ... and ${totalRows - rowLimit} more rows (use --limit to show more)`))
              }
            }
          }

          console.log('')
          console.log(dim('  ' + '─'.repeat(70)))
          console.log('')
        }
      } catch (e: any) {
        console.log('')
        console.log(errorBox('Database Error', e.message))
      }
    })

  // ── db pull ──────────────────────────────────────────────────────────────

  dbCmd
    .command('pull')
    .description('Export current database schema')
    .action(async () => {
      try {
        const { db } = await import('vibekit')
        const info = db.getConnectionInfo()
        console.log('')
        console.log(`  ${bold('Database:')} ${info.mode} ${dim(`(${info.database})`)}`)
        console.log('')

        const tablesResult = await db.query<{ name: string; sql: string }>(
          "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )

        if (tablesResult.rows.length === 0) {
          console.log(dim('  No tables found.'))
          console.log('')
          return
        }

        // Indexes
        const indexResult = await db.query<{ name: string; tbl_name: string; sql: string | null }>(
          "SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY tbl_name, name"
        )
        const indexesByTable: Record<string, string[]> = {}
        for (const idx of indexResult.rows) {
          if (idx.sql) {
            if (!indexesByTable[idx.tbl_name]) indexesByTable[idx.tbl_name] = []
            indexesByTable[idx.tbl_name].push(idx.sql)
          }
        }

        for (const row of tablesResult.rows) {
          const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
          const count = countResult?.count ?? 0

          console.log(cyan(bold(`  -- Table: ${row.name}`)) + dim(` (${count} rows)`))
          console.log(`  ${row.sql};`)

          if (indexesByTable[row.name]) {
            for (const idxSql of indexesByTable[row.name]) {
              console.log(`  ${dim(idxSql + ';')}`)
            }
          }

          console.log('')
        }

        console.log(dim(`  -- ${tablesResult.rows.length} table(s) exported`))
        console.log('')
      } catch (e: any) {
        console.log('')
        console.log(errorBox('Database Error', e.message))
      }
    })

  // ── db reset ─────────────────────────────────────────────────────────────

  dbCmd
    .command('reset')
    .description('Drop all tables and re-sync schema')
    .option('--force', 'Skip confirmation prompt')
    .action(async (options: { force?: boolean }) => {
      try {
        const { db } = await import('vibekit')

        // Show what will be deleted
        const tablesResult = await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )

        if (tablesResult.rows.length === 0) {
          console.log('')
          console.log(dim('  No tables to reset.'))
          console.log('')
          return
        }

        console.log('')
        console.log(red(bold('  The following tables will be dropped:')))
        console.log('')

        for (const row of tablesResult.rows) {
          const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
          const count = countResult?.count ?? 0
          console.log(`    ${red('x')} ${row.name} ${dim(`(${count} rows)`)}`)
        }
        console.log('')

        if (!options.force) {
          const response = await prompts({
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to reset the database? All data will be lost.',
            initial: false,
          })

          if (!response.confirm) {
            console.log(dim('  Reset cancelled.'))
            console.log('')
            return
          }
        }

        const s = spinner('Resetting database...')
        await db.reset()
        s.succeed('Database reset complete.')

        // Re-sync
        const syncResult = await db.sync()
        if (syncResult.created.length > 0) {
          console.log('')
          console.log(green(bold('  Recreated tables:')))
          for (const tableName of syncResult.created) {
            console.log(`    ${green('+')} ${tableName}`)
          }
        }
        console.log('')
      } catch (e: any) {
        console.log('')
        console.log(errorBox('Database Reset Error', e.message))
      }
    })

  // ── db seed ──────────────────────────────────────────────────────────────

  dbCmd
    .command('seed')
    .description('Run vibekit/seed.ts if it exists')
    .action(async () => {
      const { default: fs } = await import('node:fs')
      const { default: path } = await import('node:path')
      const seedPath = path.join(process.cwd(), 'vibekit', 'seed.ts')
      if (!fs.existsSync(seedPath)) {
        console.log('')
        console.log(errorBox(
          'No Seed File',
          'Could not find vibekit/seed.ts',
          'Create a seed file at vibekit/seed.ts to populate your database with test data.'
        ))
        return
      }

      console.log('')
      const s = spinner('Running seed file...')

      try {
        const { db } = await import('vibekit')

        // Get row counts before
        const tablesResult = await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        const beforeCounts: Record<string, number> = {}
        for (const row of tablesResult.rows) {
          const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
          beforeCounts[row.name] = countResult?.count ?? 0
        }

        await import(seedPath)

        // Get row counts after
        const afterCounts: Record<string, number> = {}
        for (const row of tablesResult.rows) {
          const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
          afterCounts[row.name] = countResult?.count ?? 0
        }

        s.succeed('Seed completed successfully.')
        console.log('')

        let anyChanges = false
        for (const tableName of tablesResult.rows.map(r => r.name)) {
          const before = beforeCounts[tableName] ?? 0
          const after = afterCounts[tableName] ?? 0
          const diff = after - before
          if (diff > 0) {
            anyChanges = true
            console.log(`  ${green('+')} ${tableName}: ${green(`+${diff}`)} rows ${dim(`(${before} -> ${after})`)}`)
          } else if (diff < 0) {
            anyChanges = true
            console.log(`  ${red('-')} ${tableName}: ${red(String(diff))} rows ${dim(`(${before} -> ${after})`)}`)
          }
        }

        if (!anyChanges) {
          console.log(dim('  No row count changes detected.'))
        }
        console.log('')
      } catch (e: any) {
        s.fail('Seed failed.')
        console.log('')
        console.log(errorBox('Seed Error', e.message, 'Check your seed file for syntax errors.'))
      }
    })

  // ── db status ────────────────────────────────────────────────────────────

  dbCmd
    .command('status')
    .description('Show database health and statistics')
    .action(async () => {
      try {
        const { db, getConfig } = await import('vibekit')
        const config = getConfig()
        const info = db.getConnectionInfo()

        console.log('')
        console.log(`  ${cyan(bold('Database Status'))}`)
        console.log('')
        console.log(`  ${bold('Mode:')}       ${info.mode}`)
        console.log(`  ${bold('Path:')}       ${info.database}`)

        // File size and last modified
        const dbPath = config.dbPath
        if (existsSync(dbPath)) {
          const stat = statSync(dbPath)
          console.log(`  ${bold('File size:')}  ${formatBytes(stat.size)}`)
          console.log(`  ${bold('Modified:')}   ${stat.mtime.toLocaleString()}`)
        } else {
          console.log(`  ${bold('File size:')}  ${dim('Database file not found')}`)
        }

        console.log('')

        // Tables and row counts
        const tablesResult = await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )

        if (tablesResult.rows.length === 0) {
          console.log(dim('  No tables found.'))
          console.log('')
          return
        }

        console.log(`  ${bold('Tables:')}     ${tablesResult.rows.length}`)
        console.log('')

        const headers = ['Table', 'Rows', 'Status']
        const rows: string[][] = []
        let totalRows = 0

        for (const row of tablesResult.rows) {
          try {
            const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
            const count = countResult?.count ?? 0
            totalRows += count
            rows.push([
              row.name,
              String(count),
              count > 0 ? badge('HAS DATA', 'green') : badge('EMPTY', 'yellow'),
            ])
          } catch {
            rows.push([row.name, '?', badge('ERROR', 'red')])
          }
        }

        console.log(table(headers, rows))
        console.log('')
        console.log(`  ${bold('Total rows:')} ${totalRows}`)
        console.log('')

        // Check database health via a simple query
        try {
          await db.query('SELECT 1')
          console.log(`  ${badge('OK', 'green')} Database is healthy and responding`)
        } catch {
          console.log(`  ${badge('FAIL', 'red')} Database is not responding`)
        }
        console.log('')
      } catch (e: any) {
        console.log('')
        console.log(errorBox('Database Error', e.message, 'Make sure you are in a VibeKit project directory.'))
      }
    })

  // ── db migrate (placeholder) ─────────────────────────────────────────────

  dbCmd
    .command('migrate')
    .description('Generate migration file from schema diff')
    .action(async () => {
      console.log('')
      console.log(dim('  Migration generation is not yet implemented.'))
      console.log(dim('  Use "vibekit db push" for auto-sync in development.'))
      console.log('')
    })
}
