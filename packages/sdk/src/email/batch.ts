import { emailProviders } from './providers.js'
import type { ProviderSendOptions, ProviderSendResult } from './providers.js'

/**
 * VibeKit Batch Email Sending
 * Send emails in batches with rate limiting and retry logic.
 */

export interface BatchSendOptions {
  /** Max emails per second (default: 10) */
  rateLimit?: number
  /** Max retries per email (default: 3) */
  maxRetries?: number
  /** Provider name (default: default provider) */
  provider?: string
  /** Callback for progress updates */
  onProgress?: (sent: number, total: number, failed: number) => void
}

export interface BatchSendResult {
  total: number
  sent: number
  failed: number
  errors: Array<{ to: string; error: string }>
  duration: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function sendBatch(
  emails: ProviderSendOptions[],
  options?: BatchSendOptions
): Promise<BatchSendResult> {
  const rateLimit = options?.rateLimit ?? 10
  const maxRetries = options?.maxRetries ?? 3
  const provider = emailProviders.get(options?.provider)
  const start = Date.now()

  let sent = 0
  let failed = 0
  const errors: Array<{ to: string; error: string }> = []
  const delay = 1000 / rateLimit

  for (let i = 0; i < emails.length; i++) {
    const email = emails[i]
    let success = false
    let lastError = ''

    for (let retry = 0; retry < maxRetries && !success; retry++) {
      try {
        await provider.send(email)
        success = true
        sent++
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        if (retry < maxRetries - 1) await sleep(1000 * (retry + 1))
      }
    }

    if (!success) {
      failed++
      const to = Array.isArray(email.to) ? email.to.join(', ') : email.to
      errors.push({ to, error: lastError })
    }

    options?.onProgress?.(sent, emails.length, failed)

    // Rate limiting
    if (i < emails.length - 1) await sleep(delay)
  }

  return {
    total: emails.length,
    sent, failed, errors,
    duration: Date.now() - start,
  }
}

/** Send same email to multiple recipients (batch mode) */
export async function sendToMany(
  recipients: string[],
  template: Omit<ProviderSendOptions, 'to'>,
  options?: BatchSendOptions
): Promise<BatchSendResult> {
  const emails = recipients.map(to => ({ ...template, to }))
  return sendBatch(emails, options)
}
