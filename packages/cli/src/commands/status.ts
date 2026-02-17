import type { Command } from 'commander'

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show project info')
    .action(async () => {
      try {
        const { getConfig, db, auth } = await import('vibekit')
        const config = getConfig()
        console.log('')
        console.log(`  Project: ${config.name}`)
        console.log(`  Environment: ${config.env}`)
        console.log(`  Database: ${config.dbPath}`)
        console.log(`  Storage: ${config.storagePath}`)
        console.log(`  Port: ${config.port}`)
        console.log('')
        console.log('  Modules:')
        const modules = config.modules
        console.log(`    db:       ${!!modules.db ? 'enabled' : 'disabled'}`)
        console.log(`    auth:     ${typeof modules.auth === 'object' ? (modules.auth.enabled ? 'enabled' : 'disabled') : !!modules.auth ? 'enabled' : 'disabled'}`)
        console.log(`    storage:  ${typeof modules.storage === 'object' ? (modules.storage.enabled ? 'enabled' : 'disabled') : !!modules.storage ? 'enabled' : 'disabled'}`)
        console.log(`    email:    ${typeof modules.email === 'object' ? (modules.email.enabled ? 'enabled' : 'disabled') : !!modules.email ? 'enabled' : 'disabled'}`)
        console.log(`    realtime: ${!!modules.realtime ? 'enabled' : 'disabled'}`)
        console.log('')

        try {
          const userCount = await auth.countUsers()
          console.log(`  Users: ${userCount}`)
        } catch { /* no auth tables yet */ }

        console.log('')
      } catch (e: any) {
        console.error('Error:', e.message)
        console.log('Make sure you are in a VibeKit project directory (with vibekit.json).')
      }
    })
}
