import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import crypto from 'node:crypto'
import { createTestDb } from '../src/testing/index.js'
import type { DatabaseAdapter } from '../src/db/types.js'
import type { User } from '../src/auth/types.js'
import { generateCode, storeCode, validateCode, hashCode, verifyCodeHash } from '../src/auth/codes.js'
import { createSession, verifySession, revokeSession } from '../src/auth/session.js'

// ─────────────────────────────────────────────────────────────────────────────
// Shared setup
// ─────────────────────────────────────────────────────────────────────────────

const AUTH_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  email_verified INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0,
  banned_reason TEXT,
  last_login_at TEXT,
  login_count INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS vibekit_auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_auth_codes_email ON vibekit_auth_codes(email);

CREATE TABLE IF NOT EXISTS vibekit_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vibekit_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON vibekit_sessions(user_id);

CREATE TABLE IF NOT EXISTS vibekit_audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  metadata TEXT DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`

async function createAuthTables(db: DatabaseAdapter): Promise<void> {
  for (const stmt of AUTH_TABLES_SQL.split(';').filter(s => s.trim())) {
    await db.execute(stmt + ';')
  }
}

function createTestUser(overrides?: Partial<User>): User {
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

async function insertUser(db: DatabaseAdapter, user: User): Promise<void> {
  await db.execute(
    `INSERT INTO vibekit_users (id, email, name, avatar_url, role, email_verified, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      user.id,
      user.email,
      user.name,
      user.avatar_url,
      user.role,
      user.email_verified ? 1 : 0,
      JSON.stringify(user.metadata),
      user.created_at,
      user.updated_at,
    ],
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Code generation & hashing
// ─────────────────────────────────────────────────────────────────────────────

describe('Auth codes', () => {
  describe('generateCode', () => {
    it('returns a 6-digit numeric string', () => {
      for (let i = 0; i < 20; i++) {
        const code = generateCode()
        expect(code).toMatch(/^\d{6}$/)
        expect(parseInt(code, 10)).toBeGreaterThanOrEqual(100000)
        expect(parseInt(code, 10)).toBeLessThanOrEqual(999999)
      }
    })

    it('generates different codes each time (probabilistic)', () => {
      const codes = new Set<string>()
      for (let i = 0; i < 50; i++) {
        codes.add(generateCode())
      }
      // At minimum we should get more than 1 unique code out of 50
      expect(codes.size).toBeGreaterThan(1)
    })
  })

  describe('hashCode / verifyCodeHash', () => {
    it('hashes and verifies a code correctly', async () => {
      const code = '123456'
      const hash = await hashCode(code)
      expect(hash).not.toBe(code)
      expect(await verifyCodeHash(code, hash)).toBe(true)
    })

    it('rejects a wrong code', async () => {
      const hash = await hashCode('123456')
      expect(await verifyCodeHash('654321', hash)).toBe(false)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// storeCode
// ─────────────────────────────────────────────────────────────────────────────

describe('storeCode', () => {
  let db: DatabaseAdapter

  beforeEach(async () => {
    db = createTestDb()
    await createAuthTables(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('stores a code and returns expiry date', async () => {
    const before = Date.now()
    const { expiresAt } = await storeCode(db, 'test@example.com', '123456')
    expect(expiresAt).toBeInstanceOf(Date)
    expect(expiresAt.getTime()).toBeGreaterThan(before)
  })

  it('creates an auth_codes record', async () => {
    await storeCode(db, 'test@example.com', '654321')
    const result = await db.query<{ email: string }>('SELECT * FROM vibekit_auth_codes')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].email).toBe('test@example.com')
  })

  it('rate limits after too many codes in the window', async () => {
    // MAX_CODES_PER_WINDOW = 3 by default in codes.ts
    // The rate limit checks `created_at > windowStart` where windowStart is an ISO string.
    // SQLite's datetime('now') default uses 'YYYY-MM-DD HH:MM:SS' format which compares
    // differently with ISO strings. We manually insert codes with ISO timestamps to
    // properly test the rate-limit logic.
    const email = 'rate@example.com'
    const recentTime = new Date().toISOString()
    const hash = await hashCode('000000')

    for (let i = 0; i < 3; i++) {
      await db.execute(
        `INSERT INTO vibekit_auth_codes (id, email, code_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), email, hash, recentTime, recentTime],
      )
    }

    await expect(
      storeCode(db, email, '444444'),
    ).rejects.toThrow(/Too many verification codes/)
  })

  it('rate limits are per-email', async () => {
    const recentTime = new Date().toISOString()
    const hash = await hashCode('000000')

    for (let i = 0; i < 3; i++) {
      await db.execute(
        `INSERT INTO vibekit_auth_codes (id, email, code_hash, expires_at, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [crypto.randomUUID(), 'a@example.com', hash, recentTime, recentTime],
      )
    }

    // Different email should be fine
    const { expiresAt } = await storeCode(db, 'b@example.com', '444444')
    expect(expiresAt).toBeInstanceOf(Date)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateCode
// ─────────────────────────────────────────────────────────────────────────────

describe('validateCode', () => {
  let db: DatabaseAdapter

  beforeEach(async () => {
    db = createTestDb()
    await createAuthTables(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('validates a correct code', async () => {
    const code = '123456'
    await storeCode(db, 'user@example.com', code)
    const result = await validateCode(db, 'user@example.com', code)
    expect(result).toBe(true)
  })

  it('throws on wrong code', async () => {
    await storeCode(db, 'user@example.com', '123456')
    await expect(
      validateCode(db, 'user@example.com', '999999'),
    ).rejects.toThrow(/Invalid verification code/)
  })

  it('throws when no code exists for the email', async () => {
    await expect(
      validateCode(db, 'nocode@example.com', '123456'),
    ).rejects.toThrow(/No verification code found/)
  })

  it('throws when code is expired', async () => {
    const code = '123456'
    const hash = await hashCode(code)
    const expiredAt = new Date(Date.now() - 60000).toISOString()
    const id = crypto.randomUUID()

    await db.execute(
      `INSERT INTO vibekit_auth_codes (id, email, code_hash, expires_at) VALUES ($1, $2, $3, $4)`,
      [id, 'expired@example.com', hash, expiredAt],
    )

    await expect(
      validateCode(db, 'expired@example.com', code),
    ).rejects.toThrow(/expired/)
  })

  it('throws when max attempts exceeded', async () => {
    const code = '123456'
    const hash = await hashCode(code)
    const expiresAt = new Date(Date.now() + 600000).toISOString()
    const id = crypto.randomUUID()

    await db.execute(
      `INSERT INTO vibekit_auth_codes (id, email, code_hash, expires_at, attempts)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, 'maxed@example.com', hash, expiresAt, 5],
    )

    await expect(
      validateCode(db, 'maxed@example.com', code),
    ).rejects.toThrow(/Too many incorrect attempts/)
  })

  it('increments attempts on wrong code', async () => {
    await storeCode(db, 'attempt@example.com', '123456')

    await expect(
      validateCode(db, 'attempt@example.com', '000000'),
    ).rejects.toThrow()

    const record = await db.queryOne<{ attempts: number }>(
      'SELECT attempts FROM vibekit_auth_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      ['attempt@example.com'],
    )
    expect(record?.attempts).toBe(1)
  })

  it('marks code as used after successful validation', async () => {
    const code = '123456'
    await storeCode(db, 'used@example.com', code)
    await validateCode(db, 'used@example.com', code)

    const record = await db.queryOne<{ used: number }>(
      'SELECT used FROM vibekit_auth_codes WHERE email = $1 ORDER BY created_at DESC LIMIT 1',
      ['used@example.com'],
    )
    expect(record?.used).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Session management
// ─────────────────────────────────────────────────────────────────────────────

describe('Session management', () => {
  let db: DatabaseAdapter
  const jwtSecret = crypto.randomBytes(64).toString('hex')

  // We need to mock getConfig for session functions since they import it
  beforeEach(async () => {
    db = createTestDb()
    await createAuthTables(db)

    // Mock the config module
    vi.doMock('../src/config/index.js', () => ({
      getConfig: () => ({
        jwtSecret,
        modules: {
          auth: { sessionDuration: '30d', allowSignup: true },
        },
      }),
      isLocal: () => true,
    }))
  })

  afterEach(async () => {
    await db.close()
    vi.restoreAllMocks()
  })

  it('creates a session and returns token, user, and expiresAt', async () => {
    const { createSession: createSessionFresh } = await import('../src/auth/session.js')
    const user = createTestUser({ email: 'session@example.com' })
    await insertUser(db, user)

    const result = await createSessionFresh(db, user)

    expect(result.user).toEqual(user)
    expect(result.token).toBeTruthy()
    expect(typeof result.token).toBe('string')
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('stores session in the database', async () => {
    const { createSession: createSessionFresh } = await import('../src/auth/session.js')
    const user = createTestUser({ email: 'store@example.com' })
    await insertUser(db, user)

    await createSessionFresh(db, user)

    const sessions = await db.query('SELECT * FROM vibekit_sessions WHERE user_id = $1', [user.id])
    expect(sessions.rows).toHaveLength(1)
  })

  it('verifies a valid session token and returns the user', async () => {
    const { createSession: createSessionFresh, verifySession: verifySessionFresh } = await import('../src/auth/session.js')
    const user = createTestUser({ email: 'verify@example.com' })
    await insertUser(db, user)

    const { token } = await createSessionFresh(db, user)
    const result = await verifySessionFresh(db, token)

    expect(result).not.toBeNull()
    expect(result!.user.id).toBe(user.id)
    expect(result!.user.email).toBe(user.email)
  })

  it('returns null for an invalid session token', async () => {
    const { verifySession: verifySessionFresh } = await import('../src/auth/session.js')
    const result = await verifySessionFresh(db, 'invalid-token-value')
    expect(result).toBeNull()
  })

  it('revokes sessions for a user', async () => {
    const { createSession: createSessionFresh, revokeAllSessions: revokeAllSessionsFresh } = await import('../src/auth/session.js')
    const user = createTestUser({ email: 'revoke@example.com' })
    await insertUser(db, user)

    await createSessionFresh(db, user)
    const sessionsBefore = await db.query('SELECT * FROM vibekit_sessions WHERE user_id = $1', [user.id])
    expect(sessionsBefore.rows).toHaveLength(1)

    await revokeAllSessionsFresh(db, user.id)
    const sessionsAfter = await db.query('SELECT * FROM vibekit_sessions WHERE user_id = $1', [user.id])
    expect(sessionsAfter.rows).toHaveLength(0)
  })

  it('stores IP address and user agent in session', async () => {
    const { createSession: createSessionFresh } = await import('../src/auth/session.js')
    const user = createTestUser({ email: 'ip@example.com' })
    await insertUser(db, user)

    await createSessionFresh(db, user, {
      ipAddress: '192.168.1.1',
      userAgent: 'TestAgent/1.0',
    })

    const session = await db.queryOne<{ ip_address: string; user_agent: string }>(
      'SELECT ip_address, user_agent FROM vibekit_sessions WHERE user_id = $1',
      [user.id],
    )
    expect(session?.ip_address).toBe('192.168.1.1')
    expect(session?.user_agent).toBe('TestAgent/1.0')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// User CRUD (direct database operations)
// ─────────────────────────────────────────────────────────────────────────────

describe('User CRUD (direct DB)', () => {
  let db: DatabaseAdapter

  beforeEach(async () => {
    db = createTestDb()
    await createAuthTables(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('inserts and retrieves a user', async () => {
    const user = createTestUser({ email: 'crud@example.com', name: 'Test User' })
    await insertUser(db, user)

    const found = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [user.id])
    expect(found).not.toBeNull()
    expect(found!.email).toBe('crud@example.com')
    expect(found!.name).toBe('Test User')
  })

  it('updates user fields', async () => {
    const user = createTestUser({ email: 'update@example.com' })
    await insertUser(db, user)

    await db.execute(
      'UPDATE vibekit_users SET name = $1, updated_at = $2 WHERE id = $3',
      ['Updated Name', new Date().toISOString(), user.id],
    )

    const updated = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [user.id])
    expect(updated!.name).toBe('Updated Name')
  })

  it('deletes a user', async () => {
    const user = createTestUser({ email: 'delete@example.com' })
    await insertUser(db, user)

    await db.execute('DELETE FROM vibekit_users WHERE id = $1', [user.id])

    const found = await db.queryOne('SELECT * FROM vibekit_users WHERE id = $1', [user.id])
    expect(found).toBeNull()
  })

  it('lists users with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      await insertUser(db, createTestUser({ email: `list${i}@example.com` }))
    }

    const page1 = await db.query<User>(
      'SELECT * FROM vibekit_users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [3, 0],
    )
    expect(page1.rows).toHaveLength(3)

    const page2 = await db.query<User>(
      'SELECT * FROM vibekit_users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [3, 3],
    )
    expect(page2.rows).toHaveLength(2)
  })

  it('bans and unbans a user', async () => {
    const user = createTestUser({ email: 'ban@example.com' })
    await insertUser(db, user)

    // Ban
    await db.execute(
      'UPDATE vibekit_users SET banned = 1, banned_reason = $1 WHERE id = $2',
      ['Spam', user.id],
    )
    const banned = await db.queryOne<any>('SELECT * FROM vibekit_users WHERE id = $1', [user.id])
    expect(banned.banned).toBe(1)
    expect(banned.banned_reason).toBe('Spam')

    // Unban
    await db.execute(
      'UPDATE vibekit_users SET banned = 0, banned_reason = NULL WHERE id = $1',
      [user.id],
    )
    const unbanned = await db.queryOne<any>('SELECT * FROM vibekit_users WHERE id = $1', [user.id])
    expect(unbanned.banned).toBe(0)
    expect(unbanned.banned_reason).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Role management (direct DB)
// ─────────────────────────────────────────────────────────────────────────────

describe('Role management (direct DB)', () => {
  let db: DatabaseAdapter

  beforeEach(async () => {
    db = createTestDb()
    await createAuthTables(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('sets user role', async () => {
    const user = createTestUser({ email: 'role@example.com', role: 'user' })
    await insertUser(db, user)

    await db.execute('UPDATE vibekit_users SET role = $1 WHERE id = $2', ['admin', user.id])

    const updated = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [user.id])
    expect(updated!.role).toBe('admin')
  })

  it('supports custom roles', async () => {
    const user = createTestUser({ email: 'custom@example.com', role: 'user' })
    await insertUser(db, user)

    await db.execute('UPDATE vibekit_users SET role = $1 WHERE id = $2', ['moderator', user.id])

    const updated = await db.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [user.id])
    expect(updated!.role).toBe('moderator')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Audit logging (direct DB)
// ─────────────────────────────────────────────────────────────────────────────

describe('Audit logging (direct DB)', () => {
  let db: DatabaseAdapter

  beforeEach(async () => {
    db = createTestDb()
    await createAuthTables(db)
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates an audit log entry', async () => {
    const id = crypto.randomUUID()
    await db.execute(
      `INSERT INTO vibekit_audit_log (id, user_id, action, metadata, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, 'user-1', 'login', JSON.stringify({ email: 'test@example.com' }), '127.0.0.1', 'TestAgent'],
    )

    const entry = await db.queryOne<any>('SELECT * FROM vibekit_audit_log WHERE id = $1', [id])
    expect(entry).not.toBeNull()
    expect(entry.action).toBe('login')
    expect(entry.user_id).toBe('user-1')
    expect(entry.ip_address).toBe('127.0.0.1')
    expect(JSON.parse(entry.metadata)).toEqual({ email: 'test@example.com' })
  })

  it('queries audit log by user', async () => {
    for (const action of ['login', 'logout', 'login']) {
      await db.execute(
        `INSERT INTO vibekit_audit_log (id, user_id, action) VALUES ($1, $2, $3)`,
        [crypto.randomUUID(), 'user-1', action],
      )
    }
    await db.execute(
      `INSERT INTO vibekit_audit_log (id, user_id, action) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), 'user-2', 'login'],
    )

    const result = await db.query<any>(
      'SELECT * FROM vibekit_audit_log WHERE user_id = $1',
      ['user-1'],
    )
    expect(result.rows).toHaveLength(3)
  })

  it('queries audit log by action', async () => {
    await db.execute(
      `INSERT INTO vibekit_audit_log (id, user_id, action) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), 'user-1', 'login'],
    )
    await db.execute(
      `INSERT INTO vibekit_audit_log (id, user_id, action) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), 'user-1', 'role_change'],
    )

    const logins = await db.query<any>(
      'SELECT * FROM vibekit_audit_log WHERE action = $1',
      ['login'],
    )
    expect(logins.rows).toHaveLength(1)
  })
})
