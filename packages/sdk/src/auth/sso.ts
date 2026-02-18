// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Auth — SSO / SAML Provider
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import { createSession } from './session.js'
import type { User, AuthResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type SSOProviderType = 'okta' | 'azure_ad' | 'google_workspace' | 'custom'

export interface SSOProviderConfig {
  entityId: string
  ssoUrl: string
  certificate: string
  attributeMapping: SSOAttributeMapping
  defaultRole?: string
  allowedDomains?: string[]
  metadata?: Record<string, unknown>
}

export interface SSOAttributeMapping {
  email: string
  name?: string
  firstName?: string
  lastName?: string
  avatar?: string
  role?: string
  groups?: string
}

export interface SSOProvider {
  id: string
  type: SSOProviderType
  entityId: string
  ssoUrl: string
  certificate: string
  attributeMapping: SSOAttributeMapping
  defaultRole: string
  allowedDomains: string[]
  metadata: Record<string, unknown>
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface SSOInitiateOptions {
  relayState?: string
  forceAuthn?: boolean
  returnUrl?: string
}

export interface SSOInitiateResult {
  redirectUrl: string
  requestId: string
}

export interface SAMLResponse {
  SAMLResponse: string
  RelayState?: string
}

export interface SAMLAssertion {
  issuer: string
  nameId: string
  attributes: Record<string, string>
  conditions?: {
    notBefore?: string
    notOnOrAfter?: string
  }
  sessionIndex?: string
}

export interface SSOCallbackResult {
  user: User
  token: string
  expiresAt: Date
  isNewUser: boolean
  provider: string
  relayState?: string
}

export interface SAMLValidationResult {
  valid: boolean
  assertion: SAMLAssertion | null
  error?: string
}

// ── Table Setup ──────────────────────────────────────────────────────────────

const SSO_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS _vibekit_sso_providers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  entity_id TEXT NOT NULL UNIQUE,
  sso_url TEXT NOT NULL,
  certificate TEXT NOT NULL,
  attribute_mapping TEXT NOT NULL DEFAULT '{}',
  default_role TEXT NOT NULL DEFAULT 'user',
  allowed_domains TEXT NOT NULL DEFAULT '[]',
  metadata TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sso_providers_type ON _vibekit_sso_providers(type);
CREATE INDEX IF NOT EXISTS idx_sso_providers_entity ON _vibekit_sso_providers(entity_id);

CREATE TABLE IF NOT EXISTS _vibekit_sso_requests (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  relay_state TEXT,
  return_url TEXT,
  expires_at TEXT NOT NULL,
  used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`

let _ssoInitialized = false

async function ensureSSOTables(): Promise<void> {
  await ensureAuthTables()
  if (_ssoInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of SSO_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _ssoInitialized = true
}

// ── Module ───────────────────────────────────────────────────────────────────

export const sso = {
  /**
   * Configure a new SSO/SAML identity provider.
   */
  async configure(
    type: SSOProviderType,
    config: SSOProviderConfig,
  ): Promise<SSOProvider> {
    await ensureSSOTables()
    const adapter = db._getAdapter()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await adapter.execute(
      `INSERT INTO _vibekit_sso_providers
       (id, type, entity_id, sso_url, certificate, attribute_mapping, default_role, allowed_domains, metadata, enabled, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, $10, $10)`,
      [
        id,
        type,
        config.entityId,
        config.ssoUrl,
        config.certificate,
        JSON.stringify(config.attributeMapping),
        config.defaultRole ?? 'user',
        JSON.stringify(config.allowedDomains ?? []),
        JSON.stringify(config.metadata ?? {}),
        now,
      ],
    )

    await logAuditEvent('user_update', {
      metadata: { action: 'sso_provider_configured', type, entityId: config.entityId },
    })

    return {
      id,
      type,
      entityId: config.entityId,
      ssoUrl: config.ssoUrl,
      certificate: config.certificate,
      attributeMapping: config.attributeMapping,
      defaultRole: config.defaultRole ?? 'user',
      allowedDomains: config.allowedDomains ?? [],
      metadata: config.metadata ?? {},
      enabled: true,
      createdAt: now,
      updatedAt: now,
    }
  },

  /**
   * List all configured SSO providers.
   */
  async getProviders(): Promise<SSOProvider[]> {
    await ensureSSOTables()
    const { rows } = await db.query<Record<string, unknown>>(
      'SELECT * FROM _vibekit_sso_providers ORDER BY created_at DESC',
    )
    return rows.map(parseProviderRow)
  },

  /**
   * Start an SSO login flow for the given provider. Returns a redirect URL
   * that the application should send the user to.
   */
  async initiateLogin(
    providerId: string,
    options?: SSOInitiateOptions,
  ): Promise<SSOInitiateResult> {
    await ensureSSOTables()
    const adapter = db._getAdapter()

    const row = await adapter.queryOne<Record<string, unknown>>(
      'SELECT * FROM _vibekit_sso_providers WHERE id = $1 AND enabled = 1',
      [providerId],
    )
    if (!row) {
      throw new VibeKitError('SSO provider not found or disabled.', 'AUTH_ERROR', 404)
    }
    const provider = parseProviderRow(row)

    const requestId = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()

    await adapter.execute(
      `INSERT INTO _vibekit_sso_requests (id, provider_id, relay_state, return_url, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [requestId, providerId, options?.relayState ?? null, options?.returnUrl ?? null, expiresAt],
    )

    // Build SAML AuthnRequest redirect URL
    const params = new URLSearchParams()
    params.set('SAMLRequest', buildAuthnRequest(provider.entityId, requestId))
    if (options?.relayState) {
      params.set('RelayState', options.relayState)
    }

    const separator = provider.ssoUrl.includes('?') ? '&' : '?'
    const redirectUrl = `${provider.ssoUrl}${separator}${params.toString()}`

    return { redirectUrl, requestId }
  },

  /**
   * Process the SAML callback response from the identity provider.
   * Creates or updates the user and returns a session.
   */
  async handleCallback(
    providerId: string,
    samlResponse: SAMLResponse,
  ): Promise<SSOCallbackResult> {
    await ensureSSOTables()
    const adapter = db._getAdapter()

    const providerRow = await adapter.queryOne<Record<string, unknown>>(
      'SELECT * FROM _vibekit_sso_providers WHERE id = $1 AND enabled = 1',
      [providerId],
    )
    if (!providerRow) {
      throw new VibeKitError('SSO provider not found or disabled.', 'AUTH_ERROR', 404)
    }
    const provider = parseProviderRow(providerRow)

    // Parse and validate the SAML assertion
    const assertion = decodeSamlResponse(samlResponse.SAMLResponse)
    const validation = validateAssertionData(assertion, provider)
    if (!validation.valid) {
      throw new VibeKitError(
        `SAML assertion validation failed: ${validation.error}`,
        'AUTH_ERROR',
        401,
      )
    }

    // Extract user attributes
    const mapping = provider.attributeMapping
    const email = (assertion.attributes[mapping.email] ?? assertion.nameId).toLowerCase().trim()
    if (!email) {
      throw new VibeKitError('SAML assertion missing email attribute.', 'AUTH_ERROR', 400)
    }

    // Domain restriction check
    if (provider.allowedDomains.length > 0) {
      const domain = email.split('@')[1]
      if (!provider.allowedDomains.includes(domain)) {
        throw new VibeKitError(
          `Email domain "${domain}" is not allowed for this SSO provider.`,
          'AUTH_ERROR',
          403,
        )
      }
    }

    // Find or create user
    let isNewUser = false
    let user = await adapter.queryOne<User>(
      'SELECT * FROM vibekit_users WHERE email = $1',
      [email],
    )

    const now = new Date().toISOString()

    if (!user) {
      isNewUser = true
      const userId = crypto.randomUUID()
      const name = extractName(assertion.attributes, mapping)
      const role = assertion.attributes[mapping.role ?? ''] ?? provider.defaultRole

      await adapter.execute(
        `INSERT INTO vibekit_users (id, email, name, role, email_verified, last_login_at, login_count, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 1, $5, 1, $6, $5, $5)`,
        [
          userId,
          email,
          name,
          role,
          now,
          JSON.stringify({ sso_provider: providerId, sso_type: provider.type }),
        ],
      )

      user = await adapter.queryOne<User>('SELECT * FROM vibekit_users WHERE id = $1', [userId])
      if (!user) {
        throw new VibeKitError('Failed to create SSO user.', 'AUTH_ERROR', 500)
      }

      await logAuditEvent('signup', {
        userId,
        metadata: { sso: true, provider: providerId, type: provider.type },
      })
    } else {
      // Update login tracking
      await adapter.execute(
        `UPDATE vibekit_users
         SET email_verified = 1, last_login_at = $1, login_count = COALESCE(login_count, 0) + 1, updated_at = $1
         WHERE id = $2`,
        [now, user.id],
      )

      await logAuditEvent('login', {
        userId: user.id,
        metadata: { sso: true, provider: providerId },
      })
    }

    const session = await createSession(adapter, user)

    return {
      user: session.user,
      token: session.token,
      expiresAt: session.expiresAt,
      isNewUser,
      provider: providerId,
      relayState: samlResponse.RelayState,
    }
  },

  /**
   * Remove an SSO provider configuration.
   */
  async removeProvider(providerId: string): Promise<void> {
    await ensureSSOTables()
    const adapter = db._getAdapter()

    const result = await adapter.execute(
      'DELETE FROM _vibekit_sso_providers WHERE id = $1',
      [providerId],
    )
    if ((result.rowCount ?? 0) === 0) {
      throw new VibeKitError('SSO provider not found.', 'AUTH_ERROR', 404)
    }

    // Clean up pending requests
    await adapter.execute(
      'DELETE FROM _vibekit_sso_requests WHERE provider_id = $1',
      [providerId],
    )

    await logAuditEvent('user_update', {
      metadata: { action: 'sso_provider_removed', providerId },
    })
  },

  /**
   * Validate a raw SAML assertion string and return the parsed assertion
   * along with a validity flag.
   */
  async validateAssertion(assertionB64: string): Promise<SAMLValidationResult> {
    await ensureSSOTables()
    try {
      const assertion = decodeSamlResponse(assertionB64)
      // Check temporal validity
      if (assertion.conditions?.notOnOrAfter) {
        const notAfter = new Date(assertion.conditions.notOnOrAfter)
        if (notAfter < new Date()) {
          return { valid: false, assertion, error: 'Assertion has expired (NotOnOrAfter).' }
        }
      }
      if (assertion.conditions?.notBefore) {
        const notBefore = new Date(assertion.conditions.notBefore)
        if (notBefore > new Date()) {
          return { valid: false, assertion, error: 'Assertion is not yet valid (NotBefore).' }
        }
      }
      return { valid: true, assertion }
    } catch (err) {
      return {
        valid: false,
        assertion: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseProviderRow(row: Record<string, unknown>): SSOProvider {
  return {
    id: row.id as string,
    type: row.type as SSOProviderType,
    entityId: row.entity_id as string,
    ssoUrl: row.sso_url as string,
    certificate: row.certificate as string,
    attributeMapping: typeof row.attribute_mapping === 'string'
      ? JSON.parse(row.attribute_mapping)
      : (row.attribute_mapping as SSOAttributeMapping),
    defaultRole: (row.default_role as string) ?? 'user',
    allowedDomains: typeof row.allowed_domains === 'string'
      ? JSON.parse(row.allowed_domains)
      : (row.allowed_domains as string[]) ?? [],
    metadata: typeof row.metadata === 'string'
      ? JSON.parse(row.metadata)
      : (row.metadata as Record<string, unknown>) ?? {},
    enabled: row.enabled === 1 || row.enabled === true,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function buildAuthnRequest(entityId: string, requestId: string): string {
  const issueInstant = new Date().toISOString()
  const xml = [
    '<samlp:AuthnRequest',
    '  xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
    '  xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
    `  ID="_${requestId}"`,
    '  Version="2.0"',
    `  IssueInstant="${issueInstant}"`,
    '  ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
    `  AssertionConsumerServiceURL="${entityId}/saml/callback">`,
    `  <saml:Issuer>${entityId}</saml:Issuer>`,
    '  <samlp:NameIDPolicy Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress" AllowCreate="true"/>',
    '</samlp:AuthnRequest>',
  ].join('\n')

  return Buffer.from(xml, 'utf-8').toString('base64')
}

function decodeSamlResponse(base64Response: string): SAMLAssertion {
  const xml = Buffer.from(base64Response, 'base64').toString('utf-8')

  // Lightweight XML attribute extraction — production deployments should use
  // a full SAML library like `saml2-js` or `passport-saml`.
  const nameIdMatch = xml.match(/<(?:saml:)?NameID[^>]*>([^<]+)</)
  const issuerMatch = xml.match(/<(?:saml:)?Issuer[^>]*>([^<]+)</)
  const notBeforeMatch = xml.match(/NotBefore="([^"]+)"/)
  const notOnOrAfterMatch = xml.match(/NotOnOrAfter="([^"]+)"/)
  const sessionIndexMatch = xml.match(/SessionIndex="([^"]+)"/)

  const attributes: Record<string, string> = {}
  const attrRegex = /<(?:saml:)?Attribute\s+Name="([^"]+)"[^>]*>\s*<(?:saml:)?AttributeValue[^>]*>([^<]*)</g
  let attrMatch: RegExpExecArray | null
  while ((attrMatch = attrRegex.exec(xml)) !== null) {
    attributes[attrMatch[1]] = attrMatch[2]
  }

  return {
    issuer: issuerMatch?.[1] ?? '',
    nameId: nameIdMatch?.[1] ?? '',
    attributes,
    conditions: {
      notBefore: notBeforeMatch?.[1],
      notOnOrAfter: notOnOrAfterMatch?.[1],
    },
    sessionIndex: sessionIndexMatch?.[1],
  }
}

function validateAssertionData(
  assertion: SAMLAssertion,
  provider: SSOProvider,
): { valid: boolean; error?: string } {
  if (!assertion.nameId && !Object.keys(assertion.attributes).length) {
    return { valid: false, error: 'Empty assertion: no NameID or attributes found.' }
  }
  if (assertion.conditions?.notOnOrAfter) {
    if (new Date(assertion.conditions.notOnOrAfter) < new Date()) {
      return { valid: false, error: 'SAML assertion has expired.' }
    }
  }
  if (assertion.conditions?.notBefore) {
    if (new Date(assertion.conditions.notBefore) > new Date()) {
      return { valid: false, error: 'SAML assertion is not yet valid.' }
    }
  }
  return { valid: true }
}

function extractName(
  attributes: Record<string, string>,
  mapping: SSOAttributeMapping,
): string | null {
  if (mapping.name && attributes[mapping.name]) {
    return attributes[mapping.name]
  }
  const first = mapping.firstName ? attributes[mapping.firstName] : undefined
  const last = mapping.lastName ? attributes[mapping.lastName] : undefined
  if (first || last) {
    return [first, last].filter(Boolean).join(' ')
  }
  return null
}
