import type { Command } from 'commander'

export function registerDbCommands(program: Command): void {
  const dbCmd = program
    .command('db')
    .description('Database management commands')

  dbCmd
    .command('push')
    .description('Sync schema definitions to database')
    .action(async () => {
      const { db } = await import('vibekit')
      try {
        const result = await db.sync()
        if (result.created.length > 0) {
          console.log('Created tables:', result.created.join(', '))
        }
        if (result.modified.length > 0) {
          console.log('Modified columns:', result.modified.join(', '))
        }
        if (result.created.length === 0 && result.modified.length === 0) {
          console.log('Database is up to date.')
        }
      } catch (e: any) {
        console.error('Error syncing database:', e.message)
      }
    })

  dbCmd
    .command('reset')
    .description('Drop all tables and re-sync schema')
    .action(async () => {
      const { db } = await import('vibekit')
      try {
        await db.reset()
        console.log('Database reset complete.')
      } catch (e: any) {
        console.error('Error resetting database:', e.message)
      }
    })

  dbCmd
    .command('pull')
    .description('Export current database schema to console')
    .action(async () => {
      const { db } = await import('vibekit')
      try {
        const info = db.getConnectionInfo()
        console.log(`Database: ${info.mode} (${info.database})`)
        const result = await db.query("SELECT sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        for (const row of result.rows) {
          console.log((row as any).sql + ';')
          console.log('')
        }
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })

  dbCmd
    .command('studio')
    .description('Launch interactive table browser in terminal')
    .action(async () => {
      const { db } = await import('vibekit')
      try {
        const result = await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        console.log('Tables:')
        for (const row of result.rows) {
          const name = (row as any).name
          const countResult = await db.queryOne(`SELECT COUNT(*) as count FROM "${name}"`)
          console.log(`  ${name} (${(countResult as any)?.count || 0} rows)`)
        }
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })

  dbCmd
    .command('seed')
    .description('Run vibekit/seed.ts if it exists')
    .action(async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const seedPath = path.join(process.cwd(), 'vibekit', 'seed.ts')
      if (!fs.existsSync(seedPath)) {
        console.log('No seed file found at vibekit/seed.ts')
        return
      }
      console.log('Running seed file...')
      try {
        await import(seedPath)
        console.log('Seed complete.')
      } catch (e: any) {
        console.error('Error running seed:', e.message)
      }
    })

  dbCmd
    .command('migrate')
    .description('Generate migration file from schema diff')
    .action(async () => {
      console.log('Migration generation is not yet implemented. Use "vibekit db push" for auto-sync.')
    })
}
