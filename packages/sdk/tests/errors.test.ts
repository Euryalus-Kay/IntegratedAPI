import { describe, it, expect } from 'vitest'
import {
  VibeKitError,
  AuthError,
  DbError,
  StorageError,
  ValidationError,
  ConfigError,
  NetworkError,
  wrapError,
  isVibeKitError,
  ErrorCodes,
  ErrorCodeRegistry,
  ErrorFormatter,
  type VibeKitErrorOptions,
} from '../src/utils/errors.js'

// ─────────────────────────────────────────────────────────────────────────────
// VibeKitError — base class
// ─────────────────────────────────────────────────────────────────────────────

describe('VibeKitError', () => {
  describe('construction with string code (legacy positional args)', () => {
    it('sets message, code, statusCode, and details', () => {
      const err = new VibeKitError('Something failed', 'TEST_ERROR', 500, { key: 'value' })
      expect(err.message).toBe('Something failed')
      expect(err.code).toBe('TEST_ERROR')
      expect(err.statusCode).toBe(500)
      expect(err.details).toEqual({ key: 'value' })
      expect(err.name).toBe('VibeKitError')
      expect(err).toBeInstanceOf(Error)
      expect(err).toBeInstanceOf(VibeKitError)
    })

    it('defaults statusCode to 500 when not provided', () => {
      const err = new VibeKitError('fail', 'CUSTOM_CODE')
      expect(err.statusCode).toBe(500)
    })

    it('uses registry default statusCode for known error codes', () => {
      const err = new VibeKitError('rate limited', ErrorCodes.AUTH_RATE_LIMITED)
      expect(err.statusCode).toBe(429)
    })

    it('populates suggestion and docsUrl from the registry', () => {
      const err = new VibeKitError('expired', ErrorCodes.AUTH_CODE_EXPIRED)
      expect(err.suggestion).toBe('Request a new verification code and try again.')
      expect(err.docsUrl).toContain('auth-code-expired')
    })

    it('has a valid ISO timestamp', () => {
      const before = new Date().toISOString()
      const err = new VibeKitError('test', 'CODE')
      const after = new Date().toISOString()
      expect(err.timestamp >= before).toBe(true)
      expect(err.timestamp <= after).toBe(true)
    })
  })

  describe('construction with VibeKitErrorOptions object', () => {
    it('accepts a full options object', () => {
      const cause = new Error('root cause')
      const opts: VibeKitErrorOptions = {
        code: 'MY_CODE',
        statusCode: 422,
        cause,
        suggestion: 'Try again',
        docsUrl: 'https://docs.example.com',
        context: { userId: 'abc' },
        requestId: 'req-123',
        details: { extra: true },
      }
      const err = new VibeKitError('oops', opts)

      expect(err.code).toBe('MY_CODE')
      expect(err.statusCode).toBe(422)
      expect(err.cause).toBe(cause)
      expect(err.suggestion).toBe('Try again')
      expect(err.docsUrl).toBe('https://docs.example.com')
      expect(err.context).toEqual({ userId: 'abc' })
      expect(err.requestId).toBe('req-123')
      expect(err.details).toEqual({ extra: true })
    })

    it('overrides registry defaults with explicit values', () => {
      const err = new VibeKitError('custom', {
        code: ErrorCodes.AUTH_CODE_EXPIRED,
        statusCode: 503,
        suggestion: 'custom suggestion',
        docsUrl: 'https://custom.com',
      })
      expect(err.statusCode).toBe(503)
      expect(err.suggestion).toBe('custom suggestion')
      expect(err.docsUrl).toBe('https://custom.com')
    })

    it('falls back to registry defaults when options omit them', () => {
      const err = new VibeKitError('expired code', {
        code: ErrorCodes.AUTH_CODE_EXPIRED,
      })
      expect(err.statusCode).toBe(400) // from registry
      expect(err.suggestion).toBeDefined()
      expect(err.docsUrl).toBeDefined()
    })

    it('defaults context to an empty object', () => {
      const err = new VibeKitError('test', { code: 'X' })
      expect(err.context).toEqual({})
    })
  })

  // ── toJSON ──────────────────────────────────────────────────────────────────

  describe('toJSON()', () => {
    it('includes required fields', () => {
      const err = new VibeKitError('fail', 'CODE', 400)
      const json = err.toJSON()
      expect(json.name).toBe('VibeKitError')
      expect(json.message).toBe('fail')
      expect(json.code).toBe('CODE')
      expect(json.statusCode).toBe(400)
      expect(json.timestamp).toBeDefined()
    })

    it('includes optional fields when present', () => {
      const cause = new Error('root')
      const err = new VibeKitError('fail', {
        code: 'CODE',
        statusCode: 400,
        suggestion: 'fix it',
        docsUrl: 'https://docs.example.com',
        requestId: 'req-1',
        context: { foo: 'bar' },
        details: { x: 1 },
        cause,
      })
      const json = err.toJSON()
      expect(json.suggestion).toBe('fix it')
      expect(json.docsUrl).toBe('https://docs.example.com')
      expect(json.requestId).toBe('req-1')
      expect(json.context).toEqual({ foo: 'bar' })
      expect(json.details).toEqual({ x: 1 })
      expect(json.cause).toEqual({ name: 'Error', message: 'root' })
    })

    it('omits optional fields when absent', () => {
      const err = new VibeKitError('fail', { code: 'CUSTOM_NO_REGISTRY' })
      const json = err.toJSON()
      expect(json).not.toHaveProperty('suggestion')
      expect(json).not.toHaveProperty('docsUrl')
      expect(json).not.toHaveProperty('requestId')
      expect(json).not.toHaveProperty('context')
      expect(json).not.toHaveProperty('details')
      expect(json).not.toHaveProperty('cause')
    })

    it('serializes non-Error cause as-is', () => {
      const err = new VibeKitError('fail', {
        code: 'X',
        cause: 'some string cause' as any,
      })
      const json = err.toJSON()
      expect(json.cause).toBe('some string cause')
    })
  })

  // ── toString ────────────────────────────────────────────────────────────────

  describe('toString()', () => {
    it('includes name, code, message, status, and timestamp', () => {
      const err = new VibeKitError('something broke', 'MY_CODE', 500)
      const str = err.toString()
      expect(str).toContain('VibeKitError [MY_CODE]: something broke')
      expect(str).toContain('Status   : 500')
      expect(str).toContain('Time     :')
    })

    it('includes requestId when present', () => {
      const err = new VibeKitError('fail', {
        code: 'X',
        requestId: 'req-xyz',
      })
      expect(err.toString()).toContain('RequestId: req-xyz')
    })

    it('includes suggestion when present', () => {
      const err = new VibeKitError('fail', {
        code: 'X',
        suggestion: 'try again later',
      })
      expect(err.toString()).toContain('Hint     : try again later')
    })

    it('includes context entries', () => {
      const err = new VibeKitError('fail', {
        code: 'X',
        context: { region: 'us-east-1', attempt: 3 },
      })
      const str = err.toString()
      expect(str).toContain('Context  :')
      expect(str).toContain('region: us-east-1')
      expect(str).toContain('attempt: 3')
    })

    it('includes details', () => {
      const err = new VibeKitError('fail', 'X', 500, { data: [1, 2] })
      expect(err.toString()).toContain('Details  :')
    })

    it('includes cause info', () => {
      const cause = new TypeError('bad type')
      const err = new VibeKitError('fail', {
        code: 'X',
        cause,
      })
      expect(err.toString()).toContain('Cause    : TypeError: bad type')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Subclasses
// ─────────────────────────────────────────────────────────────────────────────

describe('AuthError', () => {
  it('defaults statusCode to 401', () => {
    const err = new AuthError('unauthorized', 'AUTH_UNAUTHORIZED')
    expect(err.statusCode).toBe(401)
    expect(err.name).toBe('AuthError')
    expect(err).toBeInstanceOf(VibeKitError)
  })

  it('accepts a custom statusCode', () => {
    const err = new AuthError('forbidden', 'AUTH_SIGNUP_DISABLED', 403)
    expect(err.statusCode).toBe(403)
  })

  it('accepts an options object', () => {
    const err = new AuthError('session expired', {
      code: ErrorCodes.AUTH_SESSION_EXPIRED,
      context: { userId: '123' },
    })
    expect(err.code).toBe('AUTH_SESSION_EXPIRED')
    expect(err.name).toBe('AuthError')
    expect(err.context).toEqual({ userId: '123' })
  })
})

describe('DbError', () => {
  it('defaults code to DB_QUERY_ERROR and statusCode to 500', () => {
    const err = new DbError('query failed')
    expect(err.code).toBe('DB_QUERY_ERROR')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('DbError')
  })

  it('accepts a string code', () => {
    const err = new DbError('connection lost', 'DB_CONNECTION_FAILED')
    expect(err.code).toBe('DB_CONNECTION_FAILED')
    expect(err.statusCode).toBe(500)
  })

  it('accepts a custom statusCode', () => {
    const err = new DbError('migration fail', 'DB_MIGRATION_FAILED', 503)
    expect(err.statusCode).toBe(503)
  })

  it('accepts an options object', () => {
    const err = new DbError('table missing', {
      code: ErrorCodes.DB_TABLE_NOT_FOUND,
      context: { table: 'users' },
    })
    expect(err.code).toBe('DB_TABLE_NOT_FOUND')
    expect(err.context).toEqual({ table: 'users' })
  })
})

describe('StorageError', () => {
  it('defaults code to STORAGE_ERROR and statusCode to 500', () => {
    const err = new StorageError('upload failed')
    expect(err.code).toBe('STORAGE_ERROR')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('StorageError')
  })

  it('accepts a string code', () => {
    const err = new StorageError('file not found', 'STORAGE_FILE_NOT_FOUND')
    expect(err.code).toBe('STORAGE_FILE_NOT_FOUND')
  })

  it('accepts a custom statusCode', () => {
    const err = new StorageError('too large', 'STORAGE_FILE_TOO_LARGE', 413)
    expect(err.statusCode).toBe(413)
  })

  it('accepts an options object', () => {
    const err = new StorageError('bad type', {
      code: ErrorCodes.STORAGE_INVALID_TYPE,
      context: { mimeType: 'video/mp4' },
    })
    expect(err.code).toBe('STORAGE_INVALID_TYPE')
    expect(err.context).toEqual({ mimeType: 'video/mp4' })
  })
})

describe('ValidationError', () => {
  it('defaults code to VALIDATION_FAILED and statusCode to 400', () => {
    const err = new ValidationError('invalid input')
    expect(err.code).toBe('VALIDATION_FAILED')
    expect(err.statusCode).toBe(400)
    expect(err.name).toBe('ValidationError')
    expect(err.fieldErrors).toEqual({})
  })

  it('accepts fieldErrors in options', () => {
    const err = new ValidationError('invalid', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: { email: 'must be a valid email', name: 'is required' },
    })
    expect(err.fieldErrors).toEqual({
      email: 'must be a valid email',
      name: 'is required',
    })
  })

  it('includes fieldErrors in toJSON when present', () => {
    const err = new ValidationError('invalid', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: { age: 'must be positive' },
    })
    const json = err.toJSON()
    expect(json.fieldErrors).toEqual({ age: 'must be positive' })
  })

  it('omits fieldErrors from toJSON when empty', () => {
    const err = new ValidationError('invalid')
    const json = err.toJSON()
    expect(json).not.toHaveProperty('fieldErrors')
  })

  it('includes fieldErrors in toString', () => {
    const err = new ValidationError('invalid', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: { email: 'required' },
    })
    const str = err.toString()
    expect(str).toContain('Fields   :')
    expect(str).toContain('email: required')
  })
})

describe('ConfigError', () => {
  it('defaults code to CONFIG_INVALID and statusCode to 500', () => {
    const err = new ConfigError('bad config')
    expect(err.code).toBe('CONFIG_INVALID')
    expect(err.statusCode).toBe(500)
    expect(err.name).toBe('ConfigError')
  })

  it('accepts an options object', () => {
    const err = new ConfigError('missing env', {
      code: ErrorCodes.CONFIG_MISSING_ENV,
      suggestion: 'Add DATABASE_URL to .env',
    })
    expect(err.code).toBe('CONFIG_MISSING_ENV')
    expect(err.suggestion).toBe('Add DATABASE_URL to .env')
  })
})

describe('NetworkError', () => {
  it('defaults code to NETWORK_REQUEST_FAILED and statusCode to 502', () => {
    const err = new NetworkError('request failed')
    expect(err.code).toBe('NETWORK_REQUEST_FAILED')
    expect(err.statusCode).toBe(502)
    expect(err.name).toBe('NetworkError')
  })

  it('stores url and method', () => {
    const err = new NetworkError('timeout', {
      code: ErrorCodes.NETWORK_TIMEOUT,
      url: 'https://api.example.com/data',
      method: 'POST',
    })
    expect(err.url).toBe('https://api.example.com/data')
    expect(err.method).toBe('POST')
    expect(err.code).toBe('NETWORK_TIMEOUT')
  })

  it('includes url and method in toJSON', () => {
    const err = new NetworkError('fail', {
      code: ErrorCodes.NETWORK_REQUEST_FAILED,
      url: 'https://example.com',
      method: 'GET',
    })
    const json = err.toJSON()
    expect(json.url).toBe('https://example.com')
    expect(json.method).toBe('GET')
  })

  it('includes url and method in toString', () => {
    const err = new NetworkError('fail', {
      code: ErrorCodes.NETWORK_REQUEST_FAILED,
      url: 'https://example.com',
      method: 'GET',
    })
    const str = err.toString()
    expect(str).toContain('Method   : GET')
    expect(str).toContain('URL      : https://example.com')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ErrorFormatter
// ─────────────────────────────────────────────────────────────────────────────

describe('ErrorFormatter', () => {
  const err = new VibeKitError('test error', {
    code: ErrorCodes.DB_QUERY_ERROR,
    statusCode: 500,
    suggestion: 'Check your query',
    docsUrl: 'https://docs.vibekit.dev',
    requestId: 'req-abc',
    context: { table: 'users' },
    details: { sql: 'SELECT *' },
    cause: new Error('underlying'),
  })

  describe('text mode', () => {
    it('returns the toString representation', () => {
      const text = ErrorFormatter.format(err, 'text')
      expect(text).toContain('VibeKitError [DB_QUERY_ERROR]: test error')
      expect(text).toContain('Status   : 500')
      expect(text).toContain('Hint     : Check your query')
      expect(text).toContain('Docs     : https://docs.vibekit.dev')
      expect(text).toContain('RequestId: req-abc')
      expect(text).toContain('table: users')
    })
  })

  describe('json mode', () => {
    it('returns valid JSON string', () => {
      const jsonStr = ErrorFormatter.format(err, 'json')
      const parsed = JSON.parse(jsonStr)
      expect(parsed.name).toBe('VibeKitError')
      expect(parsed.code).toBe('DB_QUERY_ERROR')
      expect(parsed.statusCode).toBe(500)
      expect(parsed.suggestion).toBe('Check your query')
      expect(parsed.requestId).toBe('req-abc')
      expect(parsed.context).toEqual({ table: 'users' })
      expect(parsed.details).toEqual({ sql: 'SELECT *' })
      expect(parsed.cause).toEqual({ name: 'Error', message: 'underlying' })
    })
  })

  describe('terminal mode', () => {
    it('contains ANSI escape codes', () => {
      const terminal = ErrorFormatter.format(err, 'terminal')
      expect(terminal).toContain('\x1b[')
    })

    it('contains the error name and code', () => {
      const terminal = ErrorFormatter.format(err, 'terminal')
      expect(terminal).toContain('VibeKitError')
      expect(terminal).toContain('DB_QUERY_ERROR')
    })

    it('contains the suggestion and docsUrl', () => {
      const terminal = ErrorFormatter.format(err, 'terminal')
      expect(terminal).toContain('Check your query')
      expect(terminal).toContain('https://docs.vibekit.dev')
    })

    it('contains context entries', () => {
      const terminal = ErrorFormatter.format(err, 'terminal')
      expect(terminal).toContain('table:')
      expect(terminal).toContain('users')
    })

    it('contains cause info', () => {
      const terminal = ErrorFormatter.format(err, 'terminal')
      expect(terminal).toContain('Caused by:')
      expect(terminal).toContain('underlying')
    })

    it('uses warning icon for client errors', () => {
      const clientErr = new VibeKitError('not found', {
        code: ErrorCodes.AUTH_USER_NOT_FOUND,
        statusCode: 404,
      })
      const terminal = ErrorFormatter.format(clientErr, 'terminal')
      // \u26A0 is the warning sign for status < 500
      expect(terminal).toContain('\u26A0')
    })

    it('uses error icon for server errors', () => {
      const serverErr = new VibeKitError('internal', {
        code: ErrorCodes.UNKNOWN_ERROR,
        statusCode: 500,
      })
      const terminal = ErrorFormatter.format(serverErr, 'terminal')
      // \u2718 is the X mark for status >= 500
      expect(terminal).toContain('\u2718')
    })

    it('includes ValidationError fieldErrors in terminal mode', () => {
      const valErr = new ValidationError('invalid', {
        code: ErrorCodes.VALIDATION_FAILED,
        fieldErrors: { email: 'required', name: 'too short' },
      })
      const terminal = ErrorFormatter.format(valErr, 'terminal')
      expect(terminal).toContain('Field errors:')
      expect(terminal).toContain('email')
      expect(terminal).toContain('required')
    })

    it('includes NetworkError url and method in terminal mode', () => {
      const netErr = new NetworkError('timeout', {
        code: ErrorCodes.NETWORK_TIMEOUT,
        url: 'https://api.example.com',
        method: 'POST',
      })
      const terminal = ErrorFormatter.format(netErr, 'terminal')
      expect(terminal).toContain('Method: POST')
      expect(terminal).toContain('URL: https://api.example.com')
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// wrapError
// ─────────────────────────────────────────────────────────────────────────────

describe('wrapError', () => {
  it('passes through VibeKitError unchanged', () => {
    const original = new VibeKitError('test', 'CODE', 400)
    const wrapped = wrapError(original)
    expect(wrapped).toBe(original)
  })

  it('wraps a generic Error', () => {
    const original = new Error('something broke')
    const wrapped = wrapError(original)
    expect(wrapped).toBeInstanceOf(VibeKitError)
    expect(wrapped.message).toBe('something broke')
    expect(wrapped.code).toBe('UNKNOWN_ERROR')
    expect(wrapped.statusCode).toBe(500)
    expect(wrapped.cause).toBe(original)
  })

  it('wraps a string', () => {
    const wrapped = wrapError('oops')
    expect(wrapped).toBeInstanceOf(VibeKitError)
    expect(wrapped.message).toBe('oops')
    expect(wrapped.code).toBe('UNKNOWN_ERROR')
  })

  it('wraps unknown values with a generic message', () => {
    const wrapped = wrapError(42)
    expect(wrapped).toBeInstanceOf(VibeKitError)
    expect(wrapped.message).toBe('An unexpected error occurred')
  })

  it('wraps null with a generic message', () => {
    const wrapped = wrapError(null)
    expect(wrapped).toBeInstanceOf(VibeKitError)
    expect(wrapped.message).toBe('An unexpected error occurred')
  })

  it('accepts fallbackOpts to customize the wrapped error', () => {
    const original = new Error('db failed')
    const wrapped = wrapError(original, {
      code: ErrorCodes.DB_QUERY_ERROR,
      statusCode: 503,
      suggestion: 'Check the database',
      context: { query: 'SELECT' },
      requestId: 'req-fallback',
    })
    expect(wrapped.code).toBe('DB_QUERY_ERROR')
    expect(wrapped.statusCode).toBe(503)
    expect(wrapped.suggestion).toBe('Check the database')
    expect(wrapped.context).toEqual({ query: 'SELECT' })
    expect(wrapped.requestId).toBe('req-fallback')
    expect(wrapped.cause).toBe(original)
  })

  it('preserves VibeKitError subclasses', () => {
    const original = new AuthError('expired', ErrorCodes.AUTH_SESSION_EXPIRED)
    const wrapped = wrapError(original)
    expect(wrapped).toBe(original)
    expect(wrapped).toBeInstanceOf(AuthError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isVibeKitError
// ─────────────────────────────────────────────────────────────────────────────

describe('isVibeKitError', () => {
  it('returns true for VibeKitError', () => {
    expect(isVibeKitError(new VibeKitError('t', 'c'))).toBe(true)
  })

  it('returns true for AuthError subclass', () => {
    expect(isVibeKitError(new AuthError('t', 'c'))).toBe(true)
  })

  it('returns true for DbError subclass', () => {
    expect(isVibeKitError(new DbError('t'))).toBe(true)
  })

  it('returns true for StorageError subclass', () => {
    expect(isVibeKitError(new StorageError('t'))).toBe(true)
  })

  it('returns true for ValidationError subclass', () => {
    expect(isVibeKitError(new ValidationError('t'))).toBe(true)
  })

  it('returns true for ConfigError subclass', () => {
    expect(isVibeKitError(new ConfigError('t'))).toBe(true)
  })

  it('returns true for NetworkError subclass', () => {
    expect(isVibeKitError(new NetworkError('t'))).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isVibeKitError(new Error('t'))).toBe(false)
  })

  it('returns false for non-errors', () => {
    expect(isVibeKitError('string')).toBe(false)
    expect(isVibeKitError(null)).toBe(false)
    expect(isVibeKitError(undefined)).toBe(false)
    expect(isVibeKitError(42)).toBe(false)
    expect(isVibeKitError({})).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ErrorCodeRegistry
// ─────────────────────────────────────────────────────────────────────────────

describe('ErrorCodeRegistry', () => {
  it('has entries for all ErrorCodes', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(ErrorCodeRegistry[code]).toBeDefined()
      expect(ErrorCodeRegistry[code].description).toBeTruthy()
      expect(typeof ErrorCodeRegistry[code].defaultStatusCode).toBe('number')
    }
  })

  it('AUTH error codes map to expected status codes', () => {
    expect(ErrorCodeRegistry.AUTH_CODE_EXPIRED.defaultStatusCode).toBe(400)
    expect(ErrorCodeRegistry.AUTH_RATE_LIMITED.defaultStatusCode).toBe(429)
    expect(ErrorCodeRegistry.AUTH_SESSION_EXPIRED.defaultStatusCode).toBe(401)
    expect(ErrorCodeRegistry.AUTH_UNAUTHORIZED.defaultStatusCode).toBe(401)
    expect(ErrorCodeRegistry.AUTH_USER_NOT_FOUND.defaultStatusCode).toBe(404)
    expect(ErrorCodeRegistry.AUTH_SIGNUP_DISABLED.defaultStatusCode).toBe(403)
  })

  it('DB error codes map to 500', () => {
    expect(ErrorCodeRegistry.DB_CONNECTION_FAILED.defaultStatusCode).toBe(500)
    expect(ErrorCodeRegistry.DB_QUERY_ERROR.defaultStatusCode).toBe(500)
    expect(ErrorCodeRegistry.DB_TABLE_NOT_FOUND.defaultStatusCode).toBe(500)
    expect(ErrorCodeRegistry.DB_MIGRATION_FAILED.defaultStatusCode).toBe(500)
  })

  it('STORAGE error codes have appropriate status codes', () => {
    expect(ErrorCodeRegistry.STORAGE_FILE_NOT_FOUND.defaultStatusCode).toBe(404)
    expect(ErrorCodeRegistry.STORAGE_FILE_TOO_LARGE.defaultStatusCode).toBe(413)
    expect(ErrorCodeRegistry.STORAGE_INVALID_TYPE.defaultStatusCode).toBe(415)
  })

  it('VALIDATION error codes map to 400', () => {
    expect(ErrorCodeRegistry.VALIDATION_FAILED.defaultStatusCode).toBe(400)
    expect(ErrorCodeRegistry.VALIDATION_REQUIRED_FIELD.defaultStatusCode).toBe(400)
  })

  it('NETWORK error codes have appropriate status codes', () => {
    expect(ErrorCodeRegistry.NETWORK_TIMEOUT.defaultStatusCode).toBe(504)
    expect(ErrorCodeRegistry.NETWORK_DNS_FAILURE.defaultStatusCode).toBe(502)
    expect(ErrorCodeRegistry.NETWORK_CONNECTION_REFUSED.defaultStatusCode).toBe(502)
  })

  it('all entries have docsUrl', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(ErrorCodeRegistry[code].docsUrl).toContain('https://vibekit.dev/docs/errors')
    }
  })

  it('all entries have defaultSuggestion', () => {
    for (const code of Object.values(ErrorCodes)) {
      expect(ErrorCodeRegistry[code].defaultSuggestion).toBeTruthy()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Cause chain preservation
// ─────────────────────────────────────────────────────────────────────────────

describe('Cause chain preservation', () => {
  it('preserves a single-level cause', () => {
    const root = new Error('root cause')
    const err = new VibeKitError('outer', { code: 'X', cause: root })
    expect(err.cause).toBe(root)
    expect((err.cause as Error).message).toBe('root cause')
  })

  it('preserves a multi-level cause chain', () => {
    const level0 = new Error('level 0')
    const level1 = new VibeKitError('level 1', { code: 'X', cause: level0 })
    const level2 = new VibeKitError('level 2', { code: 'Y', cause: level1 })

    expect(level2.cause).toBe(level1)
    expect((level2.cause as VibeKitError).cause).toBe(level0)
  })

  it('serializes cause chain in toJSON', () => {
    const root = new TypeError('type mismatch')
    const err = new VibeKitError('wrapper', { code: 'X', cause: root })
    const json = err.toJSON()
    expect(json.cause).toEqual({ name: 'TypeError', message: 'type mismatch' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Context merging (options-based)
// ─────────────────────────────────────────────────────────────────────────────

describe('Context in options', () => {
  it('stores context from options', () => {
    const err = new VibeKitError('fail', {
      code: 'X',
      context: { userId: 'u1', region: 'us-east-1' },
    })
    expect(err.context).toEqual({ userId: 'u1', region: 'us-east-1' })
  })

  it('defaults context to empty object', () => {
    const err = new VibeKitError('fail', { code: 'X' })
    expect(err.context).toEqual({})
  })

  it('context shows in toString', () => {
    const err = new VibeKitError('fail', {
      code: 'X',
      context: { key: 'val' },
    })
    const str = err.toString()
    expect(str).toContain('key: val')
  })

  it('context shows in toJSON', () => {
    const err = new VibeKitError('fail', {
      code: 'X',
      context: { a: 1, b: 'two' },
    })
    const json = err.toJSON()
    expect(json.context).toEqual({ a: 1, b: 'two' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// instanceof checks
// ─────────────────────────────────────────────────────────────────────────────

describe('instanceof checks', () => {
  it('VibeKitError instanceof Error', () => {
    expect(new VibeKitError('t', 'c')).toBeInstanceOf(Error)
  })

  it('AuthError instanceof VibeKitError', () => {
    expect(new AuthError('t', 'c')).toBeInstanceOf(VibeKitError)
  })

  it('DbError instanceof VibeKitError', () => {
    expect(new DbError('t')).toBeInstanceOf(VibeKitError)
  })

  it('StorageError instanceof VibeKitError', () => {
    expect(new StorageError('t')).toBeInstanceOf(VibeKitError)
  })

  it('ValidationError instanceof VibeKitError', () => {
    expect(new ValidationError('t')).toBeInstanceOf(VibeKitError)
  })

  it('ConfigError instanceof VibeKitError', () => {
    expect(new ConfigError('t')).toBeInstanceOf(VibeKitError)
  })

  it('NetworkError instanceof VibeKitError', () => {
    expect(new NetworkError('t')).toBeInstanceOf(VibeKitError)
  })
})
