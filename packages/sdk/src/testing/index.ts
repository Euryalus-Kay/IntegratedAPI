/**
 * Test utilities for VibeKit. Import from 'vibekit/testing'.
 * Provides helpers for creating test databases, mock users, and test fixtures.
 */

import { createSqliteAdapter } from '../db/sqlite.js'
import type { DatabaseAdapter } from '../db/types.js'
import type { User } from '../auth/types.js'
import crypto from 'node:crypto'

/** Create an in-memory SQLite database for testing */
export function createTestDb(): DatabaseAdapter {
  return createSqliteAdapter(':memory:')
}

/** Create a mock user object for testing */
export function createMockUser(overrides?: Partial<User>): User {
  return {
    id: crypto.randomUUID(),
    email: `test-${Date.now()}@example.com`,
    name: null,
    avatar_url: null,
    role: 'user',
    email_verified: true,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

/** Create a mock HTTP request for testing auth middleware */
export function createMockRequest(options?: {
  headers?: Record<string, string>
  cookies?: Record<string, string>
  method?: string
  url?: string
  body?: unknown
}): any {
  const headers: Record<string, string> = { ...options?.headers }
  if (options?.cookies) {
    headers.cookie = Object.entries(options.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ')
  }
  return {
    method: options?.method || 'GET',
    url: options?.url || '/',
    headers,
    body: options?.body,
  }
}

/** Create a mock HTTP response for testing middleware */
export function createMockResponse(): any {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as unknown,
    _redirectUrl: null as string | null,
    setHeader(name: string, value: string) { res.headers[name.toLowerCase()] = value; return res },
    status(code: number) { res.statusCode = code; return res },
    writeHead(code: number) { res.statusCode = code; return res },
    json(data: unknown) { res.body = data; return res },
    send(data: unknown) { res.body = data; return res },
    end(data?: unknown) { if (data) res.body = data; return res },
    redirect(url: string) { res._redirectUrl = url; return res },
    header(name: string, value: string) { res.headers[name.toLowerCase()] = value; return res },
  }
  return res
}

/** Seed a test database with table schema and data */
export async function seedTestDb(
  db: DatabaseAdapter,
  tables: Record<string, { schema: string; data?: Record<string, unknown>[] }>
): Promise<void> {
  for (const [name, { schema, data }] of Object.entries(tables)) {
    await db.execute(schema)
    if (data) {
      for (const row of data) {
        const columns = Object.keys(row)
        const values = Object.values(row)
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
        await db.execute(
          `INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`,
          values
        )
      }
    }
  }
}

/** Wait for a condition to be true (for async testing) */
export async function waitFor(
  fn: () => boolean | Promise<boolean>,
  options?: { timeout?: number; interval?: number }
): Promise<void> {
  const timeout = options?.timeout ?? 5000
  const interval = options?.interval ?? 50
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await fn()) return
    await new Promise(r => setTimeout(r, interval))
  }
  throw new Error(`waitFor timed out after ${timeout}ms`)
}

/** Generate a random email for testing */
export function randomEmail(): string {
  return `test-${crypto.randomUUID().slice(0, 8)}@example.com`
}

/** Generate a random string */
export function randomString(length: number = 16): string {
  return crypto.randomBytes(length).toString('hex').slice(0, length)
}

/** Assert that a function throws a VibeKitError with the expected code */
export async function expectError(
  fn: () => Promise<unknown>,
  expectedCode: string
): Promise<void> {
  try {
    await fn()
    throw new Error(`Expected function to throw error with code ${expectedCode}, but it did not throw`)
  } catch (err: any) {
    if (err.code !== expectedCode) {
      throw new Error(`Expected error code ${expectedCode}, got ${err.code || 'none'}: ${err.message}`)
    }
  }
}
