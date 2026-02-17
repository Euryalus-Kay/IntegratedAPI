export interface SendEmailOptions {
  to: string | string[]
  subject?: string
  text?: string
  html?: string
  template?: string
  data?: Record<string, unknown>
  from?: string
  replyTo?: string
  attachments?: EmailAttachment[]
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
  send(options: SendEmailOptions): Promise<{ messageId: string }>
}
