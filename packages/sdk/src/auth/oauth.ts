import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { createSession } from './session.js'
import { VibeKitError } from '../utils/errors.js'
import { logAuditEvent, ensureAuthTables } from './internals.js'
import type {
  User,
  OAuthProvider,
  OAuthProviderConfig,
  OAuthGetAuthUrlOptions,
  OAuthCallbackOptions,
  OAuthCallbackResult,
  OAuthAccount,
  OAuthProviderEndpoints,
} from './types.js'

// ---------------------------------------------------------------------------
// SQL: OAuth tables
// ---------------------------------------------------------------------------

const OAUTH_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_oauth_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vibekit_users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  provider_email TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TEXT,
  scopes TEXT,
  profile_data TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_user_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user ON vibekit_oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_provider ON vibekit_oauth_accounts(provider, provider_user_id);
`

let _oauthInitialized = false

async function ensureOAuthTables(): Promise<void> {
  await ensureAuthTables()
  if (_oauthInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of OAUTH_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _oauthInitialized = true
}

// ---------------------------------------------------------------------------
// Provider endpoint registry
// ---------------------------------------------------------------------------

const PROVIDER_ENDPOINTS: Record<OAuthProvider, OAuthProviderEndpoints> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
    scopes: ['openid', 'email', 'profile'],
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    userInfoUrl: 'https://api.github.com/user',
    scopes: ['read:user', 'user:email'],
  },
  discord: {
    authorizeUrl: 'https://discord.com/api/oauth2/authorize',
    tokenUrl: 'https://discord.com/api/oauth2/token',
    userInfoUrl: 'https://discord.com/api/users/@me',
    scopes: ['identify', 'email'],
  },
  apple: {
    authorizeUrl: 'https://appleid.apple.com/auth/authorize',
    tokenUrl: 'https://appleid.apple.com/auth/token',
    userInfoUrl: '', // Apple returns user info in the ID token
    scopes: ['name', 'email'],
  },
  microsoft: {
    authorizeUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    userInfoUrl: 'https://graph.microsoft.com/v1.0/me',
    scopes: ['openid', 'email', 'profile', 'User.Read'],
  },
  twitter: {
    authorizeUrl: 'https://twitter.com/i/oauth2/authorize',
    tokenUrl: 'https://api.twitter.com/2/oauth2/token',
    userInfoUrl: 'https://api.twitter.com/2/users/me',
    scopes: ['tweet.read', 'users.read'],
  },
  facebook: {
    authorizeUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
    userInfoUrl: 'https://graph.facebook.com/v18.0/me?fields=id,name,email,picture',
    scopes: ['email', 'public_profile'],
  },
  linkedin: {
    authorizeUrl: 'https://www.linkedin.com/oauth/v2/authorization',
    tokenUrl: 'https://www.linkedin.com/oauth/v2/accessToken',
    userInfoUrl: 'https://api.linkedin.com/v2/userinfo',
    scopes: ['openid', 'profile', 'email'],
  },
  slack: {
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    userInfoUrl: 'https://slack.com/api/users.identity',
    scopes: ['identity.basic', 'identity.email', 'identity.avatar'],
  },
  spotify: {
    authorizeUrl: 'https://accounts.spotify.com/authorize',
    tokenUrl: 'https://accounts.spotify.com/api/token',
    userInfoUrl: 'https://api.spotify.com/v1/me',
    scopes: ['user-read-email', 'user-read-private'],
  },
}

// ---------------------------------------------------------------------------
// Provider config store (set via auth.oauth.configure)
// ---------------------------------------------------------------------------

const _providerConfigs = new Map<OAuthProvider, OAuthProviderConfig>()

// ---------------------------------------------------------------------------
// Helper: extract user profile from provider-specific response
// ---------------------------------------------------------------------------

interface NormalizedProfile {
  id: string
  email: string | null
  name: string | null
  avatarUrl: string | null
  rawData: Record<string, unknown>
}

function normalizeProfile(provider: OAuthProvider, data: Record<string, unknown>): NormalizedProfile {
  switch (provider) {
    case 'google':
      return {
        id: String(data.id),
        email: (data.email as string) || null,
        name: (data.name as string) || null,
        avatarUrl: (data.picture as string) || null,
        rawData: data,
      }
    case 'github': {
      return {
        id: String(data.id),
        email: (data.email as string) || null,
        name: (data.name as string) || (data.login as string) || null,
        avatarUrl: (data.avatar_url as string) || null,
        rawData: data,
      }
    }
    case 'discord': {
      const avatarHash = data.avatar as string | null
      const discordId = String(data.id)
      const avatarUrl = avatarHash
        ? `https://cdn.discordapp.com/avatars/${discordId}/${avatarHash}.png`
        : null
      return {
        id: discordId,
        email: (data.email as string) || null,
        name: (data.username as string) || null,
        avatarUrl,
        rawData: data,
      }
    }
    case 'apple':
      return {
        id: String(data.sub || data.id),
        email: (data.email as string) || null,
        name: (data.name as string) || null,
        avatarUrl: null,
        rawData: data,
      }
    case 'microsoft':
      return {
        id: String(data.id),
        email: (data.mail as string) || (data.userPrincipalName as string) || null,
        name: (data.displayName as string) || null,
        avatarUrl: null,
        rawData: data,
      }
    case 'twitter':
      return {
        id: String((data.data as Record<string, unknown>)?.id || data.id),
        email: null, // Twitter v2 doesn't return email by default
        name: String((data.data as Record<string, unknown>)?.name || data.name || ''),
        avatarUrl: String((data.data as Record<string, unknown>)?.profile_image_url || '') || null,
        rawData: data,
      }
    case 'facebook':
      return {
        id: String(data.id),
        email: (data.email as string) || null,
        name: (data.name as string) || null,
        avatarUrl: ((data.picture as Record<string, unknown>)?.data as Record<string, unknown>)?.url as string || null,
        rawData: data,
      }
    case 'linkedin':
      return {
        id: String(data.sub || data.id),
        email: (data.email as string) || null,
        name: (data.name as string) || null,
        avatarUrl: (data.picture as string) || null,
        rawData: data,
      }
    case 'slack': {
      const slackUser = (data.user as Record<string, unknown>) || data
      return {
        id: String(slackUser.id || data.id),
        email: (slackUser.email as string) || null,
        name: (slackUser.name as string) || null,
        avatarUrl: (slackUser.image_72 as string) || null,
        rawData: data,
      }
    }
    case 'spotify':
      return {
        id: String(data.id),
        email: (data.email as string) || null,
        name: (data.display_name as string) || null,
        avatarUrl: ((data.images as Array<Record<string, unknown>>)?.[0]?.url as string) || null,
        rawData: data,
      }
    default:
      return {
        id: String(data.id || data.sub),
        email: (data.email as string) || null,
        name: (data.name as string) || null,
        avatarUrl: null,
        rawData: data,
      }
  }
}

// ---------------------------------------------------------------------------
// OAuth module
// ---------------------------------------------------------------------------

export const oauth = {
  /**
   * Configure an OAuth provider with client credentials.
   */
  configure(provider: OAuthProvider, config: OAuthProviderConfig): void {
    _providerConfigs.set(provider, config)
  },

  /**
   * Configure multiple OAuth providers at once.
   */
  configureAll(configs: Partial<Record<OAuthProvider, OAuthProviderConfig>>): void {
    for (const [provider, config] of Object.entries(configs)) {
      if (config) {
        _providerConfigs.set(provider as OAuthProvider, config)
      }
    }
  },

  /**
   * Generate an OAuth authorization URL for the given provider.
   */
  getAuthUrl(
    provider: OAuthProvider,
    options: OAuthGetAuthUrlOptions,
  ): string {
    const config = _providerConfigs.get(provider)
    if (!config) {
      throw new VibeKitError(
        `OAuth provider "${provider}" is not configured. Call auth.oauth.configure() first.`,
        'AUTH_ERROR',
        400,
      )
    }

    const endpoints = PROVIDER_ENDPOINTS[provider]
    if (!endpoints) {
      throw new VibeKitError(
        `Unknown OAuth provider: "${provider}".`,
        'AUTH_ERROR',
        400,
      )
    }

    const state = options.state || crypto.randomUUID()
    const scopes = options.scopes || config.scopes || endpoints.scopes

    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: options.redirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      state,
    })

    // Provider-specific params
    if (provider === 'google') {
      params.set('access_type', 'offline')
      params.set('prompt', 'consent')
    }
    if (provider === 'discord') {
      params.set('prompt', 'consent')
    }
    if (provider === 'twitter') {
      params.set('code_challenge', 'challenge')
      params.set('code_challenge_method', 'plain')
    }
    if (provider === 'apple') {
      params.set('response_mode', 'form_post')
    }

    return `${endpoints.authorizeUrl}?${params.toString()}`
  },

  /**
   * Handle the OAuth callback: exchange the authorization code for tokens,
   * fetch user profile, create or link the user, and return a session.
   */
  async handleCallback(
    provider: OAuthProvider,
    options: OAuthCallbackOptions,
  ): Promise<OAuthCallbackResult> {
    await ensureOAuthTables()

    const config = _providerConfigs.get(provider)
    if (!config) {
      throw new VibeKitError(
        `OAuth provider "${provider}" is not configured.`,
        'AUTH_ERROR',
        400,
      )
    }

    const endpoints = PROVIDER_ENDPOINTS[provider]

    // 1. Exchange code for tokens
    const tokenBody: Record<string, string> = {
      grant_type: 'authorization_code',
      code: options.code,
      redirect_uri: options.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }

    const tokenHeaders: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    }

    // Spotify and some others use basic auth
    if (provider === 'spotify' || provider === 'slack') {
      const basicAuth = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
      tokenHeaders['Authorization'] = `Basic ${basicAuth}`
      delete tokenBody.client_id
      delete tokenBody.client_secret
    }

    const tokenResponse = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: tokenHeaders,
      body: new URLSearchParams(tokenBody).toString(),
    })

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text()
      throw new VibeKitError(
        `OAuth token exchange failed for "${provider}": ${errorBody}`,
        'AUTH_ERROR',
        502,
      )
    }

    const tokenData = await tokenResponse.json() as Record<string, unknown>
    const accessToken = (tokenData.access_token as string) || ''
    const refreshToken = (tokenData.refresh_token as string) || null
    const expiresIn = (tokenData.expires_in as number) || null
    const tokenExpiresAt = expiresIn
      ? new Date(Date.now() + expiresIn * 1000).toISOString()
      : null

    // 2. Fetch user profile
    let profile: NormalizedProfile

    if (provider === 'apple') {
      // Apple sends user info in the ID token (JWT), decode it
      const idToken = tokenData.id_token as string
      if (idToken) {
        const payloadB64 = idToken.split('.')[1]
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
        profile = normalizeProfile(provider, payload)
      } else {
        throw new VibeKitError('Apple OAuth did not return an ID token.', 'AUTH_ERROR', 502)
      }
    } else {
      const userInfoResponse = await fetch(endpoints.userInfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })

      if (!userInfoResponse.ok) {
        throw new VibeKitError(
          `Failed to fetch user info from "${provider}".`,
          'AUTH_ERROR',
          502,
        )
      }

      const userInfoData = await userInfoResponse.json() as Record<string, unknown>

      // For GitHub, fetch email separately if not in profile
      if (provider === 'github' && !userInfoData.email) {
        try {
          const emailsResponse = await fetch('https://api.github.com/user/emails', {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          })
          if (emailsResponse.ok) {
            const emails = await emailsResponse.json() as Array<{ email: string; primary: boolean; verified: boolean }>
            const primary = emails.find(e => e.primary && e.verified)
            if (primary) {
              userInfoData.email = primary.email
            }
          }
        } catch {
          // Ignore email fetch failure
        }
      }

      profile = normalizeProfile(provider, userInfoData)
    }

    const adapter = db._getAdapter()

    // 3. Check if this OAuth account is already linked
    const existingOAuth = await adapter.queryOne<OAuthAccount>(
      'SELECT * FROM vibekit_oauth_accounts WHERE provider = $1 AND provider_user_id = $2',
      [provider, profile.id],
    )

    let user: User | null = null
    let isNewUser = false

    if (existingOAuth) {
      // Update tokens
      const now = new Date().toISOString()
      await adapter.execute(
        `UPDATE vibekit_oauth_accounts
         SET access_token = $1, refresh_token = $2, token_expires_at = $3,
             profile_data = $4, updated_at = $5
         WHERE id = $6`,
        [accessToken, refreshToken, tokenExpiresAt, JSON.stringify(profile.rawData), now, existingOAuth.id],
      )

      user = await adapter.queryOne<User>(
        'SELECT * FROM vibekit_users WHERE id = $1',
        [existingOAuth.user_id],
      )
    }

    if (!user && profile.email) {
      // Check if a user with this email already exists
      user = await adapter.queryOne<User>(
        'SELECT * FROM vibekit_users WHERE email = $1',
        [profile.email.toLowerCase()],
      )

      if (user) {
        // Link existing user to this OAuth provider
        await adapter.execute(
          `INSERT INTO vibekit_oauth_accounts
           (id, user_id, provider, provider_user_id, provider_email, access_token, refresh_token, token_expires_at, scopes, profile_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            crypto.randomUUID(),
            user.id,
            provider,
            profile.id,
            profile.email,
            accessToken,
            refreshToken,
            tokenExpiresAt,
            (config.scopes || PROVIDER_ENDPOINTS[provider].scopes).join(','),
            JSON.stringify(profile.rawData),
          ],
        )
      }
    }

    if (!user) {
      // Create a new user
      isNewUser = true
      const userId = crypto.randomUUID()
      const now = new Date().toISOString()

      await adapter.execute(
        `INSERT INTO vibekit_users (id, email, name, avatar_url, email_verified, last_login_at, login_count)
         VALUES ($1, $2, $3, $4, 1, $5, 1)`,
        [
          userId,
          (profile.email || `${provider}_${profile.id}@oauth.vibekit.dev`).toLowerCase(),
          profile.name,
          profile.avatarUrl,
          now,
        ],
      )

      user = await adapter.queryOne<User>(
        'SELECT * FROM vibekit_users WHERE id = $1',
        [userId],
      )

      if (!user) {
        throw new VibeKitError('Failed to create user via OAuth.', 'AUTH_ERROR', 500)
      }

      // Link OAuth account
      await adapter.execute(
        `INSERT INTO vibekit_oauth_accounts
         (id, user_id, provider, provider_user_id, provider_email, access_token, refresh_token, token_expires_at, scopes, profile_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          crypto.randomUUID(),
          user.id,
          provider,
          profile.id,
          profile.email,
          accessToken,
          refreshToken,
          tokenExpiresAt,
          (config.scopes || PROVIDER_ENDPOINTS[provider].scopes).join(','),
          JSON.stringify(profile.rawData),
        ],
      )

      await logAuditEvent('signup', {
        userId: user.id,
        metadata: { provider, providerUserId: profile.id },
      })
    }

    // Update login tracking
    const now = new Date().toISOString()
    await adapter.execute(
      `UPDATE vibekit_users
       SET last_login_at = $1,
           login_count = COALESCE(login_count, 0) + 1,
           updated_at = $1
       WHERE id = $2`,
      [now, user!.id],
    )

    await logAuditEvent('login', {
      userId: user!.id,
      metadata: { provider, providerUserId: profile.id, method: 'oauth' },
    })

    const session = await createSession(adapter, user!)

    return {
      user: user!,
      token: session.token,
      expiresAt: session.expiresAt,
      isNewUser,
      provider,
      providerUserId: profile.id,
    }
  },

  /**
   * Get all connected OAuth accounts for a user.
   */
  async getConnectedAccounts(userId: string): Promise<OAuthAccount[]> {
    await ensureOAuthTables()
    const { rows } = await db.query<OAuthAccount>(
      'SELECT * FROM vibekit_oauth_accounts WHERE user_id = $1 ORDER BY created_at ASC',
      [userId],
    )
    // Strip sensitive tokens from response
    return rows.map(row => ({
      ...row,
      access_token: '***',
      refresh_token: row.refresh_token ? '***' : null,
    }))
  },

  /**
   * Unlink an OAuth provider from a user's account.
   */
  async unlinkAccount(userId: string, provider: OAuthProvider): Promise<void> {
    await ensureOAuthTables()
    const adapter = db._getAdapter()

    // Ensure the user has at least one other auth method or OAuth connection
    const { rows } = await adapter.query<OAuthAccount>(
      'SELECT * FROM vibekit_oauth_accounts WHERE user_id = $1',
      [userId],
    )

    if (rows.length <= 1) {
      // Check if user has a password set
      const pwRow = await adapter.queryOne<{ id: string }>(
        'SELECT id FROM vibekit_user_passwords WHERE user_id = $1',
        [userId],
      ).catch(() => null)

      if (!pwRow) {
        throw new VibeKitError(
          'Cannot unlink the only authentication method. Add another login method first.',
          'AUTH_ERROR',
          400,
        )
      }
    }

    const result = await adapter.execute(
      'DELETE FROM vibekit_oauth_accounts WHERE user_id = $1 AND provider = $2',
      [userId, provider],
    )

    if (result.rowCount === 0) {
      throw new VibeKitError(
        `OAuth account for "${provider}" not found on this user.`,
        'AUTH_ERROR',
        404,
      )
    }

    await logAuditEvent('user_update', {
      userId,
      metadata: { action: 'oauth_unlink', provider },
    })
  },

  /**
   * Get the endpoints for a given OAuth provider.
   */
  getProviderEndpoints(provider: OAuthProvider): OAuthProviderEndpoints {
    const endpoints = PROVIDER_ENDPOINTS[provider]
    if (!endpoints) {
      throw new VibeKitError(`Unknown OAuth provider: "${provider}".`, 'AUTH_ERROR', 400)
    }
    return endpoints
  },

  /**
   * Check if a provider is configured.
   */
  isConfigured(provider: OAuthProvider): boolean {
    return _providerConfigs.has(provider)
  },

  /**
   * List all configured providers.
   */
  getConfiguredProviders(): OAuthProvider[] {
    return Array.from(_providerConfigs.keys())
  },
}
