// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Auth — Passkeys (WebAuthn)
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import { createSession } from './session.js'
import type { User, AuthResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PasskeyChallenge {
  challenge: string
  rpId: string
  rpName: string
  timeout: number
  userId?: string
  userVerification: 'required' | 'preferred' | 'discouraged'
}

export interface PasskeyRegistrationChallenge extends PasskeyChallenge {
  user: {
    id: string
    name: string
    displayName: string
  }
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>
  authenticatorSelection: {
    authenticatorAttachment?: 'platform' | 'cross-platform'
    residentKey: 'required' | 'preferred' | 'discouraged'
    userVerification: 'required' | 'preferred' | 'discouraged'
  }
  excludeCredentials: Array<{ id: string; type: 'public-key' }>
}

export interface PasskeyCredential {
  id: string
  rawId: string
  type: 'public-key'
  response: {
    clientDataJSON: string
    attestationObject?: string
    authenticatorData?: string
    signature?: string
    userHandle?: string
  }
  authenticatorAttachment?: 'platform' | 'cross-platform'
}

export interface StoredPasskey {
  id: string
  credentialId: string
  userId: string
  publicKey: string
  counter: number
  deviceType: string
  backedUp: boolean
  friendlyName: string | null
  lastUsedAt: string | null
  createdAt: string
}

export interface PasskeyLoginResult {
  user: User
  token: string
  expiresAt: Date
  credentialId: string
}

// ── Table Setup ──────────────────────────────────────────────────────────────

const PASSKEY_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS _vibekit_passkeys (
  id TEXT PRIMARY KEY,
  credential_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES vibekit_users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL DEFAULT 0,
  device_type TEXT NOT NULL DEFAULT 'single_device',
  backed_up INTEGER NOT NULL DEFAULT 0,
  friendly_name TEXT,
  last_used_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_passkeys_user ON _vibekit_passkeys(user_id);
CREATE INDEX IF NOT EXISTS idx_passkeys_cred ON _vibekit_passkeys(credential_id);

CREATE TABLE IF NOT EXISTS _vibekit_passkey_challenges (
  id TEXT PRIMARY KEY,
  challenge TEXT NOT NULL UNIQUE,
  user_id TEXT,
  type TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`

let _passkeyInitialized = false

async function ensurePasskeyTables(): Promise<void> {
  await ensureAuthTables()
  if (_passkeyInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of PASSKEY_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _passkeyInitialized = true
}

// Defaults
const RP_ID = process.env.VIBEKIT_RP_ID ?? 'localhost'
const RP_NAME = process.env.VIBEKIT_RP_NAME ?? 'VibeKit App'
const CHALLENGE_TIMEOUT_MS = 5 * 60 * 1000

// ── Module ───────────────────────────────────────────────────────────────────

export const passkeys = {
  /**
   * Generate a WebAuthn registration challenge for the given user.
   * The returned object can be passed directly to `navigator.credentials.create()`.
   */
  async registerChallenge(userId: string): Promise<PasskeyRegistrationChallenge> {
    await ensurePasskeyTables()
    const adapter = db._getAdapter()

    const user = await adapter.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE id = $1',
      [userId],
    )
    if (!user) {
      throw new VibeKitError('User not found.', 'AUTH_USER_NOT_FOUND', 404)
    }

    const challenge = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + CHALLENGE_TIMEOUT_MS).toISOString()

    await adapter.execute(
      `INSERT INTO _vibekit_passkey_challenges (id, challenge, user_id, type, expires_at)
       VALUES ($1, $2, $3, 'registration', $4)`,
      [crypto.randomUUID(), challenge, userId, expiresAt],
    )

    // Get existing credentials to exclude
    const { rows: existingCreds } = await db.query<{ credential_id: string }>(
      'SELECT credential_id FROM _vibekit_passkeys WHERE user_id = $1',
      [userId],
    )

    return {
      challenge,
      rpId: RP_ID,
      rpName: RP_NAME,
      timeout: CHALLENGE_TIMEOUT_MS,
      userId,
      userVerification: 'preferred',
      user: {
        id: userId,
        name: user.email,
        displayName: user.name ?? user.email,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 },  // RS256
      ],
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      excludeCredentials: existingCreds.map(c => ({
        id: c.credential_id,
        type: 'public-key' as const,
      })),
    }
  },

  /**
   * Verify the registration response from the authenticator and store
   * the new passkey credential.
   */
  async verifyRegistration(
    userId: string,
    credential: PasskeyCredential,
    friendlyName?: string,
  ): Promise<StoredPasskey> {
    await ensurePasskeyTables()
    const adapter = db._getAdapter()

    // Verify challenge exists and is valid
    const clientData = JSON.parse(
      Buffer.from(credential.response.clientDataJSON, 'base64url').toString('utf-8'),
    )
    const challengeRow = await adapter.queryOne<{ id: string; user_id: string; used: number }>(
      `SELECT * FROM _vibekit_passkey_challenges
       WHERE challenge = $1 AND user_id = $2 AND type = 'registration' AND used = 0 AND expires_at > $3`,
      [clientData.challenge, userId, new Date().toISOString()],
    )
    if (!challengeRow) {
      throw new VibeKitError('Invalid or expired registration challenge.', 'AUTH_ERROR', 400)
    }

    // Mark challenge as used
    await adapter.execute(
      'UPDATE _vibekit_passkey_challenges SET used = 1 WHERE id = $1',
      [challengeRow.id],
    )

    // Check for duplicate credential
    const existing = await adapter.queryOne<{ id: string }>(
      'SELECT id FROM _vibekit_passkeys WHERE credential_id = $1',
      [credential.id],
    )
    if (existing) {
      throw new VibeKitError('Passkey credential already registered.', 'AUTH_ERROR', 409)
    }

    // Store the passkey
    const passkeyId = crypto.randomUUID()
    const publicKey = credential.response.attestationObject ?? ''
    const now = new Date().toISOString()
    const deviceType = credential.authenticatorAttachment === 'platform' ? 'platform' : 'cross_platform'

    await adapter.execute(
      `INSERT INTO _vibekit_passkeys (id, credential_id, user_id, public_key, counter, device_type, backed_up, friendly_name, created_at)
       VALUES ($1, $2, $3, $4, 0, $5, 0, $6, $7)`,
      [passkeyId, credential.id, userId, publicKey, deviceType, friendlyName ?? null, now],
    )

    await logAuditEvent('user_update', {
      userId,
      metadata: { action: 'passkey_registered', credentialId: credential.id },
    })

    return {
      id: passkeyId,
      credentialId: credential.id,
      userId,
      publicKey,
      counter: 0,
      deviceType,
      backedUp: false,
      friendlyName: friendlyName ?? null,
      lastUsedAt: null,
      createdAt: now,
    }
  },

  /**
   * Generate a WebAuthn authentication challenge. The returned object
   * can be passed to `navigator.credentials.get()`.
   */
  async loginChallenge(): Promise<PasskeyChallenge> {
    await ensurePasskeyTables()
    const adapter = db._getAdapter()

    const challenge = crypto.randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + CHALLENGE_TIMEOUT_MS).toISOString()

    await adapter.execute(
      `INSERT INTO _vibekit_passkey_challenges (id, challenge, type, expires_at)
       VALUES ($1, $2, 'authentication', $3)`,
      [crypto.randomUUID(), challenge, expiresAt],
    )

    return {
      challenge,
      rpId: RP_ID,
      rpName: RP_NAME,
      timeout: CHALLENGE_TIMEOUT_MS,
      userVerification: 'preferred',
    }
  },

  /**
   * Verify the authentication response from the authenticator.
   * Returns the matched user and a fresh session token.
   */
  async verifyLogin(credential: PasskeyCredential): Promise<PasskeyLoginResult> {
    await ensurePasskeyTables()
    const adapter = db._getAdapter()

    // Verify challenge
    const clientData = JSON.parse(
      Buffer.from(credential.response.clientDataJSON, 'base64url').toString('utf-8'),
    )
    const challengeRow = await adapter.queryOne<{ id: string }>(
      `SELECT * FROM _vibekit_passkey_challenges
       WHERE challenge = $1 AND type = 'authentication' AND used = 0 AND expires_at > $2`,
      [clientData.challenge, new Date().toISOString()],
    )
    if (!challengeRow) {
      throw new VibeKitError('Invalid or expired authentication challenge.', 'AUTH_ERROR', 401)
    }

    // Mark challenge as used
    await adapter.execute(
      'UPDATE _vibekit_passkey_challenges SET used = 1 WHERE id = $1',
      [challengeRow.id],
    )

    // Look up the credential
    const passkey = await adapter.queryOne<{ user_id: string; counter: number; id: string }>(
      'SELECT * FROM _vibekit_passkeys WHERE credential_id = $1',
      [credential.id],
    )
    if (!passkey) {
      throw new VibeKitError('Passkey not recognized.', 'AUTH_ERROR', 401)
    }

    // Update counter and last_used_at
    const now = new Date().toISOString()
    await adapter.execute(
      'UPDATE _vibekit_passkeys SET counter = counter + 1, last_used_at = $1 WHERE id = $2',
      [now, passkey.id],
    )

    // Get user
    const user = await adapter.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE id = $1',
      [passkey.user_id],
    )
    if (!user) {
      throw new VibeKitError('User associated with passkey not found.', 'AUTH_USER_NOT_FOUND', 404)
    }

    // Update login tracking
    await adapter.execute(
      `UPDATE vibekit_users SET last_login_at = $1, login_count = COALESCE(login_count, 0) + 1, updated_at = $1 WHERE id = $2`,
      [now, user.id],
    )

    await logAuditEvent('login', {
      userId: user.id,
      metadata: { method: 'passkey', credentialId: credential.id },
    })

    const session = await createSession(adapter, user)

    return {
      user: session.user,
      token: session.token,
      expiresAt: session.expiresAt,
      credentialId: credential.id,
    }
  },

  /**
   * List all passkeys registered for a user.
   */
  async list(userId: string): Promise<StoredPasskey[]> {
    await ensurePasskeyTables()
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM _vibekit_passkeys WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    )
    return rows.map(parsePasskeyRow)
  },

  /**
   * Remove a passkey by its credential ID.
   */
  async remove(userId: string, credentialId: string): Promise<void> {
    await ensurePasskeyTables()
    const result = await db.execute(
      'DELETE FROM _vibekit_passkeys WHERE user_id = $1 AND credential_id = $2',
      [userId, credentialId],
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new VibeKitError('Passkey not found for this user.', 'AUTH_ERROR', 404)
    }

    await logAuditEvent('user_update', {
      userId,
      metadata: { action: 'passkey_removed', credentialId },
    })
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parsePasskeyRow(row: Record<string, unknown>): StoredPasskey {
  return {
    id: row.id as string,
    credentialId: row.credential_id as string,
    userId: row.user_id as string,
    publicKey: row.public_key as string,
    counter: row.counter as number,
    deviceType: row.device_type as string,
    backedUp: row.backed_up === 1 || row.backed_up === true,
    friendlyName: (row.friendly_name as string) ?? null,
    lastUsedAt: (row.last_used_at as string) ?? null,
    createdAt: row.created_at as string,
  }
}
