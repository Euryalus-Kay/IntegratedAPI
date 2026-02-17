export class VibeKitError extends Error {
  code: string
  statusCode: number
  details?: unknown

  constructor(message: string, code: string, statusCode: number = 500, details?: unknown) {
    super(message)
    this.name = 'VibeKitError'
    this.code = code
    this.statusCode = statusCode
    this.details = details
  }

  toJSON() {
    return {
      error: this.message,
      code: this.code,
      statusCode: this.statusCode,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export class AuthError extends VibeKitError {
  constructor(message: string, code: string, statusCode: number = 401) {
    super(message, code, statusCode)
    this.name = 'AuthError'
  }
}

export class DbError extends VibeKitError {
  constructor(message: string, code: string = 'DB_ERROR', statusCode: number = 500) {
    super(message, code, statusCode)
    this.name = 'DbError'
  }
}

export class StorageError extends VibeKitError {
  constructor(message: string, code: string = 'STORAGE_ERROR', statusCode: number = 500) {
    super(message, code, statusCode)
    this.name = 'StorageError'
  }
}

export const ErrorCodes = {
  AUTH_CODE_EXPIRED: 'AUTH_CODE_EXPIRED',
  AUTH_CODE_INVALID: 'AUTH_CODE_INVALID',
  AUTH_CODE_MAX_ATTEMPTS: 'AUTH_CODE_MAX_ATTEMPTS',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_SIGNUP_DISABLED: 'AUTH_SIGNUP_DISABLED',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  AUTH_MAU_LIMIT: 'AUTH_MAU_LIMIT',
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_QUERY_ERROR: 'DB_QUERY_ERROR',
  DB_TABLE_NOT_FOUND: 'DB_TABLE_NOT_FOUND',
  DB_MIGRATION_FAILED: 'DB_MIGRATION_FAILED',
  STORAGE_FILE_NOT_FOUND: 'STORAGE_FILE_NOT_FOUND',
  STORAGE_FILE_TOO_LARGE: 'STORAGE_FILE_TOO_LARGE',
  STORAGE_INVALID_TYPE: 'STORAGE_INVALID_TYPE',
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const
