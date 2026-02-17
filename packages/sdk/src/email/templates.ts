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

// ── Build & Deployment Notification Templates ─────────────────────────────

templates.set('build-failed', {
  subject: '[{{projectName}}] Build failed — {{buildId}}',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #000; color: #EDEDED;">
      <div style="border-left: 4px solid #E74C3C; padding-left: 16px; margin-bottom: 24px;">
        <h2 style="color: #E74C3C; margin: 0 0 4px 0; font-size: 20px;">Build Failed</h2>
        <p style="color: #888; margin: 0; font-size: 14px;">{{projectName}} &middot; {{environment}}</p>
      </div>
      <div style="background: #111; border: 1px solid #1A1A1A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; font-size: 14px; color: #EDEDED;">
          <tr><td style="padding: 6px 0; color: #888; width: 120px;">Build ID</td><td style="font-family: 'JetBrains Mono', monospace;">{{buildId}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Triggered by</td><td>{{triggeredBy}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Branch</td><td>{{branch}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Commit</td><td style="font-family: 'JetBrains Mono', monospace;">{{commitHash}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Duration</td><td>{{duration}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Failed at</td><td>{{failedAt}}</td></tr>
        </table>
      </div>
      {{#errorMessage}}
      <div style="background: #1a0000; border: 1px solid #3a1111; border-radius: 8px; padding: 16px; margin-bottom: 24px;">
        <p style="color: #E74C3C; font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 8px 0;">Error Output</p>
        <pre style="font-family: 'JetBrains Mono', monospace; font-size: 13px; color: #EDEDED; margin: 0; white-space: pre-wrap; word-break: break-all;">{{errorMessage}}</pre>
      </div>
      {{/errorMessage}}
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{dashboardUrl}}/projects/{{projectId}}/deployments/{{buildId}}" style="display: inline-block; background: #00A3FF; color: #000; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 500; font-size: 14px;">View Build Logs</a>
      </div>
      <p style="color: #555; font-size: 12px; text-align: center;">You received this because you have build notifications enabled for {{projectName}}.</p>
    </div>
  `,
  text: 'Build failed for {{projectName}} ({{environment}}). Build ID: {{buildId}}. Error: {{errorMessage}}. View logs: {{dashboardUrl}}/projects/{{projectId}}/deployments/{{buildId}}',
})

templates.set('build-succeeded', {
  subject: '[{{projectName}}] Build succeeded — deployed to {{environment}}',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #000; color: #EDEDED;">
      <div style="border-left: 4px solid #2ECC71; padding-left: 16px; margin-bottom: 24px;">
        <h2 style="color: #2ECC71; margin: 0 0 4px 0; font-size: 20px;">Build Succeeded</h2>
        <p style="color: #888; margin: 0; font-size: 14px;">{{projectName}} &middot; {{environment}}</p>
      </div>
      <div style="background: #111; border: 1px solid #1A1A1A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; font-size: 14px; color: #EDEDED;">
          <tr><td style="padding: 6px 0; color: #888; width: 120px;">Build ID</td><td style="font-family: 'JetBrains Mono', monospace;">{{buildId}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Branch</td><td>{{branch}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Commit</td><td style="font-family: 'JetBrains Mono', monospace;">{{commitHash}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Duration</td><td>{{duration}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Deployed at</td><td>{{deployedAt}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">URL</td><td><a href="{{deployUrl}}" style="color: #00A3FF;">{{deployUrl}}</a></td></tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{deployUrl}}" style="display: inline-block; background: #00A3FF; color: #000; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 500; font-size: 14px;">View Deployment</a>
      </div>
      <p style="color: #555; font-size: 12px; text-align: center;">You received this because you have build notifications enabled for {{projectName}}.</p>
    </div>
  `,
  text: 'Build succeeded for {{projectName}} ({{environment}}). Deployed to {{deployUrl}}. Build ID: {{buildId}}. Duration: {{duration}}.',
})

templates.set('deploy-rollback', {
  subject: '[{{projectName}}] Deployment rolled back — {{environment}}',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #000; color: #EDEDED;">
      <div style="border-left: 4px solid #F39C12; padding-left: 16px; margin-bottom: 24px;">
        <h2 style="color: #F39C12; margin: 0 0 4px 0; font-size: 20px;">Deployment Rolled Back</h2>
        <p style="color: #888; margin: 0; font-size: 14px;">{{projectName}} &middot; {{environment}}</p>
      </div>
      <div style="background: #111; border: 1px solid #1A1A1A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; font-size: 14px; color: #EDEDED;">
          <tr><td style="padding: 6px 0; color: #888; width: 140px;">Rolled back from</td><td style="font-family: 'JetBrains Mono', monospace;">{{fromBuildId}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Rolled back to</td><td style="font-family: 'JetBrains Mono', monospace;">{{toBuildId}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Reason</td><td>{{reason}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Initiated by</td><td>{{initiatedBy}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Time</td><td>{{rolledBackAt}}</td></tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{dashboardUrl}}/projects/{{projectId}}/deployments" style="display: inline-block; background: #00A3FF; color: #000; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 500; font-size: 14px;">View Deployment History</a>
      </div>
      <p style="color: #555; font-size: 12px; text-align: center;">You received this because you have deployment notifications enabled for {{projectName}}.</p>
    </div>
  `,
  text: 'Deployment rolled back for {{projectName}} ({{environment}}). From build {{fromBuildId}} to {{toBuildId}}. Reason: {{reason}}.',
})

templates.set('usage-limit-warning', {
  subject: '[{{projectName}}] Approaching usage limit — {{resourceType}}',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #000; color: #EDEDED;">
      <div style="border-left: 4px solid #F39C12; padding-left: 16px; margin-bottom: 24px;">
        <h2 style="color: #F39C12; margin: 0 0 4px 0; font-size: 20px;">Usage Limit Warning</h2>
        <p style="color: #888; margin: 0; font-size: 14px;">{{projectName}} &middot; {{resourceType}}</p>
      </div>
      <div style="background: #111; border: 1px solid #1A1A1A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <p style="color: #EDEDED; font-size: 14px; margin: 0 0 16px 0;">Your project is at <strong style="color: #F39C12;">{{usagePercent}}%</strong> of the {{resourceType}} limit for your current plan.</p>
        <div style="background: #222; border-radius: 4px; height: 8px; overflow: hidden; margin-bottom: 16px;">
          <div style="background: {{usagePercent > 90 ? '#E74C3C' : '#F39C12'}}; height: 100%; width: {{usagePercent}}%; border-radius: 4px;"></div>
        </div>
        <table style="width: 100%; font-size: 14px; color: #EDEDED;">
          <tr><td style="padding: 6px 0; color: #888;">Current usage</td><td>{{currentUsage}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Plan limit</td><td>{{planLimit}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Current plan</td><td>{{planName}}</td></tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{dashboardUrl}}/settings/billing" style="display: inline-block; background: #00A3FF; color: #000; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 500; font-size: 14px;">Upgrade Plan</a>
      </div>
      <p style="color: #555; font-size: 12px; text-align: center;">You received this because you have usage notifications enabled.</p>
    </div>
  `,
  text: 'Usage warning for {{projectName}}: {{resourceType}} is at {{usagePercent}}% ({{currentUsage}} of {{planLimit}}). Current plan: {{planName}}. Upgrade at {{dashboardUrl}}/settings/billing',
})

templates.set('invite-team-member', {
  subject: 'You\'ve been invited to {{projectName}} on VibeKit',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #000; color: #EDEDED;">
      <div style="text-align: center; margin-bottom: 32px;">
        <h2 style="color: #EDEDED; margin: 0 0 8px 0; font-size: 24px;">You're Invited</h2>
        <p style="color: #888; margin: 0; font-size: 14px;">{{inviterName}} invited you to collaborate on <strong style="color: #EDEDED;">{{projectName}}</strong></p>
      </div>
      <div style="background: #111; border: 1px solid #1A1A1A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; font-size: 14px; color: #EDEDED;">
          <tr><td style="padding: 6px 0; color: #888; width: 120px;">Project</td><td>{{projectName}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Role</td><td>{{role}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Invited by</td><td>{{inviterName}} ({{inviterEmail}})</td></tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{acceptUrl}}" style="display: inline-block; background: #00A3FF; color: #000; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 500; font-size: 14px;">Accept Invitation</a>
      </div>
      <p style="color: #555; font-size: 12px; text-align: center;">This invitation expires in 7 days. If you didn't expect this, you can ignore this email.</p>
    </div>
  `,
  text: '{{inviterName}} invited you to collaborate on {{projectName}} as {{role}}. Accept at: {{acceptUrl}}',
})

templates.set('security-alert', {
  subject: '[Security Alert] {{alertType}} — {{projectName}}',
  html: `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; background: #000; color: #EDEDED;">
      <div style="border-left: 4px solid #E74C3C; padding-left: 16px; margin-bottom: 24px;">
        <h2 style="color: #E74C3C; margin: 0 0 4px 0; font-size: 20px;">Security Alert</h2>
        <p style="color: #888; margin: 0; font-size: 14px;">{{projectName}} &middot; {{alertType}}</p>
      </div>
      <div style="background: #111; border: 1px solid #1A1A1A; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
        <p style="color: #EDEDED; font-size: 14px; margin: 0 0 16px 0;">{{alertDescription}}</p>
        <table style="width: 100%; font-size: 14px; color: #EDEDED;">
          <tr><td style="padding: 6px 0; color: #888; width: 120px;">Time</td><td>{{alertTime}}</td></tr>
          <tr><td style="padding: 6px 0; color: #888;">Severity</td><td style="color: {{#isHigh}}#E74C3C{{/isHigh}}{{^isHigh}}#F39C12{{/isHigh}};">{{severity}}</td></tr>
          {{#ipAddress}}<tr><td style="padding: 6px 0; color: #888;">IP Address</td><td style="font-family: 'JetBrains Mono', monospace;">{{ipAddress}}</td></tr>{{/ipAddress}}
          {{#userEmail}}<tr><td style="padding: 6px 0; color: #888;">User</td><td>{{userEmail}}</td></tr>{{/userEmail}}
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="{{dashboardUrl}}/projects/{{projectId}}/security" style="display: inline-block; background: #E74C3C; color: #FFFFFF; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 500; font-size: 14px;">Review Security Events</a>
      </div>
      <p style="color: #555; font-size: 12px; text-align: center;">You received this because you have security alerts enabled for {{projectName}}.</p>
    </div>
  `,
  text: 'Security alert for {{projectName}}: {{alertType}} - {{alertDescription}}. Severity: {{severity}}. Time: {{alertTime}}. Review at {{dashboardUrl}}/projects/{{projectId}}/security',
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
