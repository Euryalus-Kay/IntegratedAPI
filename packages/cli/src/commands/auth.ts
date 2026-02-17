import type { Command } from 'commander'

export function registerAuthCommands(program: Command): void {
  const authCmd = program
    .command('auth')
    .description('Authentication management commands')

  authCmd
    .command('enable')
    .description('Enable auth module')
    .action(async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const configPath = path.join(process.cwd(), 'vibekit.json')
      if (!fs.existsSync(configPath)) {
        console.log('No vibekit.json found. Run "vibekit init" first.')
        return
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      config.modules.auth = {
        enabled: true,
        methods: ['email-code'],
        sessionDuration: '30d',
        allowSignup: true,
        redirectAfterLogin: '/',
      }
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      console.log('Auth module enabled.')
    })

  authCmd
    .command('disable')
    .description('Disable auth module')
    .action(async () => {
      const fs = await import('node:fs')
      const path = await import('node:path')
      const configPath = path.join(process.cwd(), 'vibekit.json')
      if (!fs.existsSync(configPath)) {
        console.log('No vibekit.json found. Run "vibekit init" first.')
        return
      }
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      config.modules.auth = false
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
      console.log('Auth module disabled.')
    })

  authCmd
    .command('status')
    .description('Show auth config and user count')
    .action(async () => {
      const { auth, getConfig } = await import('vibekit')
      try {
        const config = getConfig()
        const authConfig = config.modules.auth
        console.log('Auth configuration:')
        if (typeof authConfig === 'object') {
          console.log(`  Methods: ${authConfig.methods.join(', ')}`)
          console.log(`  Session duration: ${authConfig.sessionDuration}`)
          console.log(`  Allow signup: ${authConfig.allowSignup}`)
        } else {
          console.log(`  Enabled: ${!!authConfig}`)
        }
        const count = await auth.countUsers()
        console.log(`  Total users: ${count}`)
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })

  authCmd
    .command('users')
    .description('List users')
    .action(async () => {
      const { auth } = await import('vibekit')
      try {
        const result = await auth.listUsers()
        if (result.users.length === 0) {
          console.log('No users found.')
          return
        }
        console.log(`Users (${result.total} total):`)
        for (const user of result.users) {
          console.log(`  ${user.email} (${user.role}) - ${user.id}`)
        }
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })

  authCmd
    .command('users:delete <email>')
    .description('Delete a user by email')
    .action(async (email: string) => {
      const { auth } = await import('vibekit')
      try {
        const user = await auth.getUserByEmail(email)
        if (!user) {
          console.log(`User with email "${email}" not found.`)
          return
        }
        await auth.deleteUser(user.id)
        console.log(`User "${email}" deleted.`)
      } catch (e: any) {
        console.error('Error:', e.message)
      }
    })
}
