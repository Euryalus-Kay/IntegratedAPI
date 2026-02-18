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

// Advanced auth modules
export { oauth } from './oauth.js'
export { magicLinks } from './magic-links.js'
export { phone } from './phone.js'
export { mfa } from './mfa.js'
export { organizations } from './organizations.js'
export { permissions } from './permissions.js'
export { passwords } from './passwords.js'
export { restrictions } from './restrictions.js'
export { waitlist } from './waitlist.js'
export { createSession, validateSession, revokeSession, revokeAllSessions, getActiveSessions, cleanExpiredSessions } from './session.js'

// Auth v2 modules
export { anonymous } from './anonymous.js'
export type { AnonymousSignInOptions, AnonymousConvertResult } from './anonymous.js'

export { sso } from './sso.js'
export type {
  SSOProviderType, SSOProviderConfig, SSOAttributeMapping, SSOProvider,
  SSOInitiateOptions, SSOInitiateResult, SAMLResponse, SAMLAssertion,
  SSOCallbackResult, SAMLValidationResult,
} from './sso.js'

export { passkeys } from './passkeys.js'
export type {
  PasskeyChallenge, PasskeyRegistrationChallenge, PasskeyCredential,
  StoredPasskey, PasskeyLoginResult,
} from './passkeys.js'

export { captcha } from './captcha.js'
export type {
  CaptchaProvider, CaptchaConfig, CaptchaProviderInfo, CaptchaVerifyResult,
} from './captcha.js'
