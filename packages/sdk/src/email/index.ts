import { getConfig, isLocal } from '../config/index.js'
import { getTemplate, hasTemplate, listTemplates, registerTemplate, removeTemplate, renderTemplate, previewTemplate, validateTemplateData } from './templates.js'
import type { SendEmailOptions, EmailTemplate, EmailLog, EmailSendResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'
import { createLogger } from '../utils/logger.js'
import type { EmailProvider } from './providers.js'
import {
  createConsoleProvider,
  createSmtpProvider,
  createResendProvider,
  createSendGridProvider,
  createMailgunProvider,
} from './providers.js'

const log = createLogger('vibekit:email')

function resolveProductionProvider(): EmailProvider {
  const config = getConfig()
  const emailConfig = typeof config.modules.email === 'object' ? config.modules.email : null

  // 1. Resend
  const resendApiKey = process.env.RESEND_API_KEY
  if (resendApiKey) {
    log.info('Using Resend email provider')
    return createResendProvider(resendApiKey)
  }

  // 2. SMTP
  const smtpHost = process.env.SMTP_HOST
  if (smtpHost) {
    log.info('Using SMTP email provider', { host: smtpHost })
    return createSmtpProvider({
      host: smtpHost,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || '',
      },
    })
  }

  // 3. SendGrid
  const sendgridApiKey = process.env.SENDGRID_API_KEY
  if (sendgridApiKey) {
    log.info('Using SendGrid email provider')
    return createSendGridProvider(sendgridApiKey)
  }

  // 4. Mailgun
  const mailgunApiKey = process.env.MAILGUN_API_KEY
  if (mailgunApiKey) {
    const mailgunDomain = process.env.MAILGUN_DOMAIN || ''
    log.info('Using Mailgun email provider', { domain: mailgunDomain })
    return createMailgunProvider(mailgunApiKey, mailgunDomain)
  }

  // 5. Fallback: console provider with warning
  log.warn(
    'No email provider configured. Falling back to console provider. ' +
    'Set RESEND_API_KEY, SMTP_HOST, SENDGRID_API_KEY, or MAILGUN_API_KEY to enable production email delivery.'
  )
  return createConsoleProvider()
}

let _productionProvider: EmailProvider | null = null

function getProductionProvider(): EmailProvider {
  if (!_productionProvider) {
    _productionProvider = resolveProductionProvider()
  }
  return _productionProvider
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const _emailLog: EmailLog[] = []
const MAX_LOG_SIZE = 200

function addToLog(entry: EmailLog): void {
  _emailLog.unshift(entry)
  if (_emailLog.length > MAX_LOG_SIZE) {
    _emailLog.length = MAX_LOG_SIZE
  }
}

function validateEmail(emailAddr: string): void {
  if (!emailAddr || typeof emailAddr !== 'string') {
    throw new VibeKitError(
      'Email address is required and must be a string.',
      'VALIDATION_ERROR',
      400
    )
  }
  if (!EMAIL_REGEX.test(emailAddr)) {
    throw new VibeKitError(
      `Invalid email address: "${emailAddr}". Expected format: user@domain.com`,
      'VALIDATION_ERROR',
      400
    )
  }
}

function validateSendOptions(options: SendEmailOptions): void {
  if (!options.to) {
    throw new VibeKitError(
      'Email "to" field is required.',
      'VALIDATION_ERROR',
      400
    )
  }

  const recipients = Array.isArray(options.to) ? options.to : [options.to]
  for (const addr of recipients) {
    validateEmail(addr)
  }

  if (options.cc) {
    const ccList = Array.isArray(options.cc) ? options.cc : [options.cc]
    for (const addr of ccList) validateEmail(addr)
  }

  if (options.bcc) {
    const bccList = Array.isArray(options.bcc) ? options.bcc : [options.bcc]
    for (const addr of bccList) validateEmail(addr)
  }

  if (!options.subject && !options.template && !options.html && !options.text) {
    throw new VibeKitError(
      'Email must have at least one of: subject, template, html, or text.',
      'VALIDATION_ERROR',
      400
    )
  }

  if (options.template && !hasTemplate(options.template)) {
    const available = listTemplates()
    throw new VibeKitError(
      `Email template "${options.template}" not found. Available templates: ${available.join(', ')}`,
      'VALIDATION_ERROR',
      400
    )
  }
}

export const email = {
  async send(options: SendEmailOptions): Promise<EmailSendResult> {
    validateSendOptions(options)

    let subject = options.subject || ''
    let html = options.html || ''
    let text = options.text || ''

    if (options.template) {
      const tmpl = getTemplate(options.template)!
      const rendered = renderTemplate(tmpl, options.data || {})
      subject = subject || rendered.subject
      html = html || rendered.html
      text = text || rendered.text
    }

    const to = Array.isArray(options.to) ? options.to : [options.to]
    let messageId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    try {
      if (isLocal()) {
        const border = '═'.repeat(Math.max(45, subject.length + 6))
        console.log(`\n  ╔${border}╗`)
        console.log(`  ║  EMAIL SENT (local dev)${' '.repeat(border.length - 24)}║`)
        console.log(`  ║  To:      ${to.join(', ')}${' '.repeat(Math.max(0, border.length - 11 - to.join(', ').length))}║`)
        if (options.cc) {
          const cc = Array.isArray(options.cc) ? options.cc.join(', ') : options.cc
          console.log(`  ║  CC:      ${cc}${' '.repeat(Math.max(0, border.length - 11 - cc.length))}║`)
        }
        console.log(`  ║  Subject: ${subject}${' '.repeat(Math.max(0, border.length - 11 - subject.length))}║`)
        console.log(`  ║  ID:      ${messageId}${' '.repeat(Math.max(0, border.length - 11 - messageId.length))}║`)
        console.log(`  ║${'─'.repeat(border.length)}║`)
        const lines = text.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed) {
            console.log(`  ║  ${trimmed}${' '.repeat(Math.max(0, border.length - 2 - trimmed.length))}║`)
          }
        }
        console.log(`  ╚${border}╝\n`)
      } else {
        const config = getConfig()
        const emailConfig = typeof config.modules.email === 'object' ? config.modules.email : null
        const from = options.from || emailConfig?.from || process.env.EMAIL_FROM || 'noreply@example.com'

        const provider = getProductionProvider()
        const providerTags = options.tags
          ? options.tags.map(t => ({ name: t, value: 'true' }))
          : undefined
        const result = await provider.send({
          from,
          to: options.to,
          subject,
          html: html || undefined,
          text: text || undefined,
          replyTo: options.replyTo || emailConfig?.replyTo,
          tags: providerTags,
        })

        // Use the provider's message ID if available
        messageId = result.id || messageId
      }

      addToLog({
        messageId,
        to,
        subject,
        template: options.template,
        sentAt: new Date().toISOString(),
        status: 'sent',
      })

      return { messageId, accepted: to, rejected: [] }
    } catch (err) {
      if (err instanceof VibeKitError) throw err

      const error = err instanceof Error ? err.message : String(err)
      addToLog({
        messageId,
        to,
        subject,
        template: options.template,
        sentAt: new Date().toISOString(),
        status: 'failed',
        error,
      })

      throw new VibeKitError(
        `Failed to send email: ${error}`,
        'EMAIL_SEND_FAILED',
        500,
        { to, subject }
      )
    }
  },

  registerTemplate(name: string, template: EmailTemplate): void {
    registerTemplate(name, template)
  },

  removeTemplate(name: string): boolean {
    return removeTemplate(name)
  },

  listTemplates(): string[] {
    return listTemplates()
  },

  hasTemplate(name: string): boolean {
    return hasTemplate(name)
  },

  previewTemplate(name: string, data: Record<string, unknown>) {
    return previewTemplate(name, data)
  },

  validateTemplateData(name: string, data: Record<string, unknown>) {
    return validateTemplateData(name, data)
  },

  getLog(): EmailLog[] {
    return [..._emailLog]
  },

  getRecentLog(count: number = 10): EmailLog[] {
    return _emailLog.slice(0, count)
  },

  clearLog(): void {
    _emailLog.length = 0
  },
}

export { getTemplate, hasTemplate, listTemplates, registerTemplate, removeTemplate, renderTemplate, previewTemplate, validateTemplateData }
export type { SendEmailOptions, EmailTemplate, EmailLog, EmailSendResult }

// Advanced email modules
export {
  emailProviders,
  createConsoleProvider,
  createSmtpProvider,
  createResendProvider,
  createSendGridProvider,
  createMailgunProvider,
} from './providers.js'
export type { EmailProvider, ProviderSendOptions, ProviderSendResult, SmtpConfig } from './providers.js'

export { sendBatch, sendToMany } from './batch.js'
export type { BatchSendOptions, BatchSendResult } from './batch.js'

export { createAudienceManager } from './audiences.js'
export type { Audience, Contact, ContactListOptions, ContactListResult } from './audiences.js'

// Email v2 modules
export { createDomainManager } from './domains.js'
export type {
  DomainStatus, DnsRecordType, DnsRecord, EmailDomain, DomainManagerConfig,
} from './domains.js'

export { suppression } from './suppression.js'
export type {
  SuppressionReason, SuppressedEmail, SuppressionListOptions, SuppressionListResult,
  BounceEvent, ComplaintEvent,
} from './suppression.js'

export { emailAnalytics } from './analytics.js'
export type {
  EmailEventType, EmailEvent, EmailAnalyticsSummary, TopLink, DomainStats,
  AnalyticsSummaryOptions, TopLinksOptions,
} from './analytics.js'
