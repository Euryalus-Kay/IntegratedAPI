// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Error Handler Middleware
// ──────────────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { AppEnv } from '../types.js'
import {
  VibeKitError,
  ValidationError,
  ErrorCodes,
  wrapError,
  createLogger,
} from 'vibekit'

const log = createLogger('server:error-handler')

/**
 * Structured JSON error response matching the VibeKit error format.
 */
interface ErrorResponseBody {
  error: {
    code: string
    message: string
    statusCode: number
    suggestion?: string
    docsUrl?: string
    requestId?: string
    timestamp: string
    context?: Record<string, unknown>
    fieldErrors?: Record<string, string>
  }
}

/**
 * Build a structured error response body from a VibeKitError.
 */
function buildErrorResponse(err: VibeKitError, requestId?: string): ErrorResponseBody {
  const body: ErrorResponseBody = {
    error: {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
      timestamp: err.timestamp,
    },
  }

  if (err.suggestion) body.error.suggestion = err.suggestion
  if (err.docsUrl) body.error.docsUrl = err.docsUrl
  if (requestId) body.error.requestId = requestId
  if (err.context && Object.keys(err.context).length > 0) {
    body.error.context = err.context as Record<string, unknown>
  }
  if (err instanceof ValidationError && Object.keys(err.fieldErrors).length > 0) {
    body.error.fieldErrors = err.fieldErrors
  }

  return body
}

/**
 * Global error-handling middleware. Catches all thrown errors, wraps unknown
 * errors into VibeKitError instances, and returns a structured JSON response.
 *
 * Must be registered before all route handlers so it can catch errors from
 * the entire middleware chain.
 */
export const errorHandlerMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  try {
    await next()
  } catch (err: unknown) {
    const requestId = c.get('requestId')

    // Wrap non-VibeKit errors into a VibeKitError
    const vkError = err instanceof VibeKitError
      ? err
      : wrapError(err, {
          code: ErrorCodes.UNKNOWN_ERROR,
          requestId,
        })

    // Log the error
    const logData: Record<string, unknown> = {
      code: vkError.code,
      statusCode: vkError.statusCode,
      path: c.req.path,
      method: c.req.method,
    }
    if (requestId) logData.requestId = requestId
    if (vkError.cause instanceof Error) {
      logData.cause = vkError.cause.message
    }

    if (vkError.statusCode >= 500) {
      log.error(vkError.message, logData)
    } else {
      log.warn(vkError.message, logData)
    }

    const body = buildErrorResponse(vkError, requestId)

    return c.json(body, vkError.statusCode as never)
  }
})

/**
 * Handle 404 for unmatched routes. Register this as the final fallback
 * handler using `app.notFound()`.
 */
export function notFoundHandler(c: Context<AppEnv>) {
  const requestId = c.get('requestId')

  const body: ErrorResponseBody = {
    error: {
      code: 'NOT_FOUND',
      message: `Route not found: ${c.req.method} ${c.req.path}`,
      statusCode: 404,
      suggestion: 'Check the URL and HTTP method. See API docs at https://vibekit.dev/docs/api',
      docsUrl: 'https://vibekit.dev/docs/api',
      timestamp: new Date().toISOString(),
    },
  }
  if (requestId) body.error.requestId = requestId

  return c.json(body, 404)
}
