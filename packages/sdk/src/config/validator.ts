import { z } from 'zod'
import type { VibeKitConfig } from './types.js'

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ConfigValidationError {
  path: string
  message: string
  suggestion: string
}

export interface ConfigWarning {
  path: string
  message: string
}

export interface ConfigValidationResult {
  valid: boolean
  errors: ConfigValidationError[]
  warnings: ConfigWarning[]
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const VALID_FRAMEWORKS = ['nextjs', 'react', 'hono', 'express', 'html', 'custom'] as const

const SESSION_DURATION_RE = /^\d+(d|h|m)$/
const FILE_SIZE_RE = /^\d+(\.\d+)?\s*(B|KB|MB|GB)$/i

const AuthMethodSchema = z.enum(['email-code', 'passkey', 'google', 'github', 'magic-link'])

const AuthModuleSchema = z.object({
  enabled: z.boolean(),
  methods: z.array(AuthMethodSchema).min(1, 'At least one auth method is required'),
  sessionDuration: z
    .string()
    .regex(SESSION_DURATION_RE, 'Session duration must match pattern like "30d", "24h", or "60m"'),
  allowSignup: z.boolean().default(true),
  redirectAfterLogin: z.string().default('/'),
})

const StorageModuleSchema = z.object({
  enabled: z.boolean(),
  maxFileSize: z
    .string()
    .regex(FILE_SIZE_RE, 'Max file size must match pattern like "50MB", "1GB", "500KB"'),
  allowedTypes: z.array(z.string()).optional(),
})

const EmailModuleSchema = z.object({
  enabled: z.boolean(),
  from: z.string().email('Invalid "from" email address'),
  replyTo: z.string().email('Invalid "replyTo" email address').optional(),
})

const ModulesSchema = z.object({
  db: z.union([z.boolean(), z.object({ enabled: z.boolean() })]).default(true),
  auth: z.union([z.boolean(), AuthModuleSchema]).default(true),
  storage: z.union([z.boolean(), StorageModuleSchema]).default(true),
  email: z.union([z.boolean(), EmailModuleSchema]).default(true),
  realtime: z.boolean().default(false),
})

export const VibeKitConfigSchema = z.object({
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(64, 'Project name too long (max 64 characters)')
    .regex(
      /^[a-z0-9][a-z0-9-]*$/,
      'Project name must start with a lowercase letter or number and contain only lowercase alphanumeric characters and hyphens',
    ),
  projectId: z.string().default(''),
  region: z.string().default('us-east-1'),
  framework: z.enum(VALID_FRAMEWORKS).default('custom'),
  modules: ModulesSchema,
})

// ---------------------------------------------------------------------------
// Suggestion map
// ---------------------------------------------------------------------------

const SUGGESTION_MAP: Record<string, string> = {
  name: 'Use a lowercase name with hyphens, e.g. "my-app".',
  framework: `Must be one of: ${VALID_FRAMEWORKS.join(', ')}.`,
  'modules.auth.methods': 'Add at least one auth method, e.g. ["email-code"].',
  'modules.auth.sessionDuration':
    'Use a duration string like "30d" (30 days), "24h" (24 hours), or "60m" (60 minutes).',
  'modules.storage.maxFileSize': 'Use a size string like "50MB", "1GB", or "500KB".',
  'modules.email.from': 'Use a valid email address like "noreply@yourdomain.com".',
  'modules.email.replyTo': 'Use a valid email address like "support@yourdomain.com".',
}

function getSuggestion(path: string, _message: string): string {
  // Try exact match first, then walk up the path for a partial match
  if (SUGGESTION_MAP[path]) return SUGGESTION_MAP[path]

  const parts = path.split('.')
  while (parts.length > 1) {
    parts.pop()
    const parent = parts.join('.')
    if (SUGGESTION_MAP[parent]) return SUGGESTION_MAP[parent]
  }

  return 'Check the VibeKit documentation at https://docs.vibekit.dev/config for valid configuration options.'
}

// ---------------------------------------------------------------------------
// validateConfig
// ---------------------------------------------------------------------------

/**
 * Validates a raw (unknown) value against the vibekit.json schema.
 *
 * Returns a structured result with errors and warnings. The `valid` flag is
 * `true` only when there are zero errors -- warnings do not affect validity.
 */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = []
  const warnings: ConfigWarning[] = []

  // ------- type gate -------
  if (raw === null || raw === undefined) {
    errors.push({
      path: '(root)',
      message: 'Configuration is null or undefined.',
      suggestion: 'Provide a valid vibekit.json object with at least a "name" field.',
    })
    return { valid: false, errors, warnings }
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push({
      path: '(root)',
      message: 'Configuration must be a plain object.',
      suggestion: 'Provide a valid vibekit.json object, e.g. { "name": "my-app", "framework": "nextjs" }.',
    })
    return { valid: false, errors, warnings }
  }

  // ------- Zod parse -------
  const result = VibeKitConfigSchema.safeParse(raw)

  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      errors.push({
        path,
        message: issue.message,
        suggestion: getSuggestion(path, issue.message),
      })
    }
  }

  // ------- Warnings (only when parsing succeeds) -------
  if (result.success) {
    const data = result.data

    // Missing project ID
    if (!data.projectId) {
      warnings.push({
        path: 'projectId',
        message: 'No project ID set. A project ID is required for deployment.',
      })
    }

    // Auth enabled but email not configured
    if (typeof data.modules.auth === 'object' && data.modules.auth.enabled) {
      if (typeof data.modules.email !== 'object' || !data.modules.email.enabled) {
        warnings.push({
          path: 'modules.email',
          message:
            'Auth module is enabled but the email module is not configured. Verification codes will only appear in the terminal during local development.',
        })
      }
    }

    // Storage enabled without allowed types
    if (typeof data.modules.storage === 'object' && data.modules.storage.enabled) {
      if (!data.modules.storage.allowedTypes || data.modules.storage.allowedTypes.length === 0) {
        warnings.push({
          path: 'modules.storage.allowedTypes',
          message:
            'Storage is enabled without an allowedTypes list. All file types will be accepted, which may pose a security risk in production.',
        })
      }
    }

    // Realtime disabled hint
    if (!data.modules.realtime) {
      warnings.push({
        path: 'modules.realtime',
        message: 'Realtime module is disabled. Set to true if you need WebSocket support.',
      })
    }

    // Auth session duration sanity checks
    if (typeof data.modules.auth === 'object' && data.modules.auth.enabled) {
      const dur = data.modules.auth.sessionDuration
      const match = dur.match(/^(\d+)(d|h|m)$/)
      if (match) {
        const value = parseInt(match[1], 10)
        const unit = match[2]
        if (unit === 'd' && value > 365) {
          warnings.push({
            path: 'modules.auth.sessionDuration',
            message: `Session duration of ${value} days is unusually long. Consider a shorter duration for better security.`,
          })
        }
        if (unit === 'm' && value < 5) {
          warnings.push({
            path: 'modules.auth.sessionDuration',
            message: `Session duration of ${value} minutes is very short. Users may be logged out frequently.`,
          })
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

// ---------------------------------------------------------------------------
// migrateConfig
// ---------------------------------------------------------------------------

/**
 * Migrate a config object from an older version to the current shape.
 *
 * Currently supports:
 *  - "0.x" -> current format  (modules array to object, "project" to "name", "stack" to "framework")
 *  - "1.0" -> current format  (numeric sessionDuration to string)
 *
 * Unknown versions are returned as-is after running through the validator
 * defaults (Zod will fill missing fields with defaults where possible).
 */
export function migrateConfig(config: unknown, fromVersion: string): VibeKitConfig {
  if (config === null || config === undefined || typeof config !== 'object') {
    throw new Error(`Cannot migrate config: expected an object, got ${typeof config}.`)
  }

  const raw = { ...(config as Record<string, unknown>) }

  // -- 0.x migrations -------------------------------------------------------
  if (fromVersion.startsWith('0.')) {
    // In 0.x the modules were a flat array of strings, e.g. ["auth", "db"]
    if (Array.isArray(raw.modules)) {
      const moduleNames = raw.modules as string[]
      raw.modules = {
        db: moduleNames.includes('db'),
        auth: moduleNames.includes('auth'),
        storage: moduleNames.includes('storage'),
        email: moduleNames.includes('email'),
        realtime: moduleNames.includes('realtime'),
      }
    }

    // 0.x used "project" instead of "name"
    if (raw.project && !raw.name) {
      raw.name = raw.project
      delete raw.project
    }

    // 0.x used "stack" instead of "framework"
    if (raw.stack && !raw.framework) {
      raw.framework = raw.stack
      delete raw.stack
    }
  }

  // -- 1.0 migrations -------------------------------------------------------
  if (fromVersion === '1.0') {
    // 1.0 stored sessionDuration as seconds (number)
    if (
      raw.modules &&
      typeof raw.modules === 'object' &&
      !Array.isArray(raw.modules)
    ) {
      const mods = { ...(raw.modules as Record<string, unknown>) }
      if (mods.auth && typeof mods.auth === 'object') {
        const auth = { ...(mods.auth as Record<string, unknown>) }
        if (typeof auth.sessionDuration === 'number') {
          const seconds = auth.sessionDuration as number
          if (seconds >= 86400) {
            auth.sessionDuration = `${Math.round(seconds / 86400)}d`
          } else if (seconds >= 3600) {
            auth.sessionDuration = `${Math.round(seconds / 3600)}h`
          } else {
            auth.sessionDuration = `${Math.max(1, Math.round(seconds / 60))}m`
          }
        }
        mods.auth = auth
      }
      raw.modules = mods
    }
  }

  // Run through Zod to apply defaults and normalise
  const parsed = VibeKitConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const messages = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    throw new Error(
      `Config migration from version "${fromVersion}" produced an invalid config:\n${messages.join('\n')}`,
    )
  }

  return parsed.data as VibeKitConfig
}

// ---------------------------------------------------------------------------
// printConfigReport
// ---------------------------------------------------------------------------

/**
 * Format a {@link ConfigValidationResult} as a human-readable string suitable
 * for terminal output. Returns a short success message when there are no issues.
 */
export function printConfigReport(result: ConfigValidationResult): string {
  const lines: string[] = []

  if (result.valid && result.warnings.length === 0) {
    lines.push('  vibekit.json is valid. No issues found.')
    return lines.join('\n')
  }

  if (result.errors.length > 0) {
    lines.push('')
    lines.push('  Configuration Errors')
    lines.push('  ' + '-'.repeat(50))
    for (const err of result.errors) {
      lines.push('')
      lines.push(`  ERROR  ${err.path}`)
      lines.push(`         ${err.message}`)
      if (err.suggestion) {
        lines.push(`    Fix: ${err.suggestion}`)
      }
    }
    lines.push('')
  }

  if (result.warnings.length > 0) {
    lines.push('')
    lines.push('  Warnings')
    lines.push('  ' + '-'.repeat(50))
    for (const warn of result.warnings) {
      lines.push('')
      lines.push(`  WARN   ${warn.path}`)
      lines.push(`         ${warn.message}`)
    }
    lines.push('')
  }

  if (result.errors.length > 0) {
    lines.push(`  ${result.errors.length} error(s), ${result.warnings.length} warning(s).`)
  } else {
    lines.push(`  Config is valid with ${result.warnings.length} warning(s).`)
  }

  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Legacy aliases (re-exported by config/index.ts)
// ---------------------------------------------------------------------------

/** @deprecated Use {@link ConfigValidationResult} instead. */
export type ValidationResult = ConfigValidationResult

/** @deprecated Use {@link ConfigValidationError} instead. */
export type ValidationIssue = ConfigValidationError

/** @deprecated Use {@link printConfigReport} instead. */
export const formatValidationErrors = printConfigReport
