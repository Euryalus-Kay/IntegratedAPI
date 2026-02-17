import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { VibeKitConfig, VibeKitEnv, ResolvedConfig } from './types.js'
import { validateConfig, formatValidationErrors } from './validator.js'

export function findConfig(startDir?: string): { config: VibeKitConfig; rootDir: string } | null {
  let dir = startDir || process.cwd()
  const visited: string[] = []

  while (true) {
    visited.push(dir)
    const configPath = path.join(dir, 'vibekit.json')

    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8')
      let parsed: unknown

      try {
        parsed = JSON.parse(raw)
      } catch (e: unknown) {
        const jsonErr = e instanceof SyntaxError ? e : new SyntaxError(String(e))
        const posMatch = jsonErr.message.match(/position (\d+)/)
        const position = posMatch ? parseInt(posMatch[1], 10) : undefined
        let lineInfo = ''
        if (position !== undefined) {
          const lines = raw.substring(0, position).split('\n')
          lineInfo = ` at line ${lines.length}, column ${lines[lines.length - 1].length + 1}`
        }
        throw new Error(
          `Invalid JSON in vibekit.json${lineInfo}\n` +
          `  File: ${configPath}\n` +
          `  Error: ${jsonErr.message}\n` +
          `  Fix: Check for trailing commas, missing quotes, or unclosed brackets.`
        )
      }

      const validation = validateConfig(parsed)
      if (!validation.valid) {
        const formatted = formatValidationErrors(validation)
        throw new Error(
          `Invalid vibekit.json configuration:\n${formatted}\n` +
          `  File: ${configPath}`
        )
      }

      if (validation.warnings.length > 0) {
        const formatted = formatValidationErrors({ valid: true, errors: [], warnings: validation.warnings })
        // Log warnings to stderr so they don't break piped output
        process.stderr.write(formatted + '\n')
      }

      return { config: parsed as VibeKitConfig, rootDir: dir }
    }

    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function detectEnv(): VibeKitEnv {
  if (process.env.VIBEKIT_ENV) {
    const env = process.env.VIBEKIT_ENV as string
    if (!['local', 'preview', 'production'].includes(env)) {
      throw new Error(
        `Invalid VIBEKIT_ENV value: "${env}"\n` +
        `  Valid values: local, preview, production`
      )
    }
    return env as VibeKitEnv
  }
  if (process.env.VIBEKIT_API_KEY) return 'production'
  if (process.env.VIBEKIT_PREVIEW === 'true') return 'preview'
  if (process.env.NODE_ENV === 'production') return 'production'
  return 'local'
}

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
    if (jwtSecret.length < 32) {
      throw new Error(
        'JWT secret in .vibekit/.jwt-secret is too short (minimum 32 characters).\n' +
        '  Fix: Delete .vibekit/.jwt-secret and restart. A new secret will be generated.'
      )
    }
  } else if (env === 'local') {
    jwtSecret = crypto.randomBytes(64).toString('hex')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(secretPath, jwtSecret, { mode: 0o600 })
  } else {
    jwtSecret = process.env.VIBEKIT_JWT_SECRET || ''
    if (!jwtSecret) {
      throw new Error(
        'VIBEKIT_JWT_SECRET environment variable is required in production.\n' +
        '  Fix: Set VIBEKIT_JWT_SECRET to a random string of at least 64 characters.\n' +
        '  Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
      )
    }
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

export function writeConfig(config: VibeKitConfig, dir?: string): void {
  const validation = validateConfig(config)
  if (!validation.valid) {
    throw new Error(`Cannot write invalid config:\n${formatValidationErrors(validation)}`)
  }
  const configPath = path.join(dir || process.cwd(), 'vibekit.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
}

export function migrateConfig(raw: Record<string, unknown>): VibeKitConfig {
  const migrated = { ...raw }

  // v0 -> v0.1: modules.auth string -> object
  if (typeof migrated.modules === 'object' && migrated.modules !== null) {
    const modules = migrated.modules as Record<string, unknown>
    if (typeof modules.auth === 'string') {
      modules.auth = {
        enabled: true,
        methods: [modules.auth],
        sessionDuration: '30d',
        allowSignup: true,
        redirectAfterLogin: '/',
      }
    }
  }

  return migrated as unknown as VibeKitConfig
}

function getDefaultConfig(): VibeKitConfig {
  return {
    name: sanitizeProjectName(path.basename(process.cwd())),
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

function sanitizeProjectName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'my-app'
}

function loadCredentialToken(): string | undefined {
  const credPath = path.join(process.env.HOME || '~', '.vibekit', 'credentials')
  if (fs.existsSync(credPath)) {
    try {
      const raw = fs.readFileSync(credPath, 'utf-8')
      const creds = JSON.parse(raw)
      if (creds.expiresAt && new Date(creds.expiresAt) > new Date()) {
        return creds.token
      }
      // Token expired
      return undefined
    } catch {
      process.stderr.write(
        'Warning: ~/.vibekit/credentials is corrupted. Run "vibekit login" to fix.\n'
      )
      return undefined
    }
  }
  return undefined
}
