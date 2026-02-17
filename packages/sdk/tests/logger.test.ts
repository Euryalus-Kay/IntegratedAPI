import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createLogger,
  getRecentLogs,
  clearLogBuffer,
  setLogBufferSize,
  type LogEntry,
  type Logger,
} from '../src/utils/logger.js'

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup: mock config so we control env and log level
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  clearLogBuffer()
  // Ensure we can see all log levels
  process.env.VIBEKIT_LOG_LEVEL = 'debug'
  process.env.VIBEKIT_LOG_FORMAT = 'json'
})

afterEach(() => {
  delete process.env.VIBEKIT_LOG_LEVEL
  delete process.env.VIBEKIT_LOG_FORMAT
  delete process.env.VIBEKIT_SLOW_QUERY_MS
  clearLogBuffer()
})

// ─────────────────────────────────────────────────────────────────────────────
// Logger creation
// ─────────────────────────────────────────────────────────────────────────────

describe('createLogger', () => {
  it('creates a logger with a module name', () => {
    const log = createLogger('test-module')
    expect(log.module).toBe('test-module')
  })

  it('has all log level methods', () => {
    const log = createLogger('test')
    expect(typeof log.debug).toBe('function')
    expect(typeof log.info).toBe('function')
    expect(typeof log.warn).toBe('function')
    expect(typeof log.error).toBe('function')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Logging to buffer
// ─────────────────────────────────────────────────────────────────────────────

describe('Logging to buffer', () => {
  it('debug() adds entry to log buffer', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('mod')
    log.debug('debug message')

    const logs = getRecentLogs()
    expect(logs.length).toBe(1)
    expect(logs[0].level).toBe('debug')
    expect(logs[0].module).toBe('mod')
    expect(logs[0].message).toBe('debug message')
    expect(logs[0].timestamp).toBeTruthy()
    spy.mockRestore()
  })

  it('info() adds entry to log buffer', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('mod')
    log.info('info message')

    const logs = getRecentLogs()
    expect(logs.length).toBe(1)
    expect(logs[0].level).toBe('info')
    spy.mockRestore()
  })

  it('warn() adds entry to log buffer', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = createLogger('mod')
    log.warn('warn message')

    const logs = getRecentLogs()
    expect(logs.length).toBe(1)
    expect(logs[0].level).toBe('warn')
    spy.mockRestore()
  })

  it('error() adds entry to log buffer', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('mod')
    log.error('error message')

    const logs = getRecentLogs()
    expect(logs.length).toBe(1)
    expect(logs[0].level).toBe('error')
    spy.mockRestore()
  })

  it('stores extra data in the log entry', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('mod')
    log.debug('with data', { userId: '123', action: 'test' })

    const logs = getRecentLogs()
    expect(logs[0].data).toEqual({ userId: '123', action: 'test' })
    spy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Log level filtering
// ─────────────────────────────────────────────────────────────────────────────

describe('Log level filtering', () => {
  it('filters out debug when level is set to info', () => {
    process.env.VIBEKIT_LOG_LEVEL = 'info'
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const log = createLogger('filter')
    log.debug('should not print')
    log.info('should print')

    // debug should not be printed to console (but still buffered)
    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).toHaveBeenCalled()

    debugSpy.mockRestore()
    infoSpy.mockRestore()
  })

  it('filters out debug and info when level is set to warn', () => {
    process.env.VIBEKIT_LOG_LEVEL = 'warn'
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const log = createLogger('filter')
    log.debug('no')
    log.info('no')
    log.warn('yes')

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()

    debugSpy.mockRestore()
    infoSpy.mockRestore()
    warnSpy.mockRestore()
  })

  it('only shows error when level is set to error', () => {
    process.env.VIBEKIT_LOG_LEVEL = 'error'
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const log = createLogger('filter')
    log.debug('no')
    log.info('no')
    log.warn('no')
    log.error('yes')

    expect(debugSpy).not.toHaveBeenCalled()
    expect(infoSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()

    debugSpy.mockRestore()
    infoSpy.mockRestore()
    warnSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('still buffers entries even when filtered from console output', () => {
    process.env.VIBEKIT_LOG_LEVEL = 'error'
    vi.spyOn(console, 'debug').mockImplementation(() => {})
    vi.spyOn(console, 'info').mockImplementation(() => {})

    const log = createLogger('buffer')
    log.debug('buffered')
    log.info('also buffered')

    const logs = getRecentLogs()
    expect(logs.length).toBe(2)

    vi.restoreAllMocks()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Log buffer
// ─────────────────────────────────────────────────────────────────────────────

describe('Log buffer', () => {
  it('getRecentLogs returns all logs when no count specified', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('buf')
    log.debug('one')
    log.debug('two')
    log.debug('three')

    const logs = getRecentLogs()
    expect(logs).toHaveLength(3)
    spy.mockRestore()
  })

  it('getRecentLogs limits by count', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('buf')
    log.debug('one')
    log.debug('two')
    log.debug('three')

    const logs = getRecentLogs(2)
    expect(logs).toHaveLength(2)
    // Should return the most recent
    expect(logs[0].message).toBe('two')
    expect(logs[1].message).toBe('three')
    spy.mockRestore()
  })

  it('clearLogBuffer empties the buffer', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('buf')
    log.debug('entry')

    expect(getRecentLogs().length).toBeGreaterThan(0)
    clearLogBuffer()
    expect(getRecentLogs()).toHaveLength(0)
    spy.mockRestore()
  })

  it('setLogBufferSize limits the buffer', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    setLogBufferSize(3)

    const log = createLogger('buf')
    for (let i = 0; i < 10; i++) {
      log.debug(`msg ${i}`)
    }

    const logs = getRecentLogs()
    expect(logs).toHaveLength(3)
    // Should have the most recent entries
    expect(logs[0].message).toBe('msg 7')
    expect(logs[1].message).toBe('msg 8')
    expect(logs[2].message).toBe('msg 9')

    // Reset buffer size
    setLogBufferSize(100)
    spy.mockRestore()
  })

  it('setLogBufferSize drops old entries if buffer exceeds new limit', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('buf')
    for (let i = 0; i < 10; i++) {
      log.debug(`entry ${i}`)
    }

    expect(getRecentLogs().length).toBe(10)
    setLogBufferSize(5)
    expect(getRecentLogs().length).toBe(5)

    // Reset
    setLogBufferSize(100)
    spy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Request logging
// ─────────────────────────────────────────────────────────────────────────────

describe('logRequest', () => {
  it('logs a successful request at info level', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('http')
    log.logRequest({
      method: 'GET',
      path: '/api/users',
      statusCode: 200,
      durationMs: 42,
    })

    const logs = getRecentLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].level).toBe('info')
    expect(logs[0].message).toContain('GET')
    expect(logs[0].message).toContain('/api/users')
    expect(logs[0].message).toContain('200')
    expect(logs[0].data?.method).toBe('GET')
    expect(logs[0].data?.path).toBe('/api/users')
    expect(logs[0].data?.statusCode).toBe(200)
    expect(logs[0].data?.durationMs).toBe(42)
    spy.mockRestore()
  })

  it('logs 4xx request at warn level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = createLogger('http')
    log.logRequest({
      method: 'POST',
      path: '/api/login',
      statusCode: 401,
    })

    const logs = getRecentLogs()
    expect(logs[0].level).toBe('warn')
    spy.mockRestore()
  })

  it('logs 5xx request at error level', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const log = createLogger('http')
    log.logRequest({
      method: 'GET',
      path: '/api/data',
      statusCode: 500,
    })

    const logs = getRecentLogs()
    expect(logs[0].level).toBe('error')
    spy.mockRestore()
  })

  it('includes requestId when provided', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('http')
    log.logRequest({
      method: 'GET',
      path: '/',
      statusCode: 200,
      requestId: 'req-abc',
    })

    const logs = getRecentLogs()
    expect(logs[0].data?.requestId).toBe('req-abc')
    spy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Query logging
// ─────────────────────────────────────────────────────────────────────────────

describe('logQuery', () => {
  it('logs a normal query at debug level', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('db')
    log.logQuery({
      query: 'SELECT * FROM users',
      durationMs: 5,
      rowCount: 10,
    })

    const logs = getRecentLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].level).toBe('debug')
    expect(logs[0].message).toContain('5ms')
    expect(logs[0].message).toContain('SELECT * FROM users')
    spy.mockRestore()
  })

  it('logs a slow query at warn level', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = createLogger('db')
    log.logQuery({
      query: 'SELECT * FROM large_table',
      durationMs: 500,
      rowCount: 1000,
    })

    const logs = getRecentLogs()
    expect(logs[0].level).toBe('warn')
    expect(logs[0].message).toContain('Slow query')
    expect(logs[0].message).toContain('500ms')
    spy.mockRestore()
  })

  it('respects VIBEKIT_SLOW_QUERY_MS threshold', () => {
    process.env.VIBEKIT_SLOW_QUERY_MS = '50'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const log = createLogger('db')
    log.logQuery({
      query: 'SELECT 1',
      durationMs: 60,
    })

    const logs = getRecentLogs()
    expect(logs[0].level).toBe('warn')
    expect(logs[0].message).toContain('Slow query')
    warnSpy.mockRestore()
  })

  it('includes query params in log data', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('db')
    log.logQuery({
      query: 'SELECT * FROM users WHERE id = $1',
      params: ['user-123'],
      durationMs: 3,
    })

    const logs = getRecentLogs()
    expect(logs[0].data?.params).toEqual(['user-123'])
    spy.mockRestore()
  })

  it('truncates long query strings in message', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('db')
    const longQuery = 'SELECT ' + 'a, '.repeat(100) + 'b FROM table'
    log.logQuery({
      query: longQuery,
      durationMs: 2,
    })

    const logs = getRecentLogs()
    expect(logs[0].message.length).toBeLessThan(longQuery.length + 50)
    // But the full query is preserved in data
    expect(logs[0].data?.query).toBe(longQuery)
    spy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Child loggers
// ─────────────────────────────────────────────────────────────────────────────

describe('Child loggers', () => {
  it('creates a child logger with the same module name', () => {
    const parent = createLogger('parent')
    const child = parent.child({ requestId: 'req-1' })
    expect(child.module).toBe('parent')
  })

  it('merges parent context into every log entry', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const parent = createLogger('svc')
    const child = parent.child({ requestId: 'req-abc' })

    child.info('child message')

    const logs = getRecentLogs()
    expect(logs[0].data?.requestId).toBe('req-abc')
    spy.mockRestore()
  })

  it('child data overrides parent context', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const parent = createLogger('svc')
    const child = parent.child({ env: 'test' })

    child.info('override', { env: 'production' })

    const logs = getRecentLogs()
    expect(logs[0].data?.env).toBe('production')
    spy.mockRestore()
  })

  it('supports nested child loggers', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const root = createLogger('root')
    const child1 = root.child({ a: 1 })
    const child2 = child1.child({ b: 2 })

    child2.info('nested')

    const logs = getRecentLogs()
    expect(logs[0].data?.a).toBe(1)
    expect(logs[0].data?.b).toBe(2)
    spy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Timer
// ─────────────────────────────────────────────────────────────────────────────

describe('Timer', () => {
  it('measures elapsed time', async () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('perf')
    const timer = log.timer('operation')

    // Simulate some work
    await new Promise(r => setTimeout(r, 20))

    const elapsed = timer.end()
    expect(elapsed).toBeGreaterThanOrEqual(0)

    const logs = getRecentLogs()
    expect(logs).toHaveLength(1)
    expect(logs[0].data?.durationMs).toBeDefined()
    expect(logs[0].data?.timer).toBe('operation')
    spy.mockRestore()
  })

  it('uses custom end message', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('perf')
    const timer = log.timer('task')
    timer.end('task finished')

    const logs = getRecentLogs()
    expect(logs[0].message).toBe('task finished')
    spy.mockRestore()
  })

  it('uses default label and message when not provided', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('perf')
    const timer = log.timer()
    timer.end()

    const logs = getRecentLogs()
    expect(logs[0].message).toBe('operation completed')
    expect(logs[0].data?.timer).toBe('operation')
    spy.mockRestore()
  })

  it('logs at custom level', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const log = createLogger('perf')
    const timer = log.timer('quick', 'debug')
    timer.end()

    const logs = getRecentLogs()
    expect(logs[0].level).toBe('debug')
    spy.mockRestore()
  })

  it('accepts extra data with end()', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {})
    const log = createLogger('perf')
    const timer = log.timer('op')
    timer.end('done', { resultCount: 42 })

    const logs = getRecentLogs()
    expect(logs[0].data?.resultCount).toBe(42)
    spy.mockRestore()
  })
})
