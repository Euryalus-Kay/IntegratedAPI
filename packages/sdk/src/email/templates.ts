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

export function getTemplate(name: string): EmailTemplate | undefined {
  return templates.get(name)
}

export function registerTemplate(name: string, template: EmailTemplate): void {
  templates.set(name, template)
}

export function renderTemplate(template: EmailTemplate, data: Record<string, unknown>): { subject: string; html: string; text: string } {
  return {
    subject: interpolate(template.subject, data),
    html: interpolate(template.html, data),
    text: interpolate(template.text, data),
  }
}

function interpolate(template: string, data: Record<string, unknown>): string {
  let result = template

  result = result.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, content) => {
    return data[key] ? interpolate(content, data) : ''
  })

  result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return data[key] !== undefined ? String(data[key]) : ''
  })

  return result
}
