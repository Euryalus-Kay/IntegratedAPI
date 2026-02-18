// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Auth — CAPTCHA Verification
// ──────────────────────────────────────────────────────────────────────────────

import { VibeKitError } from '../utils/errors.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type CaptchaProvider = 'hcaptcha' | 'recaptcha' | 'turnstile'

export interface CaptchaConfig {
  siteKey: string
  secretKey: string
  scoreThreshold?: number
  action?: string
}

export interface CaptchaProviderInfo {
  provider: CaptchaProvider
  siteKey: string
  enabled: boolean
}

export interface CaptchaVerifyResult {
  success: boolean
  score?: number
  action?: string
  hostname?: string
  errorCodes?: string[]
  challengeTimestamp?: string
}

// ── Verification endpoints per provider ──────────────────────────────────────

const VERIFY_URLS: Record<CaptchaProvider, string> = {
  hcaptcha: 'https://hcaptcha.com/siteverify',
  recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
  turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
}

// ── State ────────────────────────────────────────────────────────────────────

let _provider: CaptchaProvider | null = null
let _config: CaptchaConfig | null = null

// ── Module ───────────────────────────────────────────────────────────────────

export const captcha = {
  /**
   * Configure the CAPTCHA provider and credentials. Call this once
   * during application startup.
   */
  configure(provider: CaptchaProvider, config: CaptchaConfig): void {
    if (!config.siteKey || !config.secretKey) {
      throw new VibeKitError(
        'CAPTCHA configuration requires both siteKey and secretKey.',
        'VALIDATION_FAILED',
        400,
      )
    }
    _provider = provider
    _config = { ...config }
  },

  /**
   * Verify a CAPTCHA token server-side by calling the provider's
   * verification endpoint.
   */
  async verify(token: string, remoteIp?: string): Promise<CaptchaVerifyResult> {
    if (!_provider || !_config) {
      throw new VibeKitError(
        'CAPTCHA is not configured. Call captcha.configure() first.',
        'CONFIG_INVALID',
        500,
      )
    }

    if (!token) {
      return { success: false, errorCodes: ['missing-input-response'] }
    }

    const url = VERIFY_URLS[_provider]
    const params = new URLSearchParams()

    // All three providers use "secret" + "response" fields
    params.set('secret', _config.secretKey)
    params.set('response', token)
    if (remoteIp) {
      params.set('remoteip', remoteIp)
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })

    if (!res.ok) {
      throw new VibeKitError(
        `CAPTCHA verification request failed with status ${res.status}.`,
        'NETWORK_REQUEST_FAILED',
        502,
      )
    }

    const data = await res.json() as Record<string, unknown>

    const result: CaptchaVerifyResult = {
      success: data.success === true,
      score: typeof data.score === 'number' ? data.score : undefined,
      action: typeof data.action === 'string' ? data.action : undefined,
      hostname: typeof data.hostname === 'string' ? data.hostname : undefined,
      errorCodes: Array.isArray(data['error-codes']) ? data['error-codes'] as string[] : undefined,
      challengeTimestamp: typeof data.challenge_ts === 'string' ? data.challenge_ts : undefined,
    }

    // Apply score threshold for reCAPTCHA v3 / Turnstile
    if (result.success && _config.scoreThreshold !== undefined && result.score !== undefined) {
      if (result.score < _config.scoreThreshold) {
        result.success = false
      }
    }

    return result
  },

  /**
   * Check whether a CAPTCHA provider has been configured.
   */
  isEnabled(): boolean {
    return _provider !== null && _config !== null
  },

  /**
   * Return information about the current CAPTCHA configuration.
   * Returns `null` if no provider is configured.
   */
  getProvider(): CaptchaProviderInfo | null {
    if (!_provider || !_config) return null
    return {
      provider: _provider,
      siteKey: _config.siteKey,
      enabled: true,
    }
  },
}
