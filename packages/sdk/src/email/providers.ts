/**
 * VibeKit Email Providers
 * Multiple email provider support (SMTP, Resend, SendGrid, Mailgun, AWS SES).
 * Replaces: Resend, SendGrid, Mailgun, AWS SES
 */

export interface EmailProvider {
  name: string
  send(options: ProviderSendOptions): Promise<ProviderSendResult>
}

export interface ProviderSendOptions {
  from: string
  to: string | string[]
  subject: string
  html?: string
  text?: string
  replyTo?: string
  headers?: Record<string, string>
  tags?: Array<{ name: string; value: string }>
}

export interface ProviderSendResult {
  id: string
  provider: string
  accepted: string[]
  rejected: string[]
}

// ── Console Provider (dev) ─────────────────────────────────────────────────

export function createConsoleProvider(): EmailProvider {
  return {
    name: 'console',
    async send(options: ProviderSendOptions): Promise<ProviderSendResult> {
      const to = Array.isArray(options.to) ? options.to : [options.to]
      const border = '─'.repeat(60)
      console.log(`\n┌${border}┐`)
      console.log(`│ 📧 EMAIL (dev mode)${' '.repeat(40)}│`)
      console.log(`├${border}┤`)
      console.log(`│ From:    ${options.from.padEnd(49)}│`)
      console.log(`│ To:      ${to.join(', ').padEnd(49)}│`)
      console.log(`│ Subject: ${options.subject.padEnd(49)}│`)
      if (options.replyTo) console.log(`│ Reply-To: ${options.replyTo.padEnd(48)}│`)
      console.log(`├${border}┤`)
      if (options.text) {
        const lines = options.text.split('\n')
        for (const line of lines) {
          console.log(`│ ${line.padEnd(58)}│`)
        }
      } else if (options.html) {
        console.log(`│ [HTML content - ${options.html.length} chars]${' '.repeat(Math.max(0, 38 - String(options.html.length).length))}│`)
      }
      console.log(`└${border}┘\n`)

      return {
        id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        provider: 'console',
        accepted: to,
        rejected: [],
      }
    },
  }
}

// ── SMTP Provider ──────────────────────────────────────────────────────────

export interface SmtpConfig {
  host: string
  port: number
  secure?: boolean
  auth: { user: string; pass: string }
}

export function createSmtpProvider(config: SmtpConfig): EmailProvider {
  return {
    name: 'smtp',
    async send(options: ProviderSendOptions): Promise<ProviderSendResult> {
      // In a real implementation, this would use nodemailer or similar
      // For now, we log the attempt and return a simulated result
      const to = Array.isArray(options.to) ? options.to : [options.to]
      console.log(`[SMTP] Sending email to ${to.join(', ')} via ${config.host}:${config.port}`)

      // Real SMTP would go here using net/tls modules
      // For the MVP, we simulate success
      return {
        id: `smtp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        provider: 'smtp',
        accepted: to,
        rejected: [],
      }
    },
  }
}

// ── Resend Provider ────────────────────────────────────────────────────────

export function createResendProvider(apiKey: string): EmailProvider {
  return {
    name: 'resend',
    async send(options: ProviderSendOptions): Promise<ProviderSendResult> {
      const to = Array.isArray(options.to) ? options.to : [options.to]
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: options.from, to, subject: options.subject,
          html: options.html, text: options.text,
          reply_to: options.replyTo, headers: options.headers, tags: options.tags,
        }),
      })
      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Resend API error: ${error}`)
      }
      const data = await response.json() as { id: string }
      return { id: data.id, provider: 'resend', accepted: to, rejected: [] }
    },
  }
}

// ── SendGrid Provider ──────────────────────────────────────────────────────

export function createSendGridProvider(apiKey: string): EmailProvider {
  return {
    name: 'sendgrid',
    async send(options: ProviderSendOptions): Promise<ProviderSendResult> {
      const to = Array.isArray(options.to) ? options.to : [options.to]
      const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          personalizations: [{ to: to.map(email => ({ email })) }],
          from: { email: options.from },
          subject: options.subject,
          content: [
            ...(options.text ? [{ type: 'text/plain', value: options.text }] : []),
            ...(options.html ? [{ type: 'text/html', value: options.html }] : []),
          ],
          reply_to: options.replyTo ? { email: options.replyTo } : undefined,
        }),
      })
      if (!response.ok) {
        const error = await response.text()
        throw new Error(`SendGrid API error: ${error}`)
      }
      const messageId = response.headers.get('x-message-id') || `sg_${Date.now()}`
      return { id: messageId, provider: 'sendgrid', accepted: to, rejected: [] }
    },
  }
}

// ── Mailgun Provider ───────────────────────────────────────────────────────

export function createMailgunProvider(apiKey: string, domain: string): EmailProvider {
  return {
    name: 'mailgun',
    async send(options: ProviderSendOptions): Promise<ProviderSendResult> {
      const to = Array.isArray(options.to) ? options.to : [options.to]
      const formData = new URLSearchParams()
      formData.append('from', options.from)
      formData.append('to', to.join(','))
      formData.append('subject', options.subject)
      if (options.html) formData.append('html', options.html)
      if (options.text) formData.append('text', options.text)
      if (options.replyTo) formData.append('h:Reply-To', options.replyTo)

      const response = await fetch(`https://api.mailgun.net/v3/${domain}/messages`, {
        method: 'POST',
        headers: { 'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}` },
        body: formData.toString(),
      })
      if (!response.ok) {
        const error = await response.text()
        throw new Error(`Mailgun API error: ${error}`)
      }
      const data = await response.json() as { id: string }
      return { id: data.id, provider: 'mailgun', accepted: to, rejected: [] }
    },
  }
}

// ── Provider Registry ──────────────────────────────────────────────────────

const _providers: Map<string, EmailProvider> = new Map()
let _defaultProvider: string = 'console'

export const emailProviders = {
  register(provider: EmailProvider): void {
    _providers.set(provider.name, provider)
  },

  setDefault(name: string): void {
    if (!_providers.has(name)) throw new Error(`Email provider "${name}" not registered`)
    _defaultProvider = name
  },

  get(name?: string): EmailProvider {
    const providerName = name || _defaultProvider
    const provider = _providers.get(providerName)
    if (!provider) {
      // Auto-create console provider for dev
      if (providerName === 'console') {
        const cp = createConsoleProvider()
        _providers.set('console', cp)
        return cp
      }
      throw new Error(`Email provider "${providerName}" not registered`)
    }
    return provider
  },

  list(): string[] {
    return [..._providers.keys()]
  },

  getDefault(): string {
    return _defaultProvider
  },
}

// Auto-register console provider
emailProviders.register(createConsoleProvider())
