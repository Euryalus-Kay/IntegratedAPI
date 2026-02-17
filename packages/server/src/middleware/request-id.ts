// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Request ID Middleware
// ──────────────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../types.js'

let counter = 0

/**
 * Generate a unique request ID with a `req_` prefix.
 * Uses a combination of timestamp, random hex, and an incrementing counter
 * to guarantee uniqueness even under high concurrency.
 */
function generateRequestId(): string {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 8)
  const seq = (counter++).toString(36)
  return `req_${timestamp}${random}${seq}`
}

/**
 * Middleware that assigns a unique request ID to every inbound request.
 *
 * - If the client sends an `X-Request-ID` header it is preserved.
 * - Otherwise a new ID is generated with the `req_` prefix.
 * - The ID is stored in the Hono context variable `requestId` for downstream
 *   access and echoed back via the `X-Request-ID` response header.
 */
export const requestIdMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const existing = c.req.header('X-Request-ID')
  const requestId = existing || generateRequestId()

  c.set('requestId', requestId)
  c.header('X-Request-ID', requestId)

  await next()
})
