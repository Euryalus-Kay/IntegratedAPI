// Core modules
export { db } from './db/index.js'
export { auth } from './auth/index.js'
export { storage } from './storage/index.js'
export { email } from './email/index.js'
export { realtime } from './realtime/index.js'
export { notifications } from './notifications/index.js'

// New modules (v0.2)
export { observability, logger, metrics, tracing, alerts, health } from './observability/index.js'
export { createVault, createDefaultVault } from './secrets/index.js'
export { createEnvironments } from './environments/index.js'
export { createDeployManager } from './deploy/index.js'
export { webhooks } from './webhooks/index.js'

// Advanced auth (re-exported from auth/index)
export { oauth, magicLinks, phone, mfa, organizations, permissions, passwords, restrictions, waitlist } from './auth/index.js'

// Advanced DB (re-exported from db/index)
export {
  createRLSManager, createRLSManagerWithTracking,
  createTriggerManager, createDbFunctionManager,
  createSearchManager, createVectorManager,
  createCronManager, createQueueManager,
  createWebhookManager, createBranchManager,
} from './db/index.js'

// Config
export { getConfig, setConfig, resetConfig, isLocal, isProduction } from './config/index.js'

// Errors
export {
  VibeKitError,
  AuthError,
  DbError,
  StorageError,
  ValidationError,
  ConfigError,
  NetworkError,
  ErrorCodes,
  ErrorCodeRegistry,
  ErrorFormatter,
  wrapError,
  isVibeKitError,
  handleError,
} from './utils/errors.js'

// Logging
export { createLogger, getRecentLogs, setLogBufferSize, clearLogBuffer, requestLogger } from './utils/logger.js'

// Diagnostics
export { diagnostics } from './utils/diagnostics.js'

// Re-export types: Auth
export type { User, Session, AuthResult, SendCodeResult, ListUsersOptions, ListUsersResult } from './auth/types.js'

// Re-export types: Database
export type {
  QueryResult,
  ExecuteResult,
  ColumnDefinition,
  ColumnType,
  TableDefinition,
  PaginatedResult,
  PaginationOptions,
  QueryLog,
  DatabaseHealth,
  DatabaseEvent,
  DatabaseEventHandler,
  SeedContext,
} from './db/types.js'

// Re-export types: Storage
export type { FileInfo, UploadOptions, ListFilesResult, ListFilesOptions } from './storage/types.js'

// Re-export types: Email
export type { SendEmailOptions, EmailTemplate, EmailLog, EmailSendResult, EmailValidationResult } from './email/types.js'

// Re-export types: Realtime
export type { RealtimeMessage, PresenceState, ChannelInfo } from './realtime/types.js'

// Re-export types: Config
export type { VibeKitConfig, ResolvedConfig, VibeKitEnv } from './config/types.js'

// Re-export types: Notifications
export type {
  NotificationPreferences,
  NotificationEvent,
  NotificationResult,
  BuildFailedEvent,
  BuildSucceededEvent,
  DeployRollbackEvent,
  UsageLimitWarningEvent,
  SecurityAlertEvent,
  TeamInviteEvent,
} from './notifications/types.js'

// Re-export types: Errors
export type {
  ErrorContext,
  ErrorCodeDescriptor,
  ErrorCode,
  VibeKitErrorOptions,
  ErrorFormatMode,
  HandleErrorOptions,
  JsonErrorResponse,
} from './utils/errors.js'

// Re-export types: Logger
export type { LogLevel, LogFormat, LogEntry, Logger, TimerResult, RequestLogData, QueryLogData } from './utils/logger.js'

// Re-export types: Diagnostics
export type { DiagnosticReport, PerformanceTrace } from './utils/diagnostics.js'

// Re-export types: Advanced Database
export type {
  RLSPolicy, RLSPolicyDefinition, RLSOperation, RLSManager,
  TriggerDefinition, TriggerConfig, TriggerTiming, TriggerEvent, TriggerManager,
  DbFunction, DbFunctionManager,
  FTSIndexOptions, FTSSearchOptions, FTSResult, SearchManager,
  VectorEntry, VectorSearchOptions, VectorSearchResult, VectorManager,
  CronJobConfig, CronHistoryEntry, CronManager,
  QueueOptions, QueueMessage, QueueReadOptions, QueueMetrics, QueueManager,
  WebhookDefinition, WebhookConfig, WebhookDeliveryLog, WebhookManager,
  BranchInfo, BranchDiff, BranchManager,
} from './db/types.js'

// Re-export types: Advanced Auth
export type {
  OAuthProvider, OAuthProviderConfig, OAuthGetAuthUrlOptions, OAuthCallbackOptions,
  OAuthCallbackResult, OAuthAccount, OAuthProviderEndpoints,
  MagicLinkOptions, MagicLinkResult,
  PhoneVerifyResult,
  MfaEnrollResult, MfaChallengeResult, MfaFactor,
  Organization, OrgMember, OrgInvitation, CreateOrgOptions, UpdateOrgOptions,
  ListOrgsOptions, ListOrgsResult, ListMembersOptions, ListMembersResult, OrgInviteOptions,
  Permission, Role, RolePermission, UserRole,
  JwtTemplate, JwtGenerateOptions, JwtVerifyResult,
  AuthRestriction, CheckAccessResult, RestrictionType, RestrictionIdentifierType,
  WaitlistEntry, WaitlistAddOptions, WaitlistListOptions, WaitlistListResult, WaitlistStats, WaitlistStatus,
  PasswordSignUpResult, PasswordSignInResult,
  ImpersonationSession, ImpersonationCheck,
} from './auth/types.js'

// Re-export types: Observability
export type {
  StructuredLog, MetricEntry, TraceSpan, AlertRule, AlertEvent, HealthCheck, HealthReport,
} from './observability/index.js'

// Re-export types: Secrets
export type { Secret, SecretVersion, SecretListOptions, VaultConfig } from './secrets/index.js'

// Re-export types: Environments
export type { Environment, EnvironmentListResult, EnvironmentDiff } from './environments/index.js'

// Re-export types: Deploy
export type {
  Deployment, DeploymentStatus, DeploymentLog, CreateDeploymentOptions,
  DeploymentListOptions, DeploymentListResult, DomainConfig,
} from './deploy/index.js'

// Re-export types: Webhooks
export type { WebhookEndpoint, WebhookVerifyResult } from './webhooks/index.js'
