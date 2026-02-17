// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Deployment Endpoints
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ValidationError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:deploy')

const deployRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// In-memory deployment tracking
// ──────────────────────────────────────────────────────────────────────────────

interface DeploymentRecord {
  id: string
  projectId: string
  version: string
  status: 'pending' | 'building' | 'deploying' | 'live' | 'failed' | 'rolled-back'
  environment: 'preview' | 'production'
  commitSha?: string
  commitMessage?: string
  branch?: string
  url?: string
  buildDurationMs?: number
  deployDurationMs?: number
  createdAt: string
  updatedAt: string
  completedAt?: string
  errorMessage?: string
}

interface DeployLogEntry {
  deploymentId: string
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  phase: 'build' | 'deploy' | 'healthcheck'
}

const deployments = new Map<string, DeploymentRecord>()
const deployLogs = new Map<string, DeployLogEntry[]>()

function generateDeployId(): string {
  return `deploy_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`
}

function addDeployLog(deploymentId: string, level: 'info' | 'warn' | 'error', message: string, phase: DeployLogEntry['phase']): void {
  const logs = deployLogs.get(deploymentId) ?? []
  logs.push({
    deploymentId,
    timestamp: new Date().toISOString(),
    level,
    message,
    phase,
  })
  deployLogs.set(deploymentId, logs)
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/deploy — Trigger a new deployment.
 *
 * Body: { environment?, commitSha?, commitMessage?, branch?, version? }
 */
deployRoutes.post('/', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()
  const projectId = c.get('projectId') ?? 'default'

  const environment = (body.environment as string) ?? 'production'
  if (environment !== 'preview' && environment !== 'production') {
    throw new ValidationError('Invalid environment', {
      code: ErrorCodes.VALIDATION_INVALID_FORMAT,
      fieldErrors: { environment: 'Must be "preview" or "production"' },
    })
  }

  // Check for any active deployment on the same environment
  for (const dep of deployments.values()) {
    if (
      dep.projectId === projectId &&
      dep.environment === environment &&
      (dep.status === 'pending' || dep.status === 'building' || dep.status === 'deploying')
    ) {
      throw new VibeKitError('A deployment is already in progress for this environment', {
        code: ErrorCodes.DEPLOY_FAILED,
        statusCode: 409,
        suggestion: 'Wait for the current deployment to complete or cancel it.',
        context: { activeDeploymentId: dep.id },
      })
    }
  }

  const deployment: DeploymentRecord = {
    id: generateDeployId(),
    projectId,
    version: (body.version as string) ?? `v${Date.now()}`,
    status: 'pending',
    environment: environment as 'preview' | 'production',
    commitSha: body.commitSha as string | undefined,
    commitMessage: body.commitMessage as string | undefined,
    branch: (body.branch as string) ?? 'main',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  deployments.set(deployment.id, deployment)

  // Simulate deployment lifecycle
  addDeployLog(deployment.id, 'info', 'Deployment created', 'build')
  addDeployLog(deployment.id, 'info', 'Starting build process...', 'build')

  // Transition to building
  deployment.status = 'building'
  deployment.updatedAt = new Date().toISOString()

  // Simulate async deployment progress (in production, this would be a background job)
  setTimeout(() => {
    const dep = deployments.get(deployment.id)
    if (!dep || dep.status !== 'building') return

    addDeployLog(dep.id, 'info', 'Build completed successfully', 'build')
    dep.buildDurationMs = Math.floor(Math.random() * 30000) + 5000
    dep.status = 'deploying'
    dep.updatedAt = new Date().toISOString()
    addDeployLog(dep.id, 'info', 'Deploying to edge network...', 'deploy')

    setTimeout(() => {
      const dep2 = deployments.get(deployment.id)
      if (!dep2 || dep2.status !== 'deploying') return

      addDeployLog(dep2.id, 'info', 'Health check passed', 'healthcheck')
      addDeployLog(dep2.id, 'info', 'Deployment is live', 'deploy')
      dep2.status = 'live'
      dep2.deployDurationMs = Math.floor(Math.random() * 15000) + 3000
      dep2.url = `https://${dep2.projectId}${dep2.environment === 'preview' ? '-preview' : ''}.vibekit.app`
      dep2.completedAt = new Date().toISOString()
      dep2.updatedAt = new Date().toISOString()
    }, 2000)
  }, 2000)

  log.info('Deployment triggered', {
    deploymentId: deployment.id,
    projectId,
    environment,
    branch: deployment.branch,
  })

  return c.json({ data: deployment }, 201)
})

/**
 * GET /api/v1/deploy — List deployments for the project.
 */
deployRoutes.get('/', (c) => {
  const projectId = c.get('projectId') ?? 'default'
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)
  const environment = c.req.query('environment')

  let projectDeployments = Array.from(deployments.values())
    .filter((d) => d.projectId === projectId)

  if (environment) {
    projectDeployments = projectDeployments.filter((d) => d.environment === environment)
  }

  projectDeployments.sort((a, b) =>
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  )

  const paginated = projectDeployments.slice(offset, offset + limit)

  return c.json({
    data: paginated,
    total: projectDeployments.length,
    limit,
    offset,
  })
})

/**
 * GET /api/v1/deploy/:id — Get deployment status.
 */
deployRoutes.get('/:id', (c) => {
  const id = c.req.param('id')
  const deployment = deployments.get(id)

  if (!deployment) {
    throw new VibeKitError(`Deployment not found: ${id}`, {
      code: ErrorCodes.DEPLOY_FAILED,
      statusCode: 404,
      suggestion: 'Use GET /api/v1/deploy to list deployments.',
    })
  }

  return c.json({ data: deployment })
})

/**
 * GET /api/v1/deploy/:id/logs — Get deployment logs.
 */
deployRoutes.get('/:id/logs', (c) => {
  const id = c.req.param('id')
  const deployment = deployments.get(id)

  if (!deployment) {
    throw new VibeKitError(`Deployment not found: ${id}`, {
      code: ErrorCodes.DEPLOY_FAILED,
      statusCode: 404,
    })
  }

  const logs = deployLogs.get(id) ?? []

  return c.json({
    data: logs,
    total: logs.length,
    deploymentId: id,
    status: deployment.status,
  })
})

/**
 * POST /api/v1/deploy/:id/rollback — Rollback a deployment.
 */
deployRoutes.post('/:id/rollback', (c) => {
  const id = c.req.param('id')
  const deployment = deployments.get(id)

  if (!deployment) {
    throw new VibeKitError(`Deployment not found: ${id}`, {
      code: ErrorCodes.DEPLOY_FAILED,
      statusCode: 404,
    })
  }

  if (deployment.status !== 'live' && deployment.status !== 'failed') {
    throw new VibeKitError('Can only rollback live or failed deployments', {
      code: ErrorCodes.DEPLOY_FAILED,
      statusCode: 400,
      suggestion: `Current status: ${deployment.status}. Wait for the deployment to complete first.`,
    })
  }

  deployment.status = 'rolled-back'
  deployment.updatedAt = new Date().toISOString()

  addDeployLog(id, 'info', 'Deployment rolled back', 'deploy')

  log.info('Deployment rolled back', { deploymentId: id, projectId: deployment.projectId })

  return c.json({ data: deployment })
})

/**
 * POST /api/v1/deploy/:id/cancel — Cancel a pending or in-progress deployment.
 */
deployRoutes.post('/:id/cancel', (c) => {
  const id = c.req.param('id')
  const deployment = deployments.get(id)

  if (!deployment) {
    throw new VibeKitError(`Deployment not found: ${id}`, {
      code: ErrorCodes.DEPLOY_FAILED,
      statusCode: 404,
    })
  }

  if (deployment.status === 'live' || deployment.status === 'rolled-back') {
    throw new VibeKitError('Cannot cancel a completed deployment', {
      code: ErrorCodes.DEPLOY_FAILED,
      statusCode: 400,
      suggestion: 'Use rollback to revert a live deployment.',
    })
  }

  deployment.status = 'failed'
  deployment.errorMessage = 'Deployment cancelled by user'
  deployment.updatedAt = new Date().toISOString()
  deployment.completedAt = new Date().toISOString()

  addDeployLog(id, 'warn', 'Deployment cancelled by user', 'deploy')

  log.info('Deployment cancelled', { deploymentId: id })

  return c.json({ data: deployment })
})

export { deployRoutes }
