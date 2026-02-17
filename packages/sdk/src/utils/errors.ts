// ──────────────────────────────────────────────────────────────────────────────
// VibeKit — Advanced Error System
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Metadata that can be attached to any VibeKit error for structured logging,
 * debugging, and forwarding to observability tools.
 */
export interface ErrorContext {
  [key: string]: string | number | boolean | null | undefined
}

/**
 * Descriptor stored in the typed error code registry.
 */
export interface ErrorCodeDescriptor {
  description: string
  docsUrl?: string
  defaultSuggestion?: string
  defaultStatusCode: number
}

// ──────────────────────────────────────────────────────────────────────────────
// Typed error code registry
// ──────────────────────────────────────────────────────────────────────────────

const DOCS_BASE = 'https://vibekit.dev/docs/errors'

export const ErrorCodes = {
  // Auth
  AUTH_CODE_EXPIRED: 'AUTH_CODE_EXPIRED',
  AUTH_CODE_INVALID: 'AUTH_CODE_INVALID',
  AUTH_CODE_MAX_ATTEMPTS: 'AUTH_CODE_MAX_ATTEMPTS',
  AUTH_RATE_LIMITED: 'AUTH_RATE_LIMITED',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_UNAUTHORIZED: 'AUTH_UNAUTHORIZED',
  AUTH_SIGNUP_DISABLED: 'AUTH_SIGNUP_DISABLED',
  AUTH_USER_NOT_FOUND: 'AUTH_USER_NOT_FOUND',
  AUTH_MAU_LIMIT: 'AUTH_MAU_LIMIT',
  AUTH_ERROR: 'AUTH_ERROR',

  // Database
  DB_CONNECTION_FAILED: 'DB_CONNECTION_FAILED',
  DB_QUERY_ERROR: 'DB_QUERY_ERROR',
  DB_TABLE_NOT_FOUND: 'DB_TABLE_NOT_FOUND',
  DB_MIGRATION_FAILED: 'DB_MIGRATION_FAILED',

  // Storage
  STORAGE_FILE_NOT_FOUND: 'STORAGE_FILE_NOT_FOUND',
  STORAGE_FILE_TOO_LARGE: 'STORAGE_FILE_TOO_LARGE',
  STORAGE_INVALID_TYPE: 'STORAGE_INVALID_TYPE',
  STORAGE_ERROR: 'STORAGE_ERROR',

  // Validation
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VALIDATION_REQUIRED_FIELD: 'VALIDATION_REQUIRED_FIELD',
  VALIDATION_INVALID_FORMAT: 'VALIDATION_INVALID_FORMAT',
  VALIDATION_OUT_OF_RANGE: 'VALIDATION_OUT_OF_RANGE',

  // Config
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  CONFIG_INVALID: 'CONFIG_INVALID',
  CONFIG_MISSING_ENV: 'CONFIG_MISSING_ENV',

  // Network
  NETWORK_TIMEOUT: 'NETWORK_TIMEOUT',
  NETWORK_DNS_FAILURE: 'NETWORK_DNS_FAILURE',
  NETWORK_CONNECTION_REFUSED: 'NETWORK_CONNECTION_REFUSED',
  NETWORK_REQUEST_FAILED: 'NETWORK_REQUEST_FAILED',

  // General
  PROJECT_NOT_FOUND: 'PROJECT_NOT_FOUND',
  PLAN_LIMIT_EXCEEDED: 'PLAN_LIMIT_EXCEEDED',
  DEPLOY_FAILED: 'DEPLOY_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

/**
 * Full registry mapping each error code to its description, documentation URL,
 * default suggestion, and default HTTP status code.
 */
export const ErrorCodeRegistry: Record<ErrorCode, ErrorCodeDescriptor> = {
  // Auth
  AUTH_CODE_EXPIRED: {
    description: 'The verification code has expired.',
    docsUrl: `${DOCS_BASE}#auth-code-expired`,
    defaultSuggestion: 'Request a new verification code and try again.',
    defaultStatusCode: 400,
  },
  AUTH_CODE_INVALID: {
    description: 'The verification code is invalid.',
    docsUrl: `${DOCS_BASE}#auth-code-invalid`,
    defaultSuggestion: 'Double-check the code you entered or request a new one.',
    defaultStatusCode: 400,
  },
  AUTH_CODE_MAX_ATTEMPTS: {
    description: 'Maximum verification attempts exceeded.',
    docsUrl: `${DOCS_BASE}#auth-code-max-attempts`,
    defaultSuggestion: 'Wait a few minutes then request a new verification code.',
    defaultStatusCode: 429,
  },
  AUTH_RATE_LIMITED: {
    description: 'Authentication rate limit reached.',
    docsUrl: `${DOCS_BASE}#auth-rate-limited`,
    defaultSuggestion: 'Slow down request frequency and retry after the rate-limit window.',
    defaultStatusCode: 429,
  },
  AUTH_SESSION_EXPIRED: {
    description: 'The user session has expired.',
    docsUrl: `${DOCS_BASE}#auth-session-expired`,
    defaultSuggestion: 'Re-authenticate to obtain a fresh session token.',
    defaultStatusCode: 401,
  },
  AUTH_UNAUTHORIZED: {
    description: 'Authentication is required but was not provided or is invalid.',
    docsUrl: `${DOCS_BASE}#auth-unauthorized`,
    defaultSuggestion: 'Include a valid Authorization header or session cookie.',
    defaultStatusCode: 401,
  },
  AUTH_SIGNUP_DISABLED: {
    description: 'New user signups are currently disabled.',
    docsUrl: `${DOCS_BASE}#auth-signup-disabled`,
    defaultSuggestion: 'Enable signups in your project settings or contact the administrator.',
    defaultStatusCode: 403,
  },
  AUTH_USER_NOT_FOUND: {
    description: 'The requested user does not exist.',
    docsUrl: `${DOCS_BASE}#auth-user-not-found`,
    defaultSuggestion: 'Verify the user identifier is correct.',
    defaultStatusCode: 404,
  },
  AUTH_MAU_LIMIT: {
    description: 'Monthly active user limit for the current plan has been reached.',
    docsUrl: `${DOCS_BASE}#auth-mau-limit`,
    defaultSuggestion: 'Upgrade your plan to increase the MAU limit.',
    defaultStatusCode: 403,
  },
  AUTH_ERROR: {
    description: 'A general authentication error occurred.',
    docsUrl: `${DOCS_BASE}#auth-error`,
    defaultSuggestion: 'Check credentials and retry the request.',
    defaultStatusCode: 500,
  },

  // Database
  DB_CONNECTION_FAILED: {
    description: 'Unable to establish a database connection.',
    docsUrl: `${DOCS_BASE}#db-connection-failed`,
    defaultSuggestion: 'Check your DATABASE_URL and ensure the database server is reachable.',
    defaultStatusCode: 500,
  },
  DB_QUERY_ERROR: {
    description: 'A database query failed.',
    docsUrl: `${DOCS_BASE}#db-query-error`,
    defaultSuggestion: 'Review the query syntax and parameters. Check logs for the full SQL.',
    defaultStatusCode: 500,
  },
  DB_TABLE_NOT_FOUND: {
    description: 'The referenced database table does not exist.',
    docsUrl: `${DOCS_BASE}#db-table-not-found`,
    defaultSuggestion: 'Run pending migrations with `vibekit db migrate`.',
    defaultStatusCode: 500,
  },
  DB_MIGRATION_FAILED: {
    description: 'A database migration failed to apply.',
    docsUrl: `${DOCS_BASE}#db-migration-failed`,
    defaultSuggestion: 'Inspect the migration file for errors and check the database state.',
    defaultStatusCode: 500,
  },

  // Storage
  STORAGE_FILE_NOT_FOUND: {
    description: 'The requested file was not found in storage.',
    docsUrl: `${DOCS_BASE}#storage-file-not-found`,
    defaultSuggestion: 'Verify the file key/path is correct.',
    defaultStatusCode: 404,
  },
  STORAGE_FILE_TOO_LARGE: {
    description: 'The uploaded file exceeds the maximum allowed size.',
    docsUrl: `${DOCS_BASE}#storage-file-too-large`,
    defaultSuggestion: 'Reduce the file size or increase the upload limit in storage config.',
    defaultStatusCode: 413,
  },
  STORAGE_INVALID_TYPE: {
    description: 'The file type is not allowed.',
    docsUrl: `${DOCS_BASE}#storage-invalid-type`,
    defaultSuggestion: 'Check the allowed MIME types in your storage configuration.',
    defaultStatusCode: 415,
  },
  STORAGE_ERROR: {
    description: 'A general storage error occurred.',
    docsUrl: `${DOCS_BASE}#storage-error`,
    defaultSuggestion: 'Check storage provider configuration and connectivity.',
    defaultStatusCode: 500,
  },

  // Validation
  VALIDATION_FAILED: {
    description: 'Input validation failed.',
    docsUrl: `${DOCS_BASE}#validation-failed`,
    defaultSuggestion: 'Review the request body against the expected schema.',
    defaultStatusCode: 400,
  },
  VALIDATION_REQUIRED_FIELD: {
    description: 'A required field is missing from the input.',
    docsUrl: `${DOCS_BASE}#validation-required-field`,
    defaultSuggestion: 'Include all required fields in the request.',
    defaultStatusCode: 400,
  },
  VALIDATION_INVALID_FORMAT: {
    description: 'A field value does not match the expected format.',
    docsUrl: `${DOCS_BASE}#validation-invalid-format`,
    defaultSuggestion: 'Check the field format requirements in the API docs.',
    defaultStatusCode: 400,
  },
  VALIDATION_OUT_OF_RANGE: {
    description: 'A numeric or date value is outside the allowed range.',
    docsUrl: `${DOCS_BASE}#validation-out-of-range`,
    defaultSuggestion: 'Ensure values fall within documented min/max bounds.',
    defaultStatusCode: 400,
  },

  // Config
  CONFIG_NOT_FOUND: {
    description: 'No configuration file could be located.',
    docsUrl: `${DOCS_BASE}#config-not-found`,
    defaultSuggestion: 'Run `vibekit init` to create a vibekit.config.ts in your project root.',
    defaultStatusCode: 500,
  },
  CONFIG_INVALID: {
    description: 'The configuration file contains invalid values.',
    docsUrl: `${DOCS_BASE}#config-invalid`,
    defaultSuggestion: 'Validate your vibekit.config.ts against the config schema.',
    defaultStatusCode: 500,
  },
  CONFIG_MISSING_ENV: {
    description: 'A required environment variable is not set.',
    docsUrl: `${DOCS_BASE}#config-missing-env`,
    defaultSuggestion: 'Add the missing variable to your .env file or deployment environment.',
    defaultStatusCode: 500,
  },

  // Network
  NETWORK_TIMEOUT: {
    description: 'The network request timed out.',
    docsUrl: `${DOCS_BASE}#network-timeout`,
    defaultSuggestion: 'Increase the request timeout or check network connectivity.',
    defaultStatusCode: 504,
  },
  NETWORK_DNS_FAILURE: {
    description: 'DNS resolution failed for the target host.',
    docsUrl: `${DOCS_BASE}#network-dns-failure`,
    defaultSuggestion: 'Verify the hostname is correct and DNS is properly configured.',
    defaultStatusCode: 502,
  },
  NETWORK_CONNECTION_REFUSED: {
    description: 'The remote server refused the connection.',
    docsUrl: `${DOCS_BASE}#network-connection-refused`,
    defaultSuggestion: 'Ensure the target service is running and the port is correct.',
    defaultStatusCode: 502,
  },
  NETWORK_REQUEST_FAILED: {
    description: 'A general network request failure occurred.',
    docsUrl: `${DOCS_BASE}#network-request-failed`,
    defaultSuggestion: 'Check network connectivity and retry the request.',
    defaultStatusCode: 502,
  },

  // General
  PROJECT_NOT_FOUND: {
    description: 'The specified project could not be found.',
    docsUrl: `${DOCS_BASE}#project-not-found`,
    defaultSuggestion: 'Verify the project ID or slug.',
    defaultStatusCode: 404,
  },
  PLAN_LIMIT_EXCEEDED: {
    description: 'A plan resource limit has been exceeded.',
    docsUrl: `${DOCS_BASE}#plan-limit-exceeded`,
    defaultSuggestion: 'Upgrade your plan or reduce resource usage.',
    defaultStatusCode: 403,
  },
  DEPLOY_FAILED: {
    description: 'The deployment failed.',
    docsUrl: `${DOCS_BASE}#deploy-failed`,
    defaultSuggestion: 'Check the build logs for errors and retry.',
    defaultStatusCode: 500,
  },
  RATE_LIMITED: {
    description: 'Too many requests — rate limit exceeded.',
    docsUrl: `${DOCS_BASE}#rate-limited`,
    defaultSuggestion: 'Back off and retry after the Retry-After period.',
    defaultStatusCode: 429,
  },
  NOT_IMPLEMENTED: {
    description: 'This feature is not yet implemented.',
    docsUrl: `${DOCS_BASE}#not-implemented`,
    defaultSuggestion: 'This feature is on the roadmap. Check docs for alternatives.',
    defaultStatusCode: 501,
  },
  UNKNOWN_ERROR: {
    description: 'An unknown error occurred.',
    docsUrl: `${DOCS_BASE}#unknown-error`,
    defaultSuggestion: 'If this persists, open an issue with the full error output.',
    defaultStatusCode: 500,
  },
}

// ──────────────────────────────────────────────────────────────────────────────
// Options type for VibeKitError construction
// ──────────────────────────────────────────────────────────────────────────────

export interface VibeKitErrorOptions {
  /** The error code — should be a value from `ErrorCodes`. */
  code: ErrorCode | string
  /** HTTP status code. Falls back to the registry default or 500. */
  statusCode?: number
  /** Original error that caused this one. */
  cause?: Error | unknown
  /** Actionable suggestion for the developer / end-user. */
  suggestion?: string
  /** Link to relevant documentation. */
  docsUrl?: string
  /** Arbitrary key-value metadata for structured logging. */
  context?: ErrorContext
  /** Per-request correlation id. */
  requestId?: string
  /** Preserved for backward-compat: free-form details object. */
  details?: unknown
}

// ──────────────────────────────────────────────────────────────────────────────
// Base error class
// ──────────────────────────────────────────────────────────────────────────────

export class VibeKitError extends Error {
  readonly code: string
  readonly statusCode: number
  readonly suggestion: string | undefined
  readonly docsUrl: string | undefined
  readonly context: ErrorContext
  readonly requestId: string | undefined
  readonly timestamp: string
  readonly details: unknown

  /**
   * @param message  Human-readable error message.
   * @param codeOrOpts  Either a plain error-code string (backward-compatible)
   *                    or a full `VibeKitErrorOptions` object.
   * @param statusCode  (legacy positional) HTTP status code.
   * @param details     (legacy positional) Free-form details.
   */
  constructor(
    message: string,
    codeOrOpts: string | VibeKitErrorOptions,
    statusCode?: number,
    details?: unknown,
  ) {
    // Normalise to an options object so we can handle both call styles.
    const opts: VibeKitErrorOptions =
      typeof codeOrOpts === 'string'
        ? { code: codeOrOpts, statusCode, details }
        : codeOrOpts

    const registry = ErrorCodeRegistry[opts.code as ErrorCode] as
      | ErrorCodeDescriptor
      | undefined

    super(message)

    this.name = 'VibeKitError'
    this.code = opts.code
    this.statusCode = opts.statusCode ?? registry?.defaultStatusCode ?? 500
    this.suggestion = opts.suggestion ?? registry?.defaultSuggestion
    this.docsUrl = opts.docsUrl ?? registry?.docsUrl
    this.context = opts.context ?? {}
    this.requestId = opts.requestId
    this.timestamp = new Date().toISOString()
    this.details = opts.details

    // Standard `cause` (ES2022) — also store on the instance for older targets.
    if (opts.cause !== undefined) {
      this.cause = opts.cause
    }

    // Maintain proper prototype chain for `instanceof` checks.
    Object.setPrototypeOf(this, new.target.prototype)
  }

  // ── Serialisation ────────────────────────────────────────────────────────

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      ...(this.suggestion ? { suggestion: this.suggestion } : {}),
      ...(this.docsUrl ? { docsUrl: this.docsUrl } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
      ...(Object.keys(this.context).length > 0 ? { context: this.context } : {}),
      ...(this.details !== undefined ? { details: this.details } : {}),
      ...(this.cause instanceof Error
        ? { cause: { name: this.cause.name, message: this.cause.message } }
        : this.cause !== undefined
          ? { cause: this.cause }
          : {}),
    }
  }

  toString(): string {
    const lines: string[] = [
      `${this.name} [${this.code}]: ${this.message}`,
      `  Status   : ${this.statusCode}`,
      `  Time     : ${this.timestamp}`,
    ]

    if (this.requestId) lines.push(`  RequestId: ${this.requestId}`)
    if (this.suggestion) lines.push(`  Hint     : ${this.suggestion}`)
    if (this.docsUrl) lines.push(`  Docs     : ${this.docsUrl}`)

    const ctxKeys = Object.keys(this.context)
    if (ctxKeys.length > 0) {
      lines.push(`  Context  :`)
      for (const key of ctxKeys) {
        lines.push(`    ${key}: ${String(this.context[key])}`)
      }
    }

    if (this.details !== undefined) {
      lines.push(`  Details  : ${JSON.stringify(this.details)}`)
    }

    if (this.cause instanceof Error) {
      lines.push(`  Cause    : ${this.cause.name}: ${this.cause.message}`)
    }

    return lines.join('\n')
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Domain-specific subclasses
// ──────────────────────────────────────────────────────────────────────────────

export class AuthError extends VibeKitError {
  constructor(message: string, codeOrOpts: string | VibeKitErrorOptions, statusCode: number = 401) {
    const opts: VibeKitErrorOptions =
      typeof codeOrOpts === 'string'
        ? { code: codeOrOpts, statusCode }
        : { statusCode, ...codeOrOpts }
    super(message, opts)
    this.name = 'AuthError'
  }
}

export class DbError extends VibeKitError {
  constructor(
    message: string,
    codeOrOpts: string | VibeKitErrorOptions = 'DB_QUERY_ERROR',
    statusCode: number = 500,
  ) {
    const opts: VibeKitErrorOptions =
      typeof codeOrOpts === 'string'
        ? { code: codeOrOpts, statusCode }
        : { statusCode, ...codeOrOpts }
    super(message, opts)
    this.name = 'DbError'
  }
}

export class StorageError extends VibeKitError {
  constructor(
    message: string,
    codeOrOpts: string | VibeKitErrorOptions = 'STORAGE_ERROR',
    statusCode: number = 500,
  ) {
    const opts: VibeKitErrorOptions =
      typeof codeOrOpts === 'string'
        ? { code: codeOrOpts, statusCode }
        : { statusCode, ...codeOrOpts }
    super(message, opts)
    this.name = 'StorageError'
  }
}

export class ValidationError extends VibeKitError {
  /** Field-level error details, e.g. `{ email: 'must be a valid email' }`. */
  readonly fieldErrors: Record<string, string>

  constructor(
    message: string,
    opts: VibeKitErrorOptions & { fieldErrors?: Record<string, string> } = {
      code: ErrorCodes.VALIDATION_FAILED,
    },
  ) {
    const mergedOpts: VibeKitErrorOptions = {
      statusCode: 400,
      ...opts,
      code: opts.code ?? ErrorCodes.VALIDATION_FAILED,
    }
    super(message, mergedOpts)
    this.name = 'ValidationError'
    this.fieldErrors = opts.fieldErrors ?? {}
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(Object.keys(this.fieldErrors).length > 0
        ? { fieldErrors: this.fieldErrors }
        : {}),
    }
  }

  override toString(): string {
    const base = super.toString()
    const fieldKeys = Object.keys(this.fieldErrors)
    if (fieldKeys.length === 0) return base
    const fieldLines = fieldKeys.map((k) => `    ${k}: ${this.fieldErrors[k]}`)
    return `${base}\n  Fields   :\n${fieldLines.join('\n')}`
  }
}

export class ConfigError extends VibeKitError {
  constructor(
    message: string,
    opts: VibeKitErrorOptions = { code: ErrorCodes.CONFIG_INVALID },
  ) {
    const mergedOpts: VibeKitErrorOptions = {
      statusCode: 500,
      ...opts,
      code: opts.code ?? ErrorCodes.CONFIG_INVALID,
    }
    super(message, mergedOpts)
    this.name = 'ConfigError'
  }
}

export class NetworkError extends VibeKitError {
  /** The URL that was being requested when the error occurred, if available. */
  readonly url: string | undefined
  /** HTTP method (GET, POST, etc.) if applicable. */
  readonly method: string | undefined

  constructor(
    message: string,
    opts: VibeKitErrorOptions & { url?: string; method?: string } = {
      code: ErrorCodes.NETWORK_REQUEST_FAILED,
    },
  ) {
    const mergedOpts: VibeKitErrorOptions = {
      statusCode: 502,
      ...opts,
      code: opts.code ?? ErrorCodes.NETWORK_REQUEST_FAILED,
    }
    super(message, mergedOpts)
    this.name = 'NetworkError'
    this.url = opts.url
    this.method = opts.method
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(this.url ? { url: this.url } : {}),
      ...(this.method ? { method: this.method } : {}),
    }
  }

  override toString(): string {
    const base = super.toString()
    const extras: string[] = []
    if (this.method) extras.push(`  Method   : ${this.method}`)
    if (this.url) extras.push(`  URL      : ${this.url}`)
    return extras.length > 0 ? `${base}\n${extras.join('\n')}` : base
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Type guard
// ──────────────────────────────────────────────────────────────────────────────

export function isVibeKitError(value: unknown): value is VibeKitError {
  return value instanceof VibeKitError
}

// ──────────────────────────────────────────────────────────────────────────────
// Wrap unknown thrown values into VibeKitError
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Converts any caught value into a `VibeKitError`. If it is already one the
 * original instance is returned as-is.
 *
 * ```ts
 * try { riskyOp() } catch (err) { throw wrapError(err) }
 * ```
 */
export function wrapError(
  error: unknown,
  fallbackOpts?: Partial<VibeKitErrorOptions>,
): VibeKitError {
  if (error instanceof VibeKitError) return error

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'An unexpected error occurred'

  const cause = error instanceof Error ? error : undefined

  return new VibeKitError(message, {
    code: fallbackOpts?.code ?? ErrorCodes.UNKNOWN_ERROR,
    statusCode: fallbackOpts?.statusCode ?? 500,
    cause,
    suggestion: fallbackOpts?.suggestion,
    docsUrl: fallbackOpts?.docsUrl,
    context: fallbackOpts?.context,
    requestId: fallbackOpts?.requestId,
  })
}

// ──────────────────────────────────────────────────────────────────────────────
// Error Formatter
// ──────────────────────────────────────────────────────────────────────────────

export type ErrorFormatMode = 'text' | 'json' | 'terminal'

/** ANSI colour helpers. */
const ansi = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
} as const

export class ErrorFormatter {
  /**
   * Format an error in the requested mode.
   *
   * - `text`     — Multi-line human-readable plain text (no ANSI).
   * - `json`     — Pretty-printed JSON string.
   * - `terminal` — Coloured multi-line output for TTY.
   */
  static format(error: VibeKitError, mode: ErrorFormatMode): string {
    switch (mode) {
      case 'json':
        return JSON.stringify(error.toJSON(), null, 2)
      case 'terminal':
        return ErrorFormatter.formatTerminal(error)
      case 'text':
      default:
        return error.toString()
    }
  }

  /** Pretty-print with ANSI colours and Unicode icons. */
  private static formatTerminal(error: VibeKitError): string {
    const { red, yellow, cyan, gray, bold, dim, reset } = ansi
    // ✘ for server errors, ⚠ for client errors
    const icon = error.statusCode >= 500 ? '\u2718' : '\u26A0'

    const lines: string[] = [
      `${red}${bold}${icon} ${error.name}${reset} ${dim}[${error.code}]${reset}`,
      `  ${bold}${error.message}${reset}`,
      `  ${gray}Status ${error.statusCode} | ${error.timestamp}${reset}`,
    ]

    if (error.requestId) {
      lines.push(`  ${gray}Request: ${error.requestId}${reset}`)
    }
    if (error.suggestion) {
      lines.push(`  ${yellow}\u2192 ${error.suggestion}${reset}`)
    }
    if (error.docsUrl) {
      lines.push(`  ${cyan}\u2139 ${error.docsUrl}${reset}`)
    }

    const ctxKeys = Object.keys(error.context)
    if (ctxKeys.length > 0) {
      lines.push(`  ${dim}Context:${reset}`)
      for (const key of ctxKeys) {
        lines.push(`    ${dim}${key}:${reset} ${String(error.context[key])}`)
      }
    }

    if (error.details !== undefined) {
      lines.push(`  ${dim}Details: ${JSON.stringify(error.details)}${reset}`)
    }

    if (error.cause instanceof Error) {
      lines.push(
        `  ${dim}Caused by: ${error.cause.name}: ${error.cause.message}${reset}`,
      )
    }

    // Append ValidationError field errors if applicable
    if (error instanceof ValidationError) {
      const fieldKeys = Object.keys(error.fieldErrors)
      if (fieldKeys.length > 0) {
        lines.push(`  ${dim}Field errors:${reset}`)
        for (const key of fieldKeys) {
          lines.push(`    ${yellow}${key}${reset}: ${error.fieldErrors[key]}`)
        }
      }
    }

    // Append NetworkError specifics if applicable
    if (error instanceof NetworkError) {
      if (error.method) lines.push(`  ${dim}Method: ${error.method}${reset}`)
      if (error.url) lines.push(`  ${dim}URL: ${error.url}${reset}`)
    }

    return lines.join('\n')
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Global error handler
// ──────────────────────────────────────────────────────────────────────────────

export interface HandleErrorOptions {
  /** Output mode. Defaults to `'terminal'` when stdout is a TTY, `'json'` otherwise. */
  mode?: ErrorFormatMode
  /** Whether to include the stack trace (terminal/text only). Default `false`. */
  includeStack?: boolean
  /** Stream to write to. Default `process.stderr`. */
  stream?: NodeJS.WritableStream
}

export interface JsonErrorResponse {
  error: {
    name: string
    message: string
    code: string
    statusCode: number
    timestamp: string
    suggestion?: string
    docsUrl?: string
    requestId?: string
    context?: ErrorContext
    details?: unknown
  }
}

/**
 * Top-level error handler suitable for CLI tools and HTTP error middleware.
 *
 * - In terminal mode it prints a pretty coloured error to stderr.
 * - In JSON mode it returns a structured object you can send as an HTTP body.
 *
 * Unknown errors are automatically wrapped via `wrapError()`.
 */
export function handleError(
  error: unknown,
  options: HandleErrorOptions = {},
): JsonErrorResponse | void {
  const vkError = isVibeKitError(error) ? error : wrapError(error)

  const isTTY =
    typeof process !== 'undefined' &&
    typeof process.stdout !== 'undefined' &&
    'isTTY' in process.stdout &&
    process.stdout.isTTY === true

  const mode = options.mode ?? (isTTY ? 'terminal' : 'json')

  if (mode === 'json') {
    return { error: vkError.toJSON() as JsonErrorResponse['error'] }
  }

  const formatted = ErrorFormatter.format(vkError, mode)
  const stream = options.stream ?? process.stderr

  stream.write(formatted + '\n')

  if (options.includeStack && vkError.stack) {
    const { dim, reset } = ansi
    const stackPrefix = mode === 'terminal' ? dim : ''
    const stackSuffix = mode === 'terminal' ? reset : ''
    stream.write(`${stackPrefix}${vkError.stack}${stackSuffix}\n`)
  }
}
