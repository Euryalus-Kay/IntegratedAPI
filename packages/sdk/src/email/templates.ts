import type { EmailTemplate } from './types.js'

const templates: Map<string, EmailTemplate> = new Map()

templates.set('verification-code', {
  subject: 'Your verification code: {{code}}',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1B4F72; margin-bottom: 8px;">Verification Code</h2>
      <p style="color: #555; font-size: 14px;">Enter this code to verify your email:</p>
      <div style="background: #F0F4F8; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1B4F72;">{{code}}</span>
      </div>
      <p style="color: #888; font-size: 12px;">This code expires in {{expiresInMinutes}} minutes. If you didn't request this, ignore this email.</p>
    </div>
  `,
  text: 'Your verification code is: {{code}}. It expires in {{expiresInMinutes}} minutes.',
})

templates.set('welcome', {
  subject: 'Welcome to {{appName}}!',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
      <h1 style="color: #1B4F72;">Welcome{{#name}}, {{name}}{{/name}}!</h1>
      <p style="color: #555;">You've successfully created your account on {{appName}}.</p>
    </div>
  `,
  text: 'Welcome{{#name}}, {{name}}{{/name}}! You have successfully created your account on {{appName}}.',
})

templates.set('password-reset', {
  subject: 'Reset your password',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 400px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1B4F72; margin-bottom: 8px;">Password Reset</h2>
      <p style="color: #555; font-size: 14px;">Use this code to reset your password:</p>
      <div style="background: #F0F4F8; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #1B4F72;">{{code}}</span>
      </div>
      <p style="color: #888; font-size: 12px;">This code expires in {{expiresInMinutes}} minutes. If you didn't request this, ignore this email.</p>
    </div>
  `,
  text: 'Your password reset code is: {{code}}. It expires in {{expiresInMinutes}} minutes.',
})

templates.set('account-locked', {
  subject: 'Your account has been locked',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #C0392B; margin-bottom: 8px;">Account Locked</h2>
      <p style="color: #555; font-size: 14px;">Your account on {{appName}} has been locked due to too many failed login attempts.</p>
      <p style="color: #555; font-size: 14px;">{{#reason}}Reason: {{reason}}{{/reason}}</p>
      <p style="color: #888; font-size: 12px;">If this was not you, please contact support immediately.</p>
    </div>
  `,
  text: 'Your account on {{appName}} has been locked. {{#reason}}Reason: {{reason}}.{{/reason}} Contact support if this was not you.',
})

templates.set('login-notification', {
  subject: 'New login to {{appName}}',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: 0 auto; padding: 40px 20px;">
      <h2 style="color: #1B4F72; margin-bottom: 8px;">New Login Detected</h2>
      <p style="color: #555; font-size: 14px;">A new login to your {{appName}} account was detected.</p>
      <table style="margin: 16px 0; font-size: 14px; color: #555;">
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Time:</td><td>{{loginTime}}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">IP:</td><td>{{ipAddress}}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; font-weight: bold;">Device:</td><td>{{userAgent}}</td></tr>
      </table>
      <p style="color: #888; font-size: 12px;">If this was not you, change your credentials immediately.</p>
    </div>
  `,
  text: 'New login to {{appName}} at {{loginTime}} from IP {{ipAddress}}. If this was not you, take action immediately.',
})

export function getTemplate(name: string): EmailTemplate | undefined {
  return templates.get(name)
}

export function hasTemplate(name: string): boolean {
  return templates.has(name)
}

export function listTemplates(): string[] {
  return Array.from(templates.keys())
}

export function registerTemplate(name: string, template: EmailTemplate): void {
  if (!template.subject || !template.html || !template.text) {
    throw new Error(`Email template "${name}" must have subject, html, and text fields`)
  }
  templates.set(name, template)
}

export function removeTemplate(name: string): boolean {
  return templates.delete(name)
}

export function renderTemplate(template: EmailTemplate, data: Record<string, unknown>): { subject: string; html: string; text: string } {
  return {
    subject: interpolate(template.subject, data),
    html: interpolate(template.html, data),
    text: interpolate(template.text, data),
  }
}

/**
 * Preview a template with sample data without sending.
 * Useful for template development and testing.
 */
export function previewTemplate(
  name: string,
  data: Record<string, unknown>
): { subject: string; html: string; text: string } | null {
  const tmpl = templates.get(name)
  if (!tmpl) return null
  return renderTemplate(tmpl, data)
}

/**
 * Validate template variables: checks that all {{placeholders}} in the template
 * have corresponding keys in the data object.
 */
export function validateTemplateData(
  name: string,
  data: Record<string, unknown>
): { valid: boolean; missing: string[] } {
  const tmpl = templates.get(name)
  if (!tmpl) return { valid: false, missing: ['(template not found)'] }

  const allText = tmpl.subject + tmpl.html + tmpl.text
  const placeholders = new Set<string>()

  // Match {{key}} and {{#key}} but not {{/key}}
  const regex = /\{\{#?(\w+)\}\}/g
  let match
  while ((match = regex.exec(allText)) !== null) {
    placeholders.add(match[1])
  }

  const missing = Array.from(placeholders).filter(key => !(key in data))
  return { valid: missing.length === 0, missing }
}

/**
 * Simple template interpolation: replaces {{key}} with data[key].
 * Supports {{#key}}content{{/key}} for conditional blocks.
 * Supports {{^key}}content{{/key}} for inverted conditional blocks.
 * Supports {{key|default}} for default values.
 */
function interpolate(template: string, data: Record<string, unknown>): string {
  let result = template

  // Handle conditional blocks: {{#key}}content{{/key}}
  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return data[key] ? interpolate(content, data) : ''
  })

  // Handle inverted conditional blocks: {{^key}}content{{/key}}
  result = result.replace(/\{\{\^(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return !data[key] ? interpolate(content, data) : ''
  })

  // Handle simple replacements with defaults: {{key|default}}
  result = result.replace(/\{\{(\w+)\|([^}]+)\}\}/g, (_, key, defaultVal) => {
    return data[key] !== undefined ? String(data[key]) : defaultVal
  })

  // Handle simple replacements: {{key}}
  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] !== undefined ? String(data[key]) : ''
  })

  return result
}
