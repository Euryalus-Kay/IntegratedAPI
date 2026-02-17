import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  registerTemplate,
  removeTemplate,
  hasTemplate,
  listTemplates,
  getTemplate,
  renderTemplate,
  previewTemplate,
  validateTemplateData,
} from '../src/email/templates.js'
import type { EmailTemplate } from '../src/email/types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Email send validation (testing the email module via mock)
// ─────────────────────────────────────────────────────────────────────────────

describe('Email send validation', () => {
  beforeEach(() => {
    vi.doMock('../src/config/index.js', () => ({
      getConfig: () => ({
        env: 'local',
        port: 3456,
        modules: { email: { enabled: true, from: 'noreply@test.com' } },
      }),
      isLocal: () => true,
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects when "to" field is missing', async () => {
    const { email } = await import('../src/email/index.js')
    await expect(
      email.send({ to: '', subject: 'Test' }),
    ).rejects.toThrow(/email/i)
  })

  it('rejects an invalid email address', async () => {
    const { email } = await import('../src/email/index.js')
    await expect(
      email.send({ to: 'not-an-email', subject: 'Test' }),
    ).rejects.toThrow(/Invalid email/)
  })

  it('rejects when no content fields are provided', async () => {
    const { email } = await import('../src/email/index.js')
    await expect(
      email.send({ to: 'user@example.com' }),
    ).rejects.toThrow(/at least one of/)
  })

  it('rejects a non-existent template', async () => {
    const { email } = await import('../src/email/index.js')
    await expect(
      email.send({ to: 'user@example.com', template: 'nonexistent-template' }),
    ).rejects.toThrow(/not found/)
  })

  it('sends email successfully in local mode', async () => {
    const { email } = await import('../src/email/index.js')

    // Suppress console.log during test
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await email.send({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'Test body',
    })

    expect(result.messageId).toBeTruthy()
    expect(result.accepted).toEqual(['user@example.com'])
    expect(result.rejected).toEqual([])

    consoleSpy.mockRestore()
  })

  it('sends to multiple recipients', async () => {
    const { email } = await import('../src/email/index.js')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    const result = await email.send({
      to: ['a@example.com', 'b@example.com'],
      subject: 'Multi',
      text: 'Hello all',
    })

    expect(result.accepted).toEqual(['a@example.com', 'b@example.com'])
    consoleSpy.mockRestore()
  })

  it('validates CC addresses', async () => {
    const { email } = await import('../src/email/index.js')
    await expect(
      email.send({
        to: 'user@example.com',
        cc: 'bad-cc',
        subject: 'Test',
        text: 'body',
      }),
    ).rejects.toThrow(/Invalid email/)
  })

  it('validates BCC addresses', async () => {
    const { email } = await import('../src/email/index.js')
    await expect(
      email.send({
        to: 'user@example.com',
        bcc: 'bad-bcc',
        subject: 'Test',
        text: 'body',
      }),
    ).rejects.toThrow(/Invalid email/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Email log tracking
// ─────────────────────────────────────────────────────────────────────────────

describe('Email log tracking', () => {
  beforeEach(() => {
    vi.doMock('../src/config/index.js', () => ({
      getConfig: () => ({
        env: 'local',
        port: 3456,
        modules: { email: { enabled: true, from: 'noreply@test.com' } },
      }),
      isLocal: () => true,
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('tracks sent emails in the log', async () => {
    const { email } = await import('../src/email/index.js')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    email.clearLog()

    await email.send({
      to: 'log@example.com',
      subject: 'Log Test',
      text: 'body',
    })

    const log = email.getLog()
    expect(log.length).toBeGreaterThanOrEqual(1)
    const entry = log[0]
    expect(entry.to).toEqual(['log@example.com'])
    expect(entry.subject).toBe('Log Test')
    expect(entry.status).toBe('sent')
    expect(entry.messageId).toBeTruthy()
    expect(entry.sentAt).toBeTruthy()

    consoleSpy.mockRestore()
  })

  it('getRecentLog returns the most recent entries', async () => {
    const { email } = await import('../src/email/index.js')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    email.clearLog()

    for (let i = 0; i < 5; i++) {
      await email.send({
        to: `recent${i}@example.com`,
        subject: `Test ${i}`,
        text: 'body',
      })
    }

    const recent = email.getRecentLog(3)
    expect(recent).toHaveLength(3)

    consoleSpy.mockRestore()
  })

  it('clearLog empties the log', async () => {
    const { email } = await import('../src/email/index.js')
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await email.send({
      to: 'clear@example.com',
      subject: 'Clear',
      text: 'body',
    })

    email.clearLog()
    expect(email.getLog()).toHaveLength(0)

    consoleSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Template management
// ─────────────────────────────────────────────────────────────────────────────

describe('Email templates', () => {
  describe('built-in templates', () => {
    it('has verification-code template', () => {
      expect(hasTemplate('verification-code')).toBe(true)
    })

    it('has welcome template', () => {
      expect(hasTemplate('welcome')).toBe(true)
    })

    it('has password-reset template', () => {
      expect(hasTemplate('password-reset')).toBe(true)
    })

    it('has account-locked template', () => {
      expect(hasTemplate('account-locked')).toBe(true)
    })

    it('has login-notification template', () => {
      expect(hasTemplate('login-notification')).toBe(true)
    })

    it('listTemplates returns all built-in templates', () => {
      const templates = listTemplates()
      expect(templates).toContain('verification-code')
      expect(templates).toContain('welcome')
      expect(templates).toContain('password-reset')
    })
  })

  describe('registerTemplate', () => {
    afterEach(() => {
      removeTemplate('custom-test')
    })

    it('registers a custom template', () => {
      const template: EmailTemplate = {
        subject: 'Custom: {{name}}',
        html: '<h1>Hello {{name}}</h1>',
        text: 'Hello {{name}}',
      }
      registerTemplate('custom-test', template)
      expect(hasTemplate('custom-test')).toBe(true)
    })

    it('throws when template is missing required fields', () => {
      expect(() => {
        registerTemplate('bad', { subject: '', html: '<h1>hi</h1>', text: 'hi' })
      }).toThrow(/must have subject, html, and text/)
    })

    it('throws when html is missing', () => {
      expect(() => {
        registerTemplate('bad2', { subject: 'Subject', html: '', text: 'text' })
      }).toThrow(/must have subject, html, and text/)
    })

    it('throws when text is missing', () => {
      expect(() => {
        registerTemplate('bad3', { subject: 'Subject', html: '<p>html</p>', text: '' })
      }).toThrow(/must have subject, html, and text/)
    })
  })

  describe('removeTemplate', () => {
    it('removes an existing template', () => {
      registerTemplate('removable', {
        subject: 'sub',
        html: '<p>html</p>',
        text: 'text',
      })
      expect(removeTemplate('removable')).toBe(true)
      expect(hasTemplate('removable')).toBe(false)
    })

    it('returns false for non-existent template', () => {
      expect(removeTemplate('does-not-exist')).toBe(false)
    })
  })

  describe('getTemplate', () => {
    it('returns the template object', () => {
      const tmpl = getTemplate('verification-code')
      expect(tmpl).toBeDefined()
      expect(tmpl!.subject).toContain('{{code}}')
      expect(tmpl!.html).toContain('{{code}}')
      expect(tmpl!.text).toContain('{{code}}')
    })

    it('returns undefined for non-existent template', () => {
      expect(getTemplate('nope')).toBeUndefined()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Template rendering
// ─────────────────────────────────────────────────────────────────────────────

describe('Template rendering', () => {
  it('renders simple placeholders', () => {
    const template: EmailTemplate = {
      subject: 'Hello {{name}}',
      html: '<p>Welcome, {{name}}! Code: {{code}}</p>',
      text: 'Welcome, {{name}}! Code: {{code}}',
    }
    const rendered = renderTemplate(template, { name: 'Alice', code: '123456' })
    expect(rendered.subject).toBe('Hello Alice')
    expect(rendered.html).toContain('Alice')
    expect(rendered.html).toContain('123456')
    expect(rendered.text).toContain('Alice')
    expect(rendered.text).toContain('123456')
  })

  it('renders the verification-code template', () => {
    const tmpl = getTemplate('verification-code')!
    const rendered = renderTemplate(tmpl, { code: '999888', expiresInMinutes: 10 })
    expect(rendered.subject).toContain('999888')
    expect(rendered.text).toContain('999888')
    expect(rendered.text).toContain('10')
  })

  it('leaves missing placeholders empty', () => {
    const template: EmailTemplate = {
      subject: 'Hello {{name}}',
      html: '<p>{{missing}}</p>',
      text: '{{missing}}',
    }
    const rendered = renderTemplate(template, { name: 'Bob' })
    expect(rendered.subject).toBe('Hello Bob')
    expect(rendered.html).toBe('<p></p>')
    expect(rendered.text).toBe('')
  })

  it('handles conditional blocks', () => {
    const template: EmailTemplate = {
      subject: 'Test',
      html: '{{#name}}Hi {{name}}{{/name}}{{^name}}Hi stranger{{/name}}',
      text: '{{#name}}Hi {{name}}{{/name}}{{^name}}Hi stranger{{/name}}',
    }

    const withName = renderTemplate(template, { name: 'Charlie' })
    expect(withName.html).toContain('Hi Charlie')

    const withoutName = renderTemplate(template, {})
    expect(withoutName.html).toContain('Hi stranger')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Template preview
// ─────────────────────────────────────────────────────────────────────────────

describe('previewTemplate', () => {
  it('returns a rendered preview for an existing template', () => {
    const preview = previewTemplate('verification-code', { code: '111222', expiresInMinutes: 5 })
    expect(preview).not.toBeNull()
    expect(preview!.subject).toContain('111222')
    expect(preview!.text).toContain('111222')
    expect(preview!.text).toContain('5')
  })

  it('returns null for a non-existent template', () => {
    expect(previewTemplate('no-such-template', {})).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Template data validation
// ─────────────────────────────────────────────────────────────────────────────

describe('validateTemplateData', () => {
  it('reports valid when all placeholders are provided', () => {
    const result = validateTemplateData('verification-code', {
      code: '123456',
      expiresInMinutes: 10,
    })
    expect(result.valid).toBe(true)
    expect(result.missing).toHaveLength(0)
  })

  it('reports missing placeholders', () => {
    const result = validateTemplateData('verification-code', {})
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('code')
    expect(result.missing).toContain('expiresInMinutes')
  })

  it('returns invalid for a non-existent template', () => {
    const result = validateTemplateData('fake', {})
    expect(result.valid).toBe(false)
    expect(result.missing).toContain('(template not found)')
  })
})
