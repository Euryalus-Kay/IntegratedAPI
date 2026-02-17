export { auth } from './provider.js'
export { authRoutes } from './routes.js'
export {
  middleware,
  protect,
  requireAuth,
  requireRole,
  rateLimit,
  csrf,
  honoMiddleware,
  honoProtect,
  honoRequireRole,
  honoRateLimit,
  honoCsrf,
  setSessionCookie,
  clearSessionCookie,
} from './middleware.js'
export * from './types.js'
export type { AuditAction, AuditLogEntry, AuditLogOptions, ActiveSession } from './provider.js'
export type { RateLimitOptions } from './middleware.js'
