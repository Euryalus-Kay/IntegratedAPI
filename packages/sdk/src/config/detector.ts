import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { VibeKitConfig, VibeKitEnv, ResolvedConfig } from './types.js'

/**
 * Find vibekit.json by walking up from cwd.
 * Returns the parsed config and the directory it was found in.
 */
export function findConfig(startDir?: string): { config: VibeKitConfig; rootDir: string } | null {
  let dir = startDir || process.cwd()
  while (true) {
    const configPath = path.join(dir, 'vibekit.json')
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      return { config: JSON.parse(raw), rootDir: dir }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/**
 * Detect the current environment.
 */
export function detectEnv(): VibeKitEnv {
  if (process.env.VIBEKIT_ENV) return process.env.VIBEKIT_ENV as VibeKitEnv
  if (process.env.VIBEKIT_API_KEY) return 'production'
  if (process.env.VIBEKIT_PREVIEW === 'true') return 'preview'
  if (process.env.NODE_ENV === 'production') return 'production'
  return 'local'
}

/**
 * Build full resolved config by combining vibekit.json + env detection + defaults.
 */
export function resolveConfig(overrides?: Partial<ResolvedConfig>): ResolvedConfig {
  const found = findConfig()
  const config: VibeKitConfig = found?.config ?? getDefaultConfig()
  const rootDir = found?.rootDir ?? process.cwd()
  const env = detectEnv()
  const dataDir = path.join(rootDir, '.vibekit')

  if (env === 'local' && !fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }

  const secretPath = path.join(dataDir, '.jwt-secret')
  let jwtSecret: string
  if (fs.existsSync(secretPath)) {
    jwtSecret = fs.readFileSync(secretPath, 'utf-8').trim()
  } else if (env === 'local') {
    jwtSecret = crypto.randomBytes(64).toString('hex')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(secretPath, jwtSecret, { mode: 0o600 })
  } else {
    jwtSecret = process.env.VIBEKIT_JWT_SECRET || crypto.randomBytes(64).toString('hex')
  }

  return {
    ...config,
    env,
    dataDir,
    dbPath: path.join(dataDir, 'local.db'),
    storagePath: path.join(dataDir, 'storage'),
    port: parseInt(process.env.VIBEKIT_PORT || '3456', 10),
    jwtSecret,
    apiUrl: process.env.VIBEKIT_API_URL || 'https://api.vibekit.app',
    apiToken: process.env.VIBEKIT_API_TOKEN || loadCredentialToken(),
    ...overrides,
  }
}

function getDefaultConfig(): VibeKitConfig {
  return {
    name: path.basename(process.cwd()),
    projectId: '',
    region: 'us-east-1',
    framework: 'custom',
    modules: {
      db: true,
      auth: { enabled: true, methods: ['email-code'], sessionDuration: '30d', allowSignup: true, redirectAfterLogin: '/' },
      storage: { enabled: true, maxFileSize: '50MB' },
      email: { enabled: true, from: 'noreply@localhost' },
      realtime: false,
    },
  }
}

function loadCredentialToken(): string | undefined {
  const credPath = path.join(process.env.HOME || '~', '.vibekit', 'credentials')
  if (fs.existsSync(credPath)) {
    try {
      const creds = JSON.parse(fs.readFileSync(credPath, 'utf-8'))
      if (creds.expiresAt && new Date(creds.expiresAt) > new Date()) {
        return creds.token
      }
    } catch { /* ignore corrupt credentials */ }
  }
  return undefined
}
