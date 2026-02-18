/**
 * VibeKit Webhooks Module (top-level, non-DB)
 * Provides incoming webhook handling and verification.
 * The DB-level webhook system handles outgoing webhooks.
 * This module handles incoming webhook verification and routing.
 */

import crypto from 'node:crypto'

export interface WebhookEndpoint {
  id: string
  path: string
  secret: string
  handler: (payload: unknown, headers: Record<string, string>) => void | Promise<void>
  events: string[]
  createdAt: string
}

export interface WebhookVerifyResult {
  valid: boolean
  payload: unknown
  error?: string
}

const _endpoints: Map<string, WebhookEndpoint> = new Map()

function generateId(): string {
  return crypto.randomUUID()
}

export const webhooks = {
  /** Register an incoming webhook endpoint */
  register(options: {
    path: string
    secret?: string
    events?: string[]
    handler: (payload: unknown, headers: Record<string, string>) => void | Promise<void>
  }): WebhookEndpoint {
    const id = generateId()
    const endpoint: WebhookEndpoint = {
      id,
      path: options.path,
      secret: options.secret || crypto.randomBytes(32).toString('hex'),
      handler: options.handler,
      events: options.events || ['*'],
      createdAt: new Date().toISOString(),
    }
    _endpoints.set(id, endpoint)
    return endpoint
  },

  /** Unregister a webhook endpoint */
  unregister(id: string): void {
    _endpoints.delete(id)
  },

  /** List all registered webhook endpoints */
  list(): Array<Omit<WebhookEndpoint, 'handler'>> {
    return [..._endpoints.values()].map(({ handler, ...rest }) => rest)
  },

  /** Get an endpoint by ID */
  get(id: string): WebhookEndpoint | undefined {
    return _endpoints.get(id)
  },

  /** Find an endpoint by path */
  findByPath(path: string): WebhookEndpoint | undefined {
    return [..._endpoints.values()].find(e => e.path === path)
  },

  /** Verify a webhook signature */
  verify(payload: string, signature: string, secret: string, algorithm = 'sha256'): WebhookVerifyResult {
    try {
      const hmac = crypto.createHmac(algorithm, secret)
      hmac.update(payload)
      const expected = `${algorithm}=${hmac.digest('hex')}`
      const valid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expected)
      )
      return {
        valid,
        payload: valid ? JSON.parse(payload) : null,
        error: valid ? undefined : 'Invalid signature',
      }
    } catch (err) {
      return {
        valid: false,
        payload: null,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  },

  /** Process an incoming webhook */
  async process(path: string, payload: string, headers: Record<string, string>): Promise<{ processed: boolean; endpointId?: string; error?: string }> {
    const endpoint = webhooks.findByPath(path)
    if (!endpoint) return { processed: false, error: `No webhook endpoint registered for path: ${path}` }

    // Verify signature if present
    const signature = headers['x-webhook-signature'] || headers['x-hub-signature-256'] || headers['x-signature']
    if (signature) {
      const result = webhooks.verify(payload, signature, endpoint.secret)
      if (!result.valid) return { processed: false, endpointId: endpoint.id, error: result.error }
    }

    try {
      const parsedPayload = JSON.parse(payload)
      await endpoint.handler(parsedPayload, headers)
      return { processed: true, endpointId: endpoint.id }
    } catch (err) {
      return { processed: false, endpointId: endpoint.id, error: err instanceof Error ? err.message : String(err) }
    }
  },

  /** Generate a webhook signing secret */
  generateSecret(): string {
    return crypto.randomBytes(32).toString('hex')
  },

  /** Sign a payload for outgoing webhooks */
  sign(payload: string, secret: string, algorithm = 'sha256'): string {
    const hmac = crypto.createHmac(algorithm, secret)
    hmac.update(payload)
    return `${algorithm}=${hmac.digest('hex')}`
  },

  /** Clear all registered endpoints */
  clear(): void {
    _endpoints.clear()
  },
}
