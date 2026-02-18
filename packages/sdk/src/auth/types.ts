// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Auth — Type Definitions
// ──────────────────────────────────────────────────────────────────────────────

// ── Core ────────────────────────────────────────────────────────────────────

export interface User {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  role: string
  email_verified: boolean
  phone?: string | null
  phone_verified?: boolean
  metadata: Record<string, unknown>
  banned?: boolean | number
  ban_reason?: string | null
  last_login_at?: string | null
  login_count?: number
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  ip_address: string | null
  user_agent: string | null
  metadata: string | null
  created_at: string
}

export interface AuthCode {
  id: string
  email: string
  code_hash: string
  expires_at: string
  used: boolean
  attempts: number
  created_at: string
}

export interface AuthResult {
  user: User
  token: string
  expiresAt: Date
}

export interface SendCodeResult {
  success: boolean
  message: string
  expiresAt: Date
}

export interface ListUsersOptions {
  page?: number
  limit?: number
  role?: string
  search?: string
  orderBy?: 'created_at' | 'email' | 'name'
  order?: 'asc' | 'desc'
}

export interface ListUsersResult {
  users: User[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface AuthConfig {
  methods: string[]
  sessionDuration: string
  allowSignup: boolean
  redirectAfterLogin: string
}

export interface RateLimitEntry {
  count: number
  resetAt: number
}

// ── OAuth ───────────────────────────────────────────────────────────────────

export type OAuthProvider =
  | 'google'
  | 'github'
  | 'discord'
  | 'apple'
  | 'microsoft'
  | 'twitter'
  | 'facebook'
  | 'linkedin'
  | 'slack'
  | 'spotify'

export interface OAuthProviderConfig {
  clientId: string
  clientSecret: string
  scopes?: string[]
}

export interface OAuthGetAuthUrlOptions {
  redirectUri: string
  scopes?: string[]
  state?: string
}

export interface OAuthCallbackOptions {
  code: string
  state?: string
  redirectUri: string
}

export interface OAuthCallbackResult {
  user: User
  token: string
  expiresAt: Date
  isNewUser: boolean
  provider: OAuthProvider
  providerUserId: string
}

export interface OAuthAccount {
  id: string
  user_id: string
  provider: OAuthProvider
  provider_user_id: string
  provider_email: string | null
  access_token: string
  refresh_token: string | null
  token_expires_at: string | null
  scopes: string | null
  profile_data: string | null
  created_at: string
  updated_at: string
}

export interface OAuthProviderEndpoints {
  authorizeUrl: string
  tokenUrl: string
  userInfoUrl: string
  scopes: string[]
}

// ── Magic Links ─────────────────────────────────────────────────────────────

export interface MagicLinkOptions {
  redirectUri?: string
  expiresInMinutes?: number
}

export interface MagicLinkRecord {
  id: string
  email: string
  token_hash: string
  redirect_uri: string | null
  expires_at: string
  used: number
  created_at: string
}

export interface MagicLinkResult {
  success: boolean
  message: string
  expiresAt: Date
}

// ── Phone Auth ──────────────────────────────────────────────────────────────

export interface PhoneCodeRecord {
  id: string
  phone_number: string
  code_hash: string
  expires_at: string
  used: number
  attempts: number
  created_at: string
}

export interface PhoneVerifyResult {
  user: User
  token: string
  expiresAt: Date
  isNewUser: boolean
}

// ── MFA / TOTP ──────────────────────────────────────────────────────────────

export type MfaFactorType = 'totp' | 'sms' | 'email'

export interface MfaFactor {
  id: string
  user_id: string
  factor_type: MfaFactorType
  secret: string | null
  verified: number
  friendly_name: string | null
  created_at: string
  updated_at: string
}

export interface MfaEnrollResult {
  factorId: string
  secret: string
  qrCodeUrl: string
  backupCodes: string[]
}

export interface MfaChallengeResult {
  verified: boolean
  factorId: string
}

// ── Organizations ───────────────────────────────────────────────────────────

export interface Organization {
  id: string
  name: string
  slug: string
  logo_url: string | null
  metadata: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface OrgMember {
  id: string
  org_id: string
  user_id: string
  role: string
  joined_at: string
  // Joined fields from user table
  email?: string
  name?: string | null
  avatar_url?: string | null
}

export interface OrgInvitation {
  id: string
  org_id: string
  email: string
  role: string
  invited_by: string | null
  token: string
  expires_at: string
  accepted: number
  created_at: string
}

export interface CreateOrgOptions {
  name: string
  slug?: string
  logoUrl?: string
  metadata?: Record<string, unknown>
  createdBy?: string
}

export interface UpdateOrgOptions {
  name?: string
  slug?: string
  logoUrl?: string
  metadata?: Record<string, unknown>
}

export interface ListOrgsOptions {
  page?: number
  limit?: number
  search?: string
}

export interface ListOrgsResult {
  organizations: Organization[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface ListMembersOptions {
  page?: number
  limit?: number
  role?: string
}

export interface ListMembersResult {
  members: OrgMember[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface OrgInviteOptions {
  email: string
  role?: string
  invitedBy?: string
  expiresInDays?: number
}

// ── Permissions ─────────────────────────────────────────────────────────────

export interface Permission {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface Role {
  id: string
  name: string
  description: string | null
  created_at: string
}

export interface RolePermission {
  id: string
  role_id: string
  permission_id: string
}

export interface UserRole {
  id: string
  user_id: string
  role_id: string
  assigned_at: string
}

// ── JWT Templates ───────────────────────────────────────────────────────────

export interface JwtTemplate {
  id: string
  name: string
  claims: string
  algorithm: string
  expires_in: string
  created_at: string
  updated_at: string
}

export interface JwtGenerateOptions {
  additionalClaims?: Record<string, unknown>
  expiresIn?: string
}

export interface JwtVerifyResult {
  valid: boolean
  payload: Record<string, unknown> | null
  expired: boolean
  error?: string
}

// ── Restrictions (Allowlist / Blocklist) ─────────────────────────────────────

export type RestrictionType = 'allowlist' | 'blocklist'
export type RestrictionIdentifierType = 'email' | 'domain'

export interface AuthRestriction {
  id: string
  list_type: RestrictionType
  identifier_type: RestrictionIdentifierType
  identifier: string
  added_by: string | null
  created_at: string
}

export interface CheckAccessResult {
  allowed: boolean
  reason: string
  matchedRule?: AuthRestriction
}

// ── Waitlist ────────────────────────────────────────────────────────────────

export type WaitlistStatus = 'pending' | 'approved' | 'rejected'

export interface WaitlistEntry {
  id: string
  email: string
  status: WaitlistStatus
  metadata: string
  reason: string | null
  approved_at: string | null
  rejected_at: string | null
  created_at: string
}

export interface WaitlistAddOptions {
  metadata?: Record<string, unknown>
}

export interface WaitlistListOptions {
  page?: number
  limit?: number
  status?: WaitlistStatus
}

export interface WaitlistListResult {
  entries: WaitlistEntry[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface WaitlistStats {
  total: number
  pending: number
  approved: number
  rejected: number
}

// ── Password Auth ───────────────────────────────────────────────────────────

export interface PasswordResetRecord {
  id: string
  email: string
  token_hash: string
  expires_at: string
  used: number
  created_at: string
}

export interface PasswordSignUpResult {
  user: User
  token: string
  expiresAt: Date
}

export interface PasswordSignInResult {
  user: User
  token: string
  expiresAt: Date
}

// ── Session Enhancements ────────────────────────────────────────────────────

export interface SessionInfo {
  id: string
  user_id: string
  ip_address: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
  expires_at: string
  created_at: string
  is_current: boolean
}

// ── Impersonation ───────────────────────────────────────────────────────────

export interface ImpersonationSession {
  user: User
  token: string
  expiresAt: Date
  actorUserId: string
  targetUserId: string
}

export interface ImpersonationCheck {
  isImpersonating: boolean
  actorUserId: string | null
  targetUserId: string | null
}
