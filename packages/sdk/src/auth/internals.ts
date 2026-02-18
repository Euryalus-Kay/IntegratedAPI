import crypto from 'node:crypto'
import { db } from '../db/client.js'

let _authTablesInitialized = false

const AUTH_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  avatar_url TEXT,
  role TEXT DEFAULT 'user',
  email_verified INTEGER DEFAULT 0,
  phone TEXT,
  phone_verified INTEGER DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  banned INTEGER DEFAULT 0,
  ban_reason TEXT,
  last_login_at TEXT,
  login_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
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
CREATE INDEX IF NOT EXISTS idx_sessions_token ON vibekit_sessions(token_hash);
CREATE TABLE IF NOT EXISTS vibekit_auth_codes (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vibekit_audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  user_id TEXT,
  ip_address TEXT,
  user_agent TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON vibekit_audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON vibekit_audit_log(action);
`

export async function ensureAuthTables(): Promise<void> {
  if (_authTablesInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of AUTH_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _authTablesInitialized = true
}

export async function logAuditEvent(
  action: string,
  details: { userId?: string; ip?: string; userAgent?: string; metadata?: Record<string, unknown> }
): Promise<void> {
  const id = crypto.randomUUID()
  const adapter = db._getAdapter()
  await adapter.execute(
    `INSERT INTO vibekit_audit_log (id, action, user_id, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, action, details.userId || null, details.ip || null, details.userAgent || null, JSON.stringify(details.metadata || {})]
  )
}
