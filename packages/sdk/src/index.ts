// Core modules
export { db } from './db/index.js'
export { auth } from './auth/index.js'
export { storage } from './storage/index.js'
export { email } from './email/index.js'
export { realtime } from './realtime/index.js'
export { notifications } from './notifications/index.js'

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
