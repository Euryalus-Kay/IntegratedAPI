import { describe, it, expect } from 'vitest'
import { VibeKitError, AuthError, DbError, StorageError, ValidationError, ConfigError, wrapError, isVibeKitError } from '../src/utils/errors.js'

describe('VibeKitError', () => {
  it('creates error with all properties', () => {
    const err = new VibeKitError('Something failed', 'TEST_ERROR', 500, { key: 'value' })
    expect(err.message).toBe('Something failed')
    expect(err.code).toBe('TEST_ERROR')
    expect(err.statusCode).toBe(500)
    expect(err.details).toEqual({ key: 'value' })
    expect(err.name).toBe('VibeKitError')
  })

  it('serializes to JSON', () => {
    const err = new VibeKitError('fail', 'CODE', 400)
    const json = err.toJSON()
    expect(json.error).toBe('fail')
    expect(json.code).toBe('CODE')
    expect(json.statusCode).toBe(400)
  })

  it('includes suggestion in output', () => {
    const err = new VibeKitError('fail', 'CODE', 400)
    err.suggestion = 'Try doing X instead'
    const json = err.toJSON()
    expect(json.suggestion).toBe('Try doing X instead')
  })
})

describe('Error subclasses', () => {
  it('AuthError defaults to 401', () => {
    const err = new AuthError('unauthorized', 'AUTH_FAIL')
    expect(err.statusCode).toBe(401)
    expect(err.name).toBe('AuthError')
  })

  it('DbError defaults to 500', () => {
    const err = new DbError('db failed')
    expect(err.statusCode).toBe(500)
    expect(err.code).toBe('DB_ERROR')
  })

  it('StorageError defaults to 500', () => {
    const err = new StorageError('storage failed')
    expect(err.statusCode).toBe(500)
  })

  it('ValidationError defaults to 400', () => {
    const err = new ValidationError('invalid input', { field: 'email' })
    expect(err.statusCode).toBe(400)
    expect(err.code).toBe('VALIDATION_ERROR')
  })

  it('ConfigError defaults to 500', () => {
    const err = new ConfigError('bad config', 'Check vibekit.json')
    expect(err.statusCode).toBe(500)
    expect(err.suggestion).toBe('Check vibekit.json')
  })
})

describe('wrapError', () => {
  it('passes through VibeKitError unchanged', () => {
    const original = new VibeKitError('test', 'CODE', 400)
    const wrapped = wrapError(original)
    expect(wrapped).toBe(original)
  })

  it('wraps generic Error', () => {
    const original = new Error('something broke')
    const wrapped = wrapError(original, 'CONTEXT')
    expect(wrapped).toBeInstanceOf(VibeKitError)
    expect(wrapped.message).toBe('something broke')
    expect(wrapped.code).toBe('CONTEXT')
  })

  it('wraps string', () => {
    const wrapped = wrapError('oops')
    expect(wrapped).toBeInstanceOf(VibeKitError)
    expect(wrapped.message).toBe('oops')
  })

  it('wraps unknown', () => {
    const wrapped = wrapError(42)
    expect(wrapped).toBeInstanceOf(VibeKitError)
    expect(wrapped.message).toContain('42')
  })
})

describe('isVibeKitError', () => {
  it('returns true for VibeKitError', () => {
    expect(isVibeKitError(new VibeKitError('t', 'c'))).toBe(true)
  })
  it('returns true for subclasses', () => {
    expect(isVibeKitError(new AuthError('t', 'c'))).toBe(true)
  })
  it('returns false for plain Error', () => {
    expect(isVibeKitError(new Error('t'))).toBe(false)
  })
  it('returns false for non-errors', () => {
    expect(isVibeKitError('string')).toBe(false)
    expect(isVibeKitError(null)).toBe(false)
  })
})
