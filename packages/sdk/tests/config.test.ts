import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  validateConfig,
  formatValidationErrors,
  migrateConfig,
} from '../src/config/validator.js'
import { detectEnv } from '../src/config/detector.js'

// ─────────────────────────────────────────────────────────────────────────────
// validateConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('validateConfig', () => {
  describe('valid configurations', () => {
    it('accepts a minimal valid config', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: true,
          storage: true,
          email: true,
          realtime: false,
        },
      })
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('accepts a config with detailed auth module', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'hono',
        modules: {
          db: true,
          auth: {
            enabled: true,
            methods: ['email-code'],
            sessionDuration: '30d',
            allowSignup: true,
            redirectAfterLogin: '/',
          },
          storage: true,
          email: true,
          realtime: false,
        },
      })
      expect(result.valid).toBe(true)
    })

    it('accepts a config with detailed storage module', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'express',
        modules: {
          db: true,
          auth: true,
          storage: {
            enabled: true,
            maxFileSize: '50MB',
            allowedTypes: ['image/png', 'image/jpeg'],
          },
          email: true,
          realtime: false,
        },
      })
      expect(result.valid).toBe(true)
    })

    it('accepts a config with detailed email module', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'custom',
        modules: {
          db: true,
          auth: true,
          storage: true,
          email: {
            enabled: true,
            from: 'noreply@example.com',
            replyTo: 'support@example.com',
          },
          realtime: false,
        },
      })
      expect(result.valid).toBe(true)
    })

    it('accepts all valid frameworks', () => {
      for (const fw of ['nextjs', 'react', 'hono', 'express', 'html', 'custom']) {
        const result = validateConfig({
          name: 'test-app',
          framework: fw,
          modules: { db: true, auth: true, storage: true, email: true, realtime: false },
        })
        expect(result.valid).toBe(true)
      }
    })
  })

  describe('invalid configurations', () => {
    it('rejects null', () => {
      const result = validateConfig(null)
      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThan(0)
    })

    it('rejects undefined', () => {
      const result = validateConfig(undefined)
      expect(result.valid).toBe(false)
    })

    it('rejects arrays', () => {
      const result = validateConfig([])
      expect(result.valid).toBe(false)
    })

    it('rejects config without a name', () => {
      const result = validateConfig({
        framework: 'nextjs',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'name')).toBe(true)
    })

    it('rejects invalid project name format', () => {
      const result = validateConfig({
        name: 'My App!',
        framework: 'nextjs',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      })
      expect(result.valid).toBe(false)
      expect(result.errors.some(e => e.path === 'name')).toBe(true)
    })

    it('rejects invalid framework', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'django',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      })
      expect(result.valid).toBe(false)
    })

    it('rejects invalid session duration format', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: {
            enabled: true,
            methods: ['email-code'],
            sessionDuration: 'forever',
            allowSignup: true,
            redirectAfterLogin: '/',
          },
          storage: true,
          email: true,
          realtime: false,
        },
      })
      expect(result.valid).toBe(false)
    })

    it('rejects auth without any methods', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: {
            enabled: true,
            methods: [],
            sessionDuration: '30d',
            allowSignup: true,
            redirectAfterLogin: '/',
          },
          storage: true,
          email: true,
          realtime: false,
        },
      })
      expect(result.valid).toBe(false)
    })

    it('rejects invalid maxFileSize format', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: true,
          storage: {
            enabled: true,
            maxFileSize: 'big',
          },
          email: true,
          realtime: false,
        },
      })
      expect(result.valid).toBe(false)
    })

    it('rejects invalid email from address', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: true,
          storage: true,
          email: {
            enabled: true,
            from: 'not-an-email',
          },
          realtime: false,
        },
      })
      expect(result.valid).toBe(false)
    })
  })

  describe('warnings', () => {
    it('warns when projectId is empty', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      })
      expect(result.warnings.some(w => w.path === 'projectId')).toBe(true)
    })

    it('warns when realtime is disabled', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      })
      expect(result.warnings.some(w => w.path === 'modules.realtime')).toBe(true)
    })

    it('warns when storage has no allowedTypes', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: true,
          storage: { enabled: true, maxFileSize: '50MB' },
          email: true,
          realtime: false,
        },
      })
      expect(result.warnings.some(w => w.path === 'modules.storage.allowedTypes')).toBe(true)
    })

    it('warns about very long session duration', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: {
            enabled: true,
            methods: ['email-code'],
            sessionDuration: '400d',
            allowSignup: true,
            redirectAfterLogin: '/',
          },
          storage: true,
          email: true,
          realtime: false,
        },
      })
      expect(result.warnings.some(w => w.path === 'modules.auth.sessionDuration')).toBe(true)
    })

    it('warns about very short session duration', () => {
      const result = validateConfig({
        name: 'my-app',
        framework: 'nextjs',
        modules: {
          db: true,
          auth: {
            enabled: true,
            methods: ['email-code'],
            sessionDuration: '3m',
            allowSignup: true,
            redirectAfterLogin: '/',
          },
          storage: true,
          email: true,
          realtime: false,
        },
      })
      expect(result.warnings.some(w => w.path === 'modules.auth.sessionDuration')).toBe(true)
    })
  })

  describe('suggestions', () => {
    it('provides suggestions for errors', () => {
      const result = validateConfig({
        name: 'My App',
        framework: 'nextjs',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      })
      expect(result.errors.length).toBeGreaterThan(0)
      for (const err of result.errors) {
        expect(err.suggestion).toBeTruthy()
      }
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatValidationErrors (printConfigReport)
// ─────────────────────────────────────────────────────────────────────────────

describe('formatValidationErrors', () => {
  it('returns a success message for valid config', () => {
    const output = formatValidationErrors({ valid: true, errors: [], warnings: [] })
    expect(output).toContain('valid')
  })

  it('formats errors', () => {
    const output = formatValidationErrors({
      valid: false,
      errors: [
        { path: 'name', message: 'Required', suggestion: 'Add a name' },
      ],
      warnings: [],
    })
    expect(output).toContain('ERROR')
    expect(output).toContain('name')
    expect(output).toContain('Required')
  })

  it('formats warnings', () => {
    const output = formatValidationErrors({
      valid: true,
      errors: [],
      warnings: [
        { path: 'projectId', message: 'No project ID set' },
      ],
    })
    expect(output).toContain('WARN')
    expect(output).toContain('projectId')
  })

  it('shows error and warning counts', () => {
    const output = formatValidationErrors({
      valid: false,
      errors: [
        { path: 'a', message: 'err1', suggestion: 'fix' },
        { path: 'b', message: 'err2', suggestion: 'fix' },
      ],
      warnings: [
        { path: 'c', message: 'warn1' },
      ],
    })
    expect(output).toContain('2 error(s)')
    expect(output).toContain('1 warning(s)')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Environment detection
// ─────────────────────────────────────────────────────────────────────────────

describe('detectEnv', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
    // Clear all VibeKit-related env vars
    delete process.env.VIBEKIT_ENV
    delete process.env.VIBEKIT_API_KEY
    delete process.env.VIBEKIT_PREVIEW
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('defaults to local when no env vars are set', () => {
    expect(detectEnv()).toBe('local')
  })

  it('respects VIBEKIT_ENV=production', () => {
    process.env.VIBEKIT_ENV = 'production'
    expect(detectEnv()).toBe('production')
  })

  it('respects VIBEKIT_ENV=preview', () => {
    process.env.VIBEKIT_ENV = 'preview'
    expect(detectEnv()).toBe('preview')
  })

  it('respects VIBEKIT_ENV=local', () => {
    process.env.VIBEKIT_ENV = 'local'
    expect(detectEnv()).toBe('local')
  })

  it('throws on invalid VIBEKIT_ENV', () => {
    process.env.VIBEKIT_ENV = 'staging'
    expect(() => detectEnv()).toThrow(/Invalid VIBEKIT_ENV/)
  })

  it('detects production from VIBEKIT_API_KEY', () => {
    process.env.VIBEKIT_API_KEY = 'some-key'
    expect(detectEnv()).toBe('production')
  })

  it('detects preview from VIBEKIT_PREVIEW', () => {
    process.env.VIBEKIT_PREVIEW = 'true'
    expect(detectEnv()).toBe('preview')
  })

  it('detects production from NODE_ENV', () => {
    process.env.NODE_ENV = 'production'
    expect(detectEnv()).toBe('production')
  })

  it('VIBEKIT_ENV takes priority over other env vars', () => {
    process.env.VIBEKIT_ENV = 'local'
    process.env.VIBEKIT_API_KEY = 'key'
    process.env.NODE_ENV = 'production'
    expect(detectEnv()).toBe('local')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// migrateConfig
// ─────────────────────────────────────────────────────────────────────────────

describe('migrateConfig', () => {
  it('migrates v0 module arrays to objects', () => {
    const migrated = migrateConfig(
      {
        name: 'old-app',
        framework: 'express',
        modules: ['db', 'auth', 'storage'],
      },
      '0.1',
    )
    expect(migrated.modules.db).toBe(true)
    expect(migrated.modules.auth).toBe(true)
    expect(migrated.modules.storage).toBe(true)
    expect(migrated.modules.email).toBe(false)
    expect(migrated.modules.realtime).toBe(false)
  })

  it('migrates v0 "project" to "name"', () => {
    const migrated = migrateConfig(
      {
        project: 'old-name',
        framework: 'custom',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      },
      '0.2',
    )
    expect(migrated.name).toBe('old-name')
  })

  it('migrates v0 "stack" to "framework"', () => {
    const migrated = migrateConfig(
      {
        name: 'old-app',
        stack: 'nextjs',
        modules: { db: true, auth: true, storage: true, email: true, realtime: false },
      },
      '0.3',
    )
    expect(migrated.framework).toBe('nextjs')
  })

  it('migrates v1.0 numeric sessionDuration to string', () => {
    const migrated = migrateConfig(
      {
        name: 'app',
        framework: 'hono',
        modules: {
          db: true,
          auth: {
            enabled: true,
            methods: ['email-code'],
            sessionDuration: 2592000, // 30 days in seconds
            allowSignup: true,
            redirectAfterLogin: '/',
          },
          storage: true,
          email: true,
          realtime: false,
        },
      },
      '1.0',
    )
    const auth = migrated.modules.auth as any
    expect(auth.sessionDuration).toBe('30d')
  })

  it('throws for null config', () => {
    expect(() => migrateConfig(null, '0.1')).toThrow(/expected an object/)
  })

  it('throws when migration produces invalid config', () => {
    expect(() =>
      migrateConfig({ modules: ['invalid-module'] }, '0.1'),
    ).toThrow()
  })
})
