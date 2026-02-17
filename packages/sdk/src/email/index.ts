import { getConfig, isLocal } from '../config/index.js'
import { getTemplate, registerTemplate, renderTemplate } from './templates.js'
import type { SendEmailOptions, EmailTemplate } from './types.js'

export const email = {
  async send(options: SendEmailOptions): Promise<{ messageId: string }> {
    let subject = options.subject || ''
    let html = options.html || ''
    let text = options.text || ''

    if (options.template) {
      const tmpl = getTemplate(options.template)
      if (!tmpl) throw new Error(`Email template "${options.template}" not found`)
      const rendered = renderTemplate(tmpl, options.data || {})
      subject = subject || rendered.subject
      html = html || rendered.html
      text = text || rendered.text
    }

    const to = Array.isArray(options.to) ? options.to : [options.to]
    const messageId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    if (isLocal()) {
      console.log(`\n  ╔═══════════════════════════════════════╗`)
      console.log(`  ║  EMAIL SENT (local dev)`)
      console.log(`  ║  To: ${to.join(', ')}`)
      console.log(`  ║  Subject: ${subject}`)
      console.log(`  ║  ─────────────────────────────────────`)
      console.log(`  ║  ${text.split('\n').join('\n  ║  ')}`)
      console.log(`  ╚═══════════════════════════════════════╝\n`)
    } else {
      throw new Error('Production email not yet implemented. Use vibekit dev for local development.')
    }

    return { messageId }
  },

  registerTemplate(name: string, template: EmailTemplate): void {
    registerTemplate(name, template)
  },
}

export { getTemplate, registerTemplate, renderTemplate }
export type { SendEmailOptions, EmailTemplate }
