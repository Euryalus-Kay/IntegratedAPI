// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Billing & Payments Routes
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ValidationError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:billing')

const billingRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// Plan Definitions
// ──────────────────────────────────────────────────────────────────────────────

interface PlanDefinition {
  id: string
  name: string
  slug: string
  price: number
  currency: string
  interval: 'month' | 'year'
  features: string[]
  limits: {
    mau: number
    storage: number       // bytes
    bandwidth: number     // bytes/month
    databases: number
    emailsPerMonth: number
    apiRequestsPerDay: number
  }
}

const plans: PlanDefinition[] = [
  {
    id: 'plan_free',
    name: 'Free',
    slug: 'free',
    price: 0,
    currency: 'USD',
    interval: 'month',
    features: [
      'Up to 1,000 MAU',
      '1 GB storage',
      '10 GB bandwidth/month',
      '1 database',
      '100 emails/month',
      '10,000 API requests/day',
    ],
    limits: {
      mau: 1_000,
      storage: 1_073_741_824,         // 1 GB
      bandwidth: 10_737_418_240,      // 10 GB
      databases: 1,
      emailsPerMonth: 100,
      apiRequestsPerDay: 10_000,
    },
  },
  {
    id: 'plan_pro',
    name: 'Pro',
    slug: 'pro',
    price: 29,
    currency: 'USD',
    interval: 'month',
    features: [
      'Up to 50,000 MAU',
      '50 GB storage',
      '200 GB bandwidth/month',
      '5 databases',
      '5,000 emails/month',
      '500,000 API requests/day',
    ],
    limits: {
      mau: 50_000,
      storage: 53_687_091_200,        // 50 GB
      bandwidth: 214_748_364_800,     // 200 GB
      databases: 5,
      emailsPerMonth: 5_000,
      apiRequestsPerDay: 500_000,
    },
  },
  {
    id: 'plan_team',
    name: 'Team',
    slug: 'team',
    price: 99,
    currency: 'USD',
    interval: 'month',
    features: [
      'Up to 200,000 MAU',
      '200 GB storage',
      '1 TB bandwidth/month',
      '20 databases',
      '25,000 emails/month',
      '2,000,000 API requests/day',
    ],
    limits: {
      mau: 200_000,
      storage: 214_748_364_800,        // 200 GB
      bandwidth: 1_099_511_627_776,    // 1 TB
      databases: 20,
      emailsPerMonth: 25_000,
      apiRequestsPerDay: 2_000_000,
    },
  },
  {
    id: 'plan_enterprise',
    name: 'Enterprise',
    slug: 'enterprise',
    price: 499,
    currency: 'USD',
    interval: 'month',
    features: [
      'Unlimited MAU',
      '1 TB storage',
      '10 TB bandwidth/month',
      'Unlimited databases',
      '100,000 emails/month',
      'Unlimited API requests',
      'Dedicated support',
      'Custom SLA',
    ],
    limits: {
      mau: -1,                          // unlimited
      storage: 1_099_511_627_776,       // 1 TB
      bandwidth: 10_995_116_277_760,    // 10 TB
      databases: -1,                    // unlimited
      emailsPerMonth: 100_000,
      apiRequestsPerDay: -1,            // unlimited
    },
  },
]

// ──────────────────────────────────────────────────────────────────────────────
// Usage tracking
// ──────────────────────────────────────────────────────────────────────────────

interface UsageRecord {
  projectId: string
  period: string  // YYYY-MM
  mau: number
  storageUsed: number
  bandwidthUsed: number
  emailsSent: number
  apiRequests: number
  databaseCount: number
  updatedAt: string
}

const usageRecords = new Map<string, UsageRecord>()

interface InvoiceRecord {
  id: string
  projectId: string
  period: string
  amount: number
  currency: string
  status: 'draft' | 'pending' | 'paid' | 'overdue' | 'void'
  lineItems: Array<{ description: string; amount: number }>
  createdAt: string
  paidAt?: string
}

const invoices: InvoiceRecord[] = []

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/billing/plans — List all available plans.
 */
billingRoutes.get('/plans', (c) => {
  return c.json({
    data: plans,
    total: plans.length,
  })
})

/**
 * GET /api/v1/billing/plans/:slug — Get details of a specific plan.
 */
billingRoutes.get('/plans/:slug', (c) => {
  const slug = c.req.param('slug')
  const plan = plans.find((p) => p.slug === slug)

  if (!plan) {
    throw new VibeKitError(`Plan not found: ${slug}`, {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 404,
      suggestion: 'Use GET /api/v1/billing/plans to list available plans.',
    })
  }

  return c.json({ data: plan })
})

/**
 * GET /api/v1/billing/usage — Get current usage for the project.
 */
billingRoutes.get('/usage', (c) => {
  const projectId = c.get('projectId') ?? 'default'
  const now = new Date()
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const usage = usageRecords.get(`${projectId}:${period}`) ?? {
    projectId,
    period,
    mau: 0,
    storageUsed: 0,
    bandwidthUsed: 0,
    emailsSent: 0,
    apiRequests: 0,
    databaseCount: 0,
    updatedAt: new Date().toISOString(),
  }

  // Get current plan limits
  const project = c.get('project')
  const currentPlan = plans.find((p) => p.slug === (project?.plan ?? 'free'))

  return c.json({
    data: {
      usage,
      limits: currentPlan?.limits ?? plans[0].limits,
      plan: currentPlan?.slug ?? 'free',
    },
  })
})

/**
 * GET /api/v1/billing/invoices — List invoices for the project.
 */
billingRoutes.get('/invoices', (c) => {
  const projectId = c.get('projectId') ?? 'default'
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)

  const projectInvoices = invoices
    .filter((inv) => inv.projectId === projectId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const paginated = projectInvoices.slice(offset, offset + limit)

  return c.json({
    data: paginated,
    total: projectInvoices.length,
    limit,
    offset,
  })
})

/**
 * GET /api/v1/billing/invoices/:id — Get a specific invoice.
 */
billingRoutes.get('/invoices/:id', (c) => {
  const id = c.req.param('id')
  const invoice = invoices.find((inv) => inv.id === id)

  if (!invoice) {
    throw new VibeKitError(`Invoice not found: ${id}`, {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 404,
    })
  }

  return c.json({ data: invoice })
})

/**
 * POST /api/v1/billing/subscribe — Subscribe to a plan or change plans.
 *
 * Body: { plan: string }
 */
billingRoutes.post('/subscribe', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  if (!body.plan || typeof body.plan !== 'string') {
    throw new ValidationError('Plan slug is required', {
      code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
      fieldErrors: { plan: 'A valid plan slug is required (free, pro, team, enterprise)' },
    })
  }

  const plan = plans.find((p) => p.slug === body.plan)
  if (!plan) {
    throw new VibeKitError(`Plan not found: ${body.plan}`, {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 404,
      suggestion: `Available plans: ${plans.map((p) => p.slug).join(', ')}`,
    })
  }

  const projectId = c.get('projectId') ?? 'default'

  log.info('Plan subscription changed', { projectId, plan: plan.slug })

  return c.json({
    data: {
      projectId,
      plan: plan.slug,
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  })
})

export { billingRoutes }
