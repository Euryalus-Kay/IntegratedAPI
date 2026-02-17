import type { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'

const CRED_DIR = path.join(process.env.HOME || '~', '.vibekit')
const CRED_FILE = path.join(CRED_DIR, 'credentials')

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Log in to VibeKit')
    .action(async () => {
      console.log('VibeKit login is not yet available.')
      console.log('Local development works without an account.')
      console.log('Run "vibekit dev" to start building.')
    })
}

export function registerLogoutCommand(program: Command): void {
  program
    .command('logout')
    .description('Log out of VibeKit')
    .action(() => {
      if (fs.existsSync(CRED_FILE)) {
        fs.unlinkSync(CRED_FILE)
        console.log('Logged out.')
      } else {
        console.log('Not logged in.')
      }
    })
}

export function registerWhoamiCommand(program: Command): void {
  program
    .command('whoami')
    .description('Show current user')
    .action(() => {
      if (!fs.existsSync(CRED_FILE)) {
        console.log('Not logged in.')
        return
      }
      try {
        const creds = JSON.parse(fs.readFileSync(CRED_FILE, 'utf-8'))
        console.log(`Logged in as: ${creds.email || 'unknown'}`)
      } catch {
        console.log('Credentials file is corrupt. Run "vibekit login".')
      }
    })
}
