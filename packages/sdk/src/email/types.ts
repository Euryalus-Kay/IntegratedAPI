export interface SendEmailOptions {
  to: string | string[]
  subject?: string
  text?: string
  html?: string
  template?: string
  data?: Record<string, unknown>
  from?: string
  replyTo?: string
  cc?: string | string[]
  bcc?: string | string[]
  attachments?: EmailAttachment[]
  tags?: string[]
  metadata?: Record<string, string>
}

export interface EmailAttachment {
  filename: string
  content: Buffer | string
  contentType?: string
}

export interface EmailTemplate {
  subject: string
  html: string
  text: string
}

export interface EmailTransport {
  send(options: SendEmailOptions): Promise<EmailSendResult>
}

export interface EmailSendResult {
  messageId: string
  accepted: string[]
  rejected: string[]
}

export interface EmailLog {
  messageId: string
  to: string[]
  subject: string
  template?: string
  sentAt: string
  status: 'sent' | 'failed'
  error?: string
}

export interface EmailValidationResult {
  valid: boolean
  errors: string[]
}
