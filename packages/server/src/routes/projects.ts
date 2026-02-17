// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Project Management Routes
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ValidationError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'
import {
  registerProject,
  getProject,
  getAllProjects,
  removeProject,
  type ProjectRecord,
} from '../middleware/api-auth.js'

const log = createLogger('server:projects')

const projectRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

function generateProjectId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).substring(2, 10)
  return `proj_${ts}${rand}`
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function validateProjectInput(body: Record<string, unknown>): {
  name: string
  region?: string
  plan?: ProjectRecord['plan']
  settings?: Record<string, unknown>
} {
  const errors: Record<string, string> = {}

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    errors.name = 'Project name is required and must be a non-empty string'
  } else if (body.name.length > 100) {
    errors.name = 'Project name must be 100 characters or fewer'
  }

  if (body.region !== undefined && typeof body.region !== 'string') {
    errors.region = 'Region must be a string'
  }

  const validPlans = ['free', 'pro', 'team', 'enterprise']
  if (body.plan !== undefined && !validPlans.includes(body.plan as string)) {
    errors.plan = `Plan must be one of: ${validPlans.join(', ')}`
  }

  if (body.settings !== undefined && (typeof body.settings !== 'object' || body.settings === null)) {
    errors.settings = 'Settings must be an object'
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid project data', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: errors,
    })
  }

  return {
    name: (body.name as string).trim(),
    region: body.region as string | undefined,
    plan: body.plan as ProjectRecord['plan'] | undefined,
    settings: body.settings as Record<string, unknown> | undefined,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/projects — List all projects accessible by the current API key.
 */
projectRoutes.get('/', (c) => {
  const allProjects = getAllProjects()

  log.info('Listed projects', { count: allProjects.length })

  return c.json({
    data: allProjects,
    total: allProjects.length,
  })
})

/**
 * POST /api/v1/projects — Create a new project.
 */
projectRoutes.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const input = validateProjectInput(body)

  const now = new Date().toISOString()
  const project: ProjectRecord = {
    id: generateProjectId(),
    name: input.name,
    slug: body.slug ? String(body.slug) : slugify(input.name),
    ownerId: c.get('auth')?.apiKey?.projectId ?? 'system',
    region: input.region ?? process.env.VIBEKIT_REGION ?? 'us-east-1',
    plan: input.plan ?? 'free',
    settings: input.settings ?? {},
    createdAt: now,
    updatedAt: now,
  }

  registerProject(project)

  log.info('Created project', { projectId: project.id, name: project.name })

  return c.json({ data: project }, 201)
})

/**
 * GET /api/v1/projects/:id — Get a project by ID.
 */
projectRoutes.get('/:id', (c) => {
  const id = c.req.param('id')
  const project = getProject(id)

  if (!project) {
    throw new VibeKitError(`Project not found: ${id}`, {
      code: ErrorCodes.PROJECT_NOT_FOUND,
      statusCode: 404,
      suggestion: 'Verify the project ID is correct. Use GET /api/v1/projects to list all projects.',
    })
  }

  return c.json({ data: project })
})

/**
 * PATCH /api/v1/projects/:id — Update a project.
 */
projectRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const existing = getProject(id)

  if (!existing) {
    throw new VibeKitError(`Project not found: ${id}`, {
      code: ErrorCodes.PROJECT_NOT_FOUND,
      statusCode: 404,
    })
  }

  const body = await c.req.json<Record<string, unknown>>()
  const errors: Record<string, string> = {}

  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      errors.name = 'Project name must be a non-empty string'
    } else if (body.name.length > 100) {
      errors.name = 'Project name must be 100 characters or fewer'
    }
  }

  const validPlans = ['free', 'pro', 'team', 'enterprise']
  if (body.plan !== undefined && !validPlans.includes(body.plan as string)) {
    errors.plan = `Plan must be one of: ${validPlans.join(', ')}`
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid project update data', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: errors,
    })
  }

  const updated: ProjectRecord = {
    ...existing,
    name: body.name !== undefined ? (body.name as string).trim() : existing.name,
    slug: body.slug !== undefined ? String(body.slug) : existing.slug,
    region: body.region !== undefined ? String(body.region) : existing.region,
    plan: body.plan !== undefined ? (body.plan as ProjectRecord['plan']) : existing.plan,
    settings: body.settings !== undefined
      ? { ...existing.settings, ...(body.settings as Record<string, unknown>) }
      : existing.settings,
    updatedAt: new Date().toISOString(),
  }

  registerProject(updated)

  log.info('Updated project', { projectId: id })

  return c.json({ data: updated })
})

/**
 * DELETE /api/v1/projects/:id — Delete a project.
 */
projectRoutes.delete('/:id', (c) => {
  const id = c.req.param('id')
  const existing = getProject(id)

  if (!existing) {
    throw new VibeKitError(`Project not found: ${id}`, {
      code: ErrorCodes.PROJECT_NOT_FOUND,
      statusCode: 404,
    })
  }

  removeProject(id)

  log.info('Deleted project', { projectId: id })

  return c.json({ data: { id, deleted: true } })
})

export { projectRoutes }
