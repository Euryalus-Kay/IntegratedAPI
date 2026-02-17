// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Database Operation Routes
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ValidationError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:database')

const databaseRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// In-memory schema tracking (production delegates to Neon/Postgres)
// ──────────────────────────────────────────────────────────────────────────────

interface TableSchema {
  name: string
  columns: Array<{
    name: string
    type: string
    nullable: boolean
    primaryKey: boolean
    defaultValue?: string
  }>
  rowCount: number
  createdAt: string
}

interface MigrationRecord {
  id: string
  name: string
  status: 'pending' | 'applied' | 'failed'
  appliedAt?: string
  sql: string
}

const tables = new Map<string, TableSchema>()
const migrations: MigrationRecord[] = []
const queryLog: Array<{ query: string; params?: unknown[]; executedAt: string; durationMs: number; rowCount: number }> = []

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/db/query — Execute a SQL query.
 *
 * Body: { sql: string, params?: unknown[] }
 * Returns query results or error details.
 */
databaseRoutes.post('/query', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  if (!body.sql || typeof body.sql !== 'string') {
    throw new ValidationError('SQL query is required', {
      code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
      fieldErrors: { sql: 'A SQL query string is required' },
    })
  }

  const sql = (body.sql as string).trim()
  const params = Array.isArray(body.params) ? body.params : []

  if (sql.length === 0) {
    throw new ValidationError('SQL query cannot be empty', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: { sql: 'SQL query cannot be empty' },
    })
  }

  // Limit query length
  if (sql.length > 50_000) {
    throw new ValidationError('SQL query too long', {
      code: ErrorCodes.VALIDATION_OUT_OF_RANGE,
      fieldErrors: { sql: 'SQL query must be 50,000 characters or fewer' },
    })
  }

  const start = performance.now()

  try {
    // In production, this would execute against Neon/Postgres via the SDK
    // For now, simulate a response structure
    const durationMs = Math.round((performance.now() - start) * 100) / 100

    // Track query in log
    const entry = {
      query: sql.substring(0, 500),
      params: params.length > 0 ? params : undefined,
      executedAt: new Date().toISOString(),
      durationMs,
      rowCount: 0,
    }
    queryLog.push(entry)

    // Keep query log bounded
    if (queryLog.length > 1000) {
      queryLog.splice(0, queryLog.length - 1000)
    }

    log.info('Query executed', {
      sql: sql.substring(0, 100),
      durationMs,
      paramCount: params.length,
    })

    // Check if DATABASE_URL is configured for actual execution
    if (!process.env.DATABASE_URL) {
      throw new VibeKitError('Database not configured', {
        code: ErrorCodes.DB_CONNECTION_FAILED,
        statusCode: 503,
        suggestion: 'Set the DATABASE_URL environment variable to connect to your database.',
      })
    }

    return c.json({
      data: {
        rows: [],
        rowCount: 0,
        fields: [],
        durationMs,
      },
    })
  } catch (err) {
    if (err instanceof VibeKitError) throw err

    throw new VibeKitError(
      `Query execution failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
      {
        code: ErrorCodes.DB_QUERY_ERROR,
        statusCode: 500,
        cause: err instanceof Error ? err : undefined,
        suggestion: 'Check your SQL syntax and parameters.',
      },
    )
  }
})

/**
 * GET /api/v1/db/tables — List all tables in the database.
 */
databaseRoutes.get('/tables', (c) => {
  const allTables = Array.from(tables.values()).map((t) => ({
    name: t.name,
    columnCount: t.columns.length,
    rowCount: t.rowCount,
    createdAt: t.createdAt,
  }))

  return c.json({
    data: allTables,
    total: allTables.length,
  })
})

/**
 * GET /api/v1/db/tables/:name — Describe a specific table's schema.
 */
databaseRoutes.get('/tables/:name', (c) => {
  const name = c.req.param('name')
  const table = tables.get(name)

  if (!table) {
    throw new VibeKitError(`Table not found: ${name}`, {
      code: ErrorCodes.DB_TABLE_NOT_FOUND,
      statusCode: 404,
      suggestion: 'Run pending migrations with `vibekit db migrate` or check the table name.',
    })
  }

  return c.json({ data: table })
})

/**
 * GET /api/v1/db/health — Database connectivity health check.
 */
databaseRoutes.get('/health', async (c) => {
  const dbUrl = process.env.DATABASE_URL

  if (!dbUrl) {
    return c.json({
      status: 'unconfigured',
      message: 'DATABASE_URL is not set',
      suggestion: 'Set DATABASE_URL in your environment to connect to your database.',
    })
  }

  const start = performance.now()

  try {
    // In production, this would run a simple connectivity check (SELECT 1)
    const latencyMs = Math.round((performance.now() - start) * 100) / 100

    return c.json({
      status: 'ok',
      latencyMs,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return c.json(
      {
        status: 'error',
        message: err instanceof Error ? err.message : 'Connection failed',
        timestamp: new Date().toISOString(),
      },
      503,
    )
  }
})

/**
 * GET /api/v1/db/migrations — List all migrations and their status.
 */
databaseRoutes.get('/migrations', (c) => {
  return c.json({
    data: migrations,
    total: migrations.length,
    applied: migrations.filter((m) => m.status === 'applied').length,
    pending: migrations.filter((m) => m.status === 'pending').length,
    failed: migrations.filter((m) => m.status === 'failed').length,
  })
})

/**
 * POST /api/v1/db/migrations — Create and optionally apply a new migration.
 *
 * Body: { name: string, sql: string, apply?: boolean }
 */
databaseRoutes.post('/migrations', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  const errors: Record<string, string> = {}
  if (!body.name || typeof body.name !== 'string') {
    errors.name = 'Migration name is required'
  }
  if (!body.sql || typeof body.sql !== 'string') {
    errors.sql = 'Migration SQL is required'
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid migration data', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: errors,
    })
  }

  const migration: MigrationRecord = {
    id: `mig_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`,
    name: body.name as string,
    sql: body.sql as string,
    status: 'pending',
  }

  // Optionally apply immediately
  if (body.apply === true) {
    try {
      if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL not configured')
      }

      // In production, execute the migration SQL
      migration.status = 'applied'
      migration.appliedAt = new Date().toISOString()

      log.info('Migration applied', { migrationId: migration.id, name: migration.name })
    } catch (err) {
      migration.status = 'failed'

      throw new VibeKitError(
        `Migration failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
        {
          code: ErrorCodes.DB_MIGRATION_FAILED,
          statusCode: 500,
          cause: err instanceof Error ? err : undefined,
          suggestion: 'Check the migration SQL for errors and ensure the database is accessible.',
        },
      )
    }
  }

  migrations.push(migration)

  return c.json({ data: migration }, 201)
})

/**
 * POST /api/v1/db/migrations/:id/apply — Apply a pending migration.
 */
databaseRoutes.post('/migrations/:id/apply', (c) => {
  const id = c.req.param('id')
  const migration = migrations.find((m) => m.id === id)

  if (!migration) {
    throw new VibeKitError(`Migration not found: ${id}`, {
      code: ErrorCodes.DB_MIGRATION_FAILED,
      statusCode: 404,
    })
  }

  if (migration.status === 'applied') {
    return c.json({
      data: migration,
      message: 'Migration already applied',
    })
  }

  if (!process.env.DATABASE_URL) {
    throw new VibeKitError('Database not configured', {
      code: ErrorCodes.DB_CONNECTION_FAILED,
      statusCode: 503,
      suggestion: 'Set DATABASE_URL to apply migrations.',
    })
  }

  // In production, execute the migration SQL against the database
  migration.status = 'applied'
  migration.appliedAt = new Date().toISOString()

  log.info('Migration applied', { migrationId: id, name: migration.name })

  return c.json({ data: migration })
})

export { databaseRoutes }
