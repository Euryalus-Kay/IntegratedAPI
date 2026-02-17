// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — API Key Authentication Middleware
// ──────────────────────────────────────────────────────────────────────────────

import { createMiddleware } from 'hono/factory'
import type { Context, MiddlewareHandler } from 'hono'
import { VibeKitError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:api-auth')

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface ApiKeyRecord {
  id: string
  key: string
  projectId: string
  name: string
  scopes: string[]
  createdAt: string
  expiresAt?: string
  revokedAt?: string
}

export interface ProjectRecord {
  id: string
  name: string
  slug: string
  ownerId: string
  region: string
  plan: 'free' | 'pro' | 'team' | 'enterprise'
  settings: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface AuthContext {
  apiKey: ApiKeyRecord
  project: ProjectRecord
}

// ──────────────────────────────────────────────────────────────────────────────
// In-memory API key store (production would use a database)
// ──────────────────────────────────────────────────────────────────────────────

const apiKeys = new Map<string, ApiKeyRecord>()
const projects = new Map<string, ProjectRecord>()

/**
 * Register an API key for authentication. In production this would be backed
 * by a database; this in-memory store is used for the server runtime.
 */
export function registerApiKey(record: ApiKeyRecord): void {
  apiKeys.set(record.key, record)
}

/**
 * Register a project record.
 */
export function registerProject(record: ProjectRecord): void {
  projects.set(record.id, record)
}

/**
 * Get a project by ID.
 */
export function getProject(projectId: string): ProjectRecord | undefined {
  return projects.get(projectId)
}

/**
 * Get all projects.
 */
export function getAllProjects(): ProjectRecord[] {
  return Array.from(projects.values())
}

/**
 * Remove a project.
 */
export function removeProject(projectId: string): boolean {
  return projects.delete(projectId)
}

/**
 * Seed a default API key from environment variables. Called at server startup.
 * Expects VIBEKIT_API_KEY and optionally VIBEKIT_PROJECT_ID.
 */
export function seedFromEnv(): void {
  const envKey = process.env.VIBEKIT_API_KEY
  if (!envKey) return

  const projectId = process.env.VIBEKIT_PROJECT_ID ?? 'default'

  // Seed a default project if none exists
  if (!projects.has(projectId)) {
    registerProject({
      id: projectId,
      name: process.env.VIBEKIT_PROJECT_NAME ?? 'Default Project',
      slug: process.env.VIBEKIT_PROJECT_SLUG ?? 'default',
      ownerId: 'system',
      region: process.env.VIBEKIT_REGION ?? 'us-east-1',
      plan: 'pro',
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
  }

  registerApiKey({
    id: 'key_default',
    key: envKey,
    projectId,
    name: 'Default API Key',
    scopes: ['*'],
    createdAt: new Date().toISOString(),
  })

  log.info('Seeded API key from environment', { projectId })
}

// ──────────────────────────────────────────────────────────────────────────────
// Validate an API key
// ──────────────────────────────────────────────────────────────────────────────

function validateApiKey(key: string): ApiKeyRecord {
  const record = apiKeys.get(key)

  if (!record) {
    throw new VibeKitError('Invalid API key', {
      code: ErrorCodes.AUTH_UNAUTHORIZED,
      statusCode: 401,
      suggestion: 'Provide a valid API key via the Authorization header (Bearer <key>) or X-API-Key header.',
    })
  }

  if (record.revokedAt) {
    throw new VibeKitError('API key has been revoked', {
      code: ErrorCodes.AUTH_UNAUTHORIZED,
      statusCode: 401,
      suggestion: 'Generate a new API key from the VibeKit dashboard.',
    })
  }

  if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
    throw new VibeKitError('API key has expired', {
      code: ErrorCodes.AUTH_SESSION_EXPIRED,
      statusCode: 401,
      suggestion: 'Generate a new API key from the VibeKit dashboard.',
    })
  }

  return record
}

// ──────────────────────────────────────────────────────────────────────────────
// Extract API key from request
// ──────────────────────────────────────────────────────────────────────────────

function extractApiKey(c: Context): string | null {
  // 1. Authorization: Bearer <key>
  const authHeader = c.req.header('Authorization')
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1]
  }

  // 2. X-API-Key header
  const xApiKey = c.req.header('X-API-Key')
  if (xApiKey) return xApiKey

  // 3. Query parameter (least preferred, for webhook callbacks etc.)
  const queryKey = c.req.query('api_key')
  if (queryKey) return queryKey

  return null
}

// ──────────────────────────────────────────────────────────────────────────────
// Resolve project context from header or query
// ──────────────────────────────────────────────────────────────────────────────

function resolveProjectId(c: Context, apiKeyRecord: ApiKeyRecord): string {
  // Explicit project selection via header or query
  const headerProjectId = c.req.header('X-Project-ID')
  const queryProjectId = c.req.query('project_id')
  const projectId = headerProjectId || queryProjectId || apiKeyRecord.projectId

  return projectId
}

// ──────────────────────────────────────────────────────────────────────────────
// Middleware
// ──────────────────────────────────────────────────────────────────────────────

/**
 * API key authentication middleware.
 *
 * Extracts the API key from the request, validates it, resolves the
 * associated project, and stores both on the Hono context for downstream
 * route handlers.
 *
 * Access in handlers via:
 * ```ts
 * const auth = c.get('auth') as AuthContext
 * ```
 */
export const apiAuthMiddleware: MiddlewareHandler = createMiddleware<AppEnv>(async (c, next) => {
  const rawKey = extractApiKey(c)

  if (!rawKey) {
    throw new VibeKitError('Authentication required. No API key provided.', {
      code: ErrorCodes.AUTH_UNAUTHORIZED,
      statusCode: 401,
      suggestion: 'Include your API key via Authorization: Bearer <key> or X-API-Key header.',
      docsUrl: 'https://vibekit.dev/docs/api/authentication',
    })
  }

  const apiKeyRecord = validateApiKey(rawKey)
  const projectId = resolveProjectId(c, apiKeyRecord)

  // Validate that the project exists
  const project = projects.get(projectId)
  if (!project) {
    throw new VibeKitError(`Project not found: ${projectId}`, {
      code: ErrorCodes.PROJECT_NOT_FOUND,
      statusCode: 404,
      suggestion: 'Verify the project ID in X-Project-ID header or project_id query parameter.',
    })
  }

  // Validate that the API key has access to this project
  if (apiKeyRecord.projectId !== projectId && !apiKeyRecord.scopes.includes('*')) {
    throw new VibeKitError('API key does not have access to this project', {
      code: ErrorCodes.AUTH_UNAUTHORIZED,
      statusCode: 403,
      suggestion: 'Use an API key associated with this project.',
    })
  }

  // Store auth context for downstream handlers
  const authContext: AuthContext = { apiKey: apiKeyRecord, project }
  c.set('auth', authContext)
  c.set('projectId', projectId)
  c.set('project', project)

  await next()
})

/**
 * Optional auth middleware that does not throw if no API key is present.
 * Useful for health-check endpoints that can optionally include project context.
 */
export const optionalAuthMiddleware: MiddlewareHandler = createMiddleware<AppEnv>(async (c, next) => {
  const rawKey = extractApiKey(c)

  if (rawKey) {
    try {
      const apiKeyRecord = validateApiKey(rawKey)
      const projectId = resolveProjectId(c, apiKeyRecord)
      const project = projects.get(projectId)

      if (project) {
        c.set('auth', { apiKey: apiKeyRecord, project })
        c.set('projectId', projectId)
        c.set('project', project)
      }
    } catch {
      // Silently ignore auth errors for optional auth
    }
  }

  await next()
})
