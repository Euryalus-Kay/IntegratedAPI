import type { Command } from 'commander'
import fs from 'node:fs'
import path from 'node:path'

function getEnvPath(): string {
  return path.join(process.cwd(), '.env')
}

function readEnv(): Record<string, string> {
  const envPath = getEnvPath()
  if (!fs.existsSync(envPath)) return {}
  const content = fs.readFileSync(envPath, 'utf-8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    result[key] = value
  }
  return result
}

function writeEnv(env: Record<string, string>): void {
  const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`)
  fs.writeFileSync(getEnvPath(), lines.join('\n') + '\n')
}

export function registerEnvCommands(program: Command): void {
  const envCmd = program
    .command('env')
    .description('Environment variable management')

  envCmd
    .command('list')
    .description('List environment variables')
    .action(() => {
      const env = readEnv()
      const entries = Object.entries(env)
      if (entries.length === 0) {
        console.log('No environment variables set.')
        return
      }
      for (const [key, value] of entries) {
        console.log(`  ${key}=${value}`)
      }
    })

  envCmd
    .command('set <key> <value>')
    .description('Set an environment variable')
    .action((key: string, value: string) => {
      const env = readEnv()
      env[key] = value
      writeEnv(env)
      console.log(`Set ${key}=${value}`)
    })

  envCmd
    .command('get <key>')
    .description('Get an environment variable value')
    .action((key: string) => {
      const env = readEnv()
      if (key in env) {
        console.log(env[key])
      } else {
        console.log(`"${key}" is not set.`)
      }
    })

  envCmd
    .command('remove <key>')
    .description('Remove an environment variable')
    .action((key: string) => {
      const env = readEnv()
      if (key in env) {
        delete env[key]
        writeEnv(env)
        console.log(`Removed ${key}`)
      } else {
        console.log(`"${key}" is not set.`)
      }
    })
}
