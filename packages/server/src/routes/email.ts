// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Email Operation Routes
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ValidationError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:email')

const emailRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// In-memory email log & templates (production would integrate with a provider)
// ──────────────────────────────────────────────────────────────────────────────

interface EmailRecord {
  id: string
  to: string
  from: string
  subject: string
  body: string
  html?: string
  template?: string
  templateVars?: Record<string, unknown>
  status: 'queued' | 'sent' | 'delivered' | 'failed'
  sentAt?: string
  createdAt: string
}

interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  html: string
  variables: string[]
  createdAt: string
  updatedAt: string
}

const emailLog: EmailRecord[] = []
const templates = new Map<string, EmailTemplate>()

// Seed default templates
templates.set('welcome', {
  id: 'tpl_welcome',
  name: 'welcome',
  subject: 'Welcome to {{appName}}!',
  body: 'Hi {{name}}, welcome to {{appName}}!',
  html: '<h1>Welcome, {{name}}!</h1><p>Thanks for joining {{appName}}.</p>',
  variables: ['name', 'appName'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

templates.set('verification', {
  id: 'tpl_verification',
  name: 'verification',
  subject: 'Your verification code',
  body: 'Your verification code is: {{code}}',
  html: '<p>Your verification code is: <strong>{{code}}</strong></p><p>This code expires in {{expiresIn}} minutes.</p>',
  variables: ['code', 'expiresIn'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

templates.set('password-reset', {
  id: 'tpl_password_reset',
  name: 'password-reset',
  subject: 'Reset your password',
  body: 'Click the link to reset your password: {{resetUrl}}',
  html: '<p>Click <a href="{{resetUrl}}">here</a> to reset your password.</p><p>This link expires in {{expiresIn}} minutes.</p>',
  variables: ['resetUrl', 'expiresIn'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
})

function generateEmailId(): string {
  return `email_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`
}

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/email/send — Send an email.
 *
 * Body: { to, subject, body, html?, from?, template?, vars? }
 */
emailRoutes.post('/send', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  const errors: Record<string, string> = {}

  if (!body.to || typeof body.to !== 'string') {
    errors.to = 'Recipient email address is required'
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.to as string)) {
      errors.to = 'Must be a valid email address'
    }
  }

  // If using a template, subject and body come from the template
  if (!body.template) {
    if (!body.subject || typeof body.subject !== 'string') {
      errors.subject = 'Subject is required (or use a template)'
    }
    if (!body.body || typeof body.body !== 'string') {
      errors.body = 'Email body is required (or use a template)'
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid email data', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: errors,
    })
  }

  let subject = body.subject as string
  let textBody = body.body as string
  let html = body.html as string | undefined

  // Apply template if specified
  if (body.template && typeof body.template === 'string') {
    const template = templates.get(body.template)
    if (!template) {
      throw new VibeKitError(`Email template not found: ${body.template}`, {
        code: ErrorCodes.VALIDATION_FAILED,
        statusCode: 404,
        suggestion: 'Use GET /api/v1/email/templates to list available templates.',
      })
    }

    const vars = (body.vars as Record<string, unknown>) ?? {}

    // Replace template variables
    subject = template.subject.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`))
    textBody = template.body.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`))
    html = template.html.replace(/\{\{(\w+)\}\}/g, (_, key) => String(vars[key] ?? `{{${key}}}`))
  }

  const defaultFrom = process.env.VIBEKIT_EMAIL_FROM ?? 'noreply@vibekit.dev'

  const record: EmailRecord = {
    id: generateEmailId(),
    to: body.to as string,
    from: (body.from as string) ?? defaultFrom,
    subject,
    body: textBody,
    html,
    template: body.template as string | undefined,
    templateVars: body.vars as Record<string, unknown> | undefined,
    status: 'queued',
    createdAt: new Date().toISOString(),
  }

  // In production, this would send via the configured email provider (Resend, SES, etc.)
  if (process.env.VIBEKIT_EMAIL_API_KEY) {
    // Simulate sending
    record.status = 'sent'
    record.sentAt = new Date().toISOString()
  }

  emailLog.push(record)

  // Keep email log bounded
  if (emailLog.length > 500) {
    emailLog.splice(0, emailLog.length - 500)
  }

  log.info('Email sent', {
    emailId: record.id,
    to: record.to,
    subject: record.subject,
    template: record.template,
    status: record.status,
  })

  return c.json({ data: record }, 201)
})

/**
 * GET /api/v1/email/templates — List all email templates.
 */
emailRoutes.get('/templates', (c) => {
  const allTemplates = Array.from(templates.values())

  return c.json({
    data: allTemplates,
    total: allTemplates.length,
  })
})

/**
 * GET /api/v1/email/templates/:name — Get a specific email template.
 */
emailRoutes.get('/templates/:name', (c) => {
  const name = c.req.param('name')
  const template = templates.get(name)

  if (!template) {
    throw new VibeKitError(`Template not found: ${name}`, {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 404,
      suggestion: 'Use GET /api/v1/email/templates to list available templates.',
    })
  }

  return c.json({ data: template })
})

/**
 * POST /api/v1/email/templates — Create a new email template.
 */
emailRoutes.post('/templates', async (c) => {
  const body = await c.req.json<Record<string, unknown>>()

  const errors: Record<string, string> = {}

  if (!body.name || typeof body.name !== 'string') {
    errors.name = 'Template name is required'
  }
  if (!body.subject || typeof body.subject !== 'string') {
    errors.subject = 'Subject template is required'
  }
  if (!body.body || typeof body.body !== 'string') {
    errors.body = 'Body template is required'
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError('Invalid template data', {
      code: ErrorCodes.VALIDATION_FAILED,
      fieldErrors: errors,
    })
  }

  const name = body.name as string

  if (templates.has(name)) {
    throw new VibeKitError(`Template already exists: ${name}`, {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 409,
      suggestion: 'Use a different name or update the existing template.',
    })
  }

  // Extract variables from templates ({{varName}} pattern)
  const allText = `${body.subject} ${body.body} ${body.html ?? ''}`
  const varMatches = allText.matchAll(/\{\{(\w+)\}\}/g)
  const variables = [...new Set([...varMatches].map((m) => m[1]))]

  const now = new Date().toISOString()
  const template: EmailTemplate = {
    id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
    name,
    subject: body.subject as string,
    body: body.body as string,
    html: (body.html as string) ?? (body.body as string),
    variables,
    createdAt: now,
    updatedAt: now,
  }

  templates.set(name, template)

  log.info('Template created', { name, variables })

  return c.json({ data: template }, 201)
})

/**
 * PUT /api/v1/email/templates/:name — Update an email template.
 */
emailRoutes.put('/templates/:name', async (c) => {
  const name = c.req.param('name')
  const existing = templates.get(name)

  if (!existing) {
    throw new VibeKitError(`Template not found: ${name}`, {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 404,
    })
  }

  const body = await c.req.json<Record<string, unknown>>()

  const subject = typeof body.subject === 'string' ? body.subject : existing.subject
  const textBody = typeof body.body === 'string' ? body.body : existing.body
  const html = typeof body.html === 'string' ? body.html : existing.html

  // Re-extract variables
  const allText = `${subject} ${textBody} ${html}`
  const varMatches = allText.matchAll(/\{\{(\w+)\}\}/g)
  const variables = [...new Set([...varMatches].map((m) => m[1]))]

  const updated: EmailTemplate = {
    ...existing,
    subject,
    body: textBody,
    html,
    variables,
    updatedAt: new Date().toISOString(),
  }

  templates.set(name, updated)

  log.info('Template updated', { name })

  return c.json({ data: updated })
})

/**
 * DELETE /api/v1/email/templates/:name — Delete an email template.
 */
emailRoutes.delete('/templates/:name', (c) => {
  const name = c.req.param('name')

  if (!templates.has(name)) {
    throw new VibeKitError(`Template not found: ${name}`, {
      code: ErrorCodes.VALIDATION_FAILED,
      statusCode: 404,
    })
  }

  templates.delete(name)

  log.info('Template deleted', { name })

  return c.json({ data: { name, deleted: true } })
})

export { emailRoutes }
