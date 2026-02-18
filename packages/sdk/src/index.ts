// Core modules
export { db } from './db/index.js'
export { auth } from './auth/index.js'
export { storage } from './storage/index.js'
export { email } from './email/index.js'
export { realtime } from './realtime/index.js'
export { notifications } from './notifications/index.js'

// New modules (v0.2)
export { observability, logger, metrics, tracing, alerts, health, createLogDrainManager } from './observability/index.js'
export { createVault, createDefaultVault } from './secrets/index.js'
export { createEnvironments } from './environments/index.js'
export { createDeployManager } from './deploy/index.js'
export { webhooks } from './webhooks/index.js'

// Advanced auth (re-exported from auth/index)
export { oauth, magicLinks, phone, mfa, organizations, permissions, passwords, restrictions, waitlist } from './auth/index.js'

// Auth v2 (re-exported from auth/index)
export { anonymous, sso, passkeys, captcha } from './auth/index.js'

// New modules (v0.3) - Functions, Flags, Analytics
export { createFunctionRuntime } from './functions/index.js'
export { createFlagManager } from './flags/index.js'
export { createAnalytics } from './analytics/index.js'

// Advanced DB (re-exported from db/index)
export {
  createRLSManager, createRLSManagerWithTracking,
  createTriggerManager, createDbFunctionManager,
  createSearchManager, createVectorManager,
  createCronManager, createQueueManager,
  createWebhookManager, createBranchManager,
  createMigrationManager, createConnectionPool,
  createBackupManager, createReplicaManager,
  createTypeGenerator,
} from './db/index.js'

// Realtime v2 (re-exported from realtime/index)
export { broadcast, presenceV2, cdc } from './realtime/index.js'

// Email v2 (re-exported from email/index)
export { createDomainManager, suppression, emailAnalytics } from './email/index.js'

// Storage v2 (re-exported from storage/index)
export { createResumableUploadManager } from './storage/index.js'
export { createImageTransformer } from './storage/index.js'
export { createCdnManager } from './storage/index.js'

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

// Re-export types: Auth v2
export type {
  AnonymousSignInOptions, AnonymousConvertResult,
} from './auth/index.js'
export type {
  SSOProviderType, SSOProviderConfig, SSOAttributeMapping, SSOProvider,
  SSOInitiateOptions, SSOInitiateResult, SAMLResponse, SAMLAssertion,
  SSOCallbackResult, SAMLValidationResult,
} from './auth/index.js'
export type {
  PasskeyChallenge, PasskeyRegistrationChallenge, PasskeyCredential,
  StoredPasskey, PasskeyLoginResult,
} from './auth/index.js'
export type {
  CaptchaProvider, CaptchaConfig, CaptchaProviderInfo, CaptchaVerifyResult,
} from './auth/index.js'

// Re-export types: Realtime v2
export type {
  BroadcastCallback, ChannelAuthCallback, BroadcastEvent, BroadcastSubscriber,
} from './realtime/index.js'
export type {
  PresenceUser, PresenceJoinCallback, PresenceLeaveCallback, PresenceSyncCallback,
} from './realtime/index.js'
export type {
  CDCEventType, CDCChange, CDCCallback, CDCFilterOptions, CDCSubscription,
} from './realtime/index.js'

// Re-export types: Email v2
export type {
  DomainStatus, DnsRecordType, DnsRecord, EmailDomain, DomainManagerConfig,
} from './email/index.js'
export type {
  SuppressionReason, SuppressedEmail, SuppressionListOptions, SuppressionListResult,
  BounceEvent, ComplaintEvent,
} from './email/index.js'
export type {
  EmailEventType, EmailEvent, EmailAnalyticsSummary, TopLink, DomainStats,
  AnalyticsSummaryOptions, TopLinksOptions,
} from './email/index.js'

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

// Re-export types: Log Drains
export type {
  LogDrainType, LogDrainStatus, LogDrainConfig, LogDrainFilter,
  LogDrain, LogDrainStats, DrainLogEntry,
} from './observability/index.js'

// Re-export types: Functions
export type {
  FunctionRequest, FunctionResponse, FunctionContext, FunctionHandler,
  FunctionMiddleware, FunctionOptions, CorsConfig, RateLimitConfig,
  RegisteredFunction, FunctionInvocationLog, FunctionMetrics,
  FunctionSchedule, FunctionRuntimeConfig, FunctionRuntime,
} from './functions/types.js'

// Re-export types: Feature Flags
export type {
  FlagType, FlagValue, FlagTargetingRule, FlagConfig, FlagCreateOptions,
  FlagUpdateOptions, EvaluationContext, EvaluationResult,
  FlagEvaluationMetrics, ExperimentVariant, ExperimentConfig,
  ExperimentCreateOptions, ExperimentAssignment, ExperimentResults,
  FlagDbAdapter, FlagManagerConfig, FlagManager,
} from './flags/types.js'

// Re-export types: Analytics
export type {
  AnalyticsEvent, PageViewEvent, WebVitalEntry, TrackOptions,
  PageViewOptions, WebVitalsInput, IdentifyTraits, TimeRange,
  TimeFilter, EventQueryOptions, PageViewQueryOptions,
  TopPagesOptions, TopReferrersOptions, UniqueVisitorsOptions,
  WebVitalsQueryOptions, SessionQueryOptions, TopPageResult,
  TopReferrerResult, UniqueVisitorResult, WebVitalsSummary,
  SessionData, FunnelStep, FunnelResult, ExportOptions,
  AnalyticsDbAdapter, AnalyticsConfig, AnalyticsManager,
} from './analytics/types.js'

// Re-export types: DB Enhanced
export type {
  MigrationManager, MigrationFile, MigrationRecord, MigrationStatusEntry, SchemaDiff,
} from './db/migrations.js'
export type {
  ConnectionPoolManager, PoolConfig, PoolConnection, PoolStats,
} from './db/pool.js'
export type {
  BackupManager, BackupConfig, BackupInfo, WalStatus, ScheduleHandle,
} from './db/backups.js'
export type {
  ReplicaManager, ReplicaConfig, ReplicaInfo,
} from './db/replicas.js'
export type {
  TypeGenerator, ColumnInfo, TableSchema, WatchHandle,
} from './db/typegen.js'

// Re-export types: Storage v2
export type {
  ResumableUploadConfig, CreateUploadOptions, ResumableUploadState,
  ResumableUploadStatus, UploadStatusResult, UploadChunkResult,
  CompleteUploadResult, ListUploadsOptions, ResumeUploadInfo,
} from './storage/resumable.js'
export type {
  ImageTransformerConfig, TransformOptions, ImageResizeMode, ImageOutputFormat,
  WatermarkPosition, ImageInfo, TransformResult, TransformUrlResult, BatchResult,
  SharpPlugin, SharpPipeline,
} from './storage/transforms.js'
export type {
  CdnConfig, CachePolicy, CacheHeaders, CdnStats,
  CustomDomain, PurgeResult, WarmCacheResult,
} from './storage/cdn.js'
