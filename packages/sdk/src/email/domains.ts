// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Email — Domain Management
// ──────────────────────────────────────────────────────────────────────────────

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getConfig } from '../config/index.js'
import { VibeKitError } from '../utils/errors.js'

// ── Types ────────────────────────────────────────────────────────────────────

export type DomainStatus = 'pending' | 'verified' | 'failed'
export type DnsRecordType = 'TXT' | 'CNAME' | 'MX'

export interface DnsRecord {
  type: DnsRecordType
  name: string
  value: string
  purpose: 'DKIM' | 'SPF' | 'DMARC' | 'Return-Path' | 'MX'
  verified: boolean
}

export interface EmailDomain {
  id: string
  domain: string
  status: DomainStatus
  isDefault: boolean
  dnsRecords: DnsRecord[]
  verifiedAt: string | null
  lastCheckedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface DomainManagerConfig {
  storagePath?: string
}

interface DomainStore {
  domains: EmailDomain[]
  defaultDomain: string | null
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createDomainManager(config?: DomainManagerConfig) {
  const storagePath = config?.storagePath ?? resolveStoragePath()

  function readStore(): DomainStore {
    try {
      if (fs.existsSync(storagePath)) {
        const raw = fs.readFileSync(storagePath, 'utf-8')
        return JSON.parse(raw) as DomainStore
      }
    } catch {
      // Corrupted file; start fresh
    }
    return { domains: [], defaultDomain: null }
  }

  function writeStore(store: DomainStore): void {
    const dir = path.dirname(storagePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(storagePath, JSON.stringify(store, null, 2), 'utf-8')
  }

  function findDomain(store: DomainStore, domain: string): EmailDomain | undefined {
    return store.domains.find(d => d.domain === domain.toLowerCase())
  }

  function generateDkimSelector(): string {
    return `vibekit-${crypto.randomBytes(4).toString('hex')}`
  }

  function buildDnsRecords(domain: string): DnsRecord[] {
    const selector = generateDkimSelector()
    return [
      {
        type: 'TXT',
        name: `${selector}._domainkey.${domain}`,
        value: `v=DKIM1; k=rsa; p=${crypto.randomBytes(64).toString('base64')}`,
        purpose: 'DKIM',
        verified: false,
      },
      {
        type: 'TXT',
        name: domain,
        value: 'v=spf1 include:_spf.vibekit.dev ~all',
        purpose: 'SPF',
        verified: false,
      },
      {
        type: 'TXT',
        name: `_dmarc.${domain}`,
        value: 'v=DMARC1; p=quarantine; rua=mailto:dmarc@vibekit.dev; pct=100',
        purpose: 'DMARC',
        verified: false,
      },
      {
        type: 'CNAME',
        name: `bounce.${domain}`,
        value: 'feedback-smtp.vibekit.dev',
        purpose: 'Return-Path',
        verified: false,
      },
    ]
  }

  return {
    /**
     * Add a new domain for email sending. DNS records are generated
     * that must be added to your DNS provider before verification.
     */
    add(domain: string): EmailDomain {
      const normalized = domain.toLowerCase().trim()
      if (!normalized || !normalized.includes('.')) {
        throw new VibeKitError(
          `Invalid domain: "${domain}". Expected format: example.com`,
          'VALIDATION_FAILED',
          400,
        )
      }

      const store = readStore()
      if (findDomain(store, normalized)) {
        throw new VibeKitError(
          `Domain "${normalized}" is already registered.`,
          'VALIDATION_FAILED',
          409,
        )
      }

      const now = new Date().toISOString()
      const entry: EmailDomain = {
        id: crypto.randomUUID(),
        domain: normalized,
        status: 'pending',
        isDefault: store.domains.length === 0,
        dnsRecords: buildDnsRecords(normalized),
        verifiedAt: null,
        lastCheckedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      store.domains.push(entry)
      if (entry.isDefault) {
        store.defaultDomain = normalized
      }
      writeStore(store)

      return entry
    },

    /**
     * Verify domain DNS records. In a production implementation this
     * would perform actual DNS lookups. For local development, this
     * simulates verification by marking all records as verified.
     */
    verify(domain: string): EmailDomain {
      const store = readStore()
      const entry = findDomain(store, domain)
      if (!entry) {
        throw new VibeKitError(`Domain "${domain}" not found.`, 'VALIDATION_FAILED', 404)
      }

      const now = new Date().toISOString()
      entry.lastCheckedAt = now

      // Simulate DNS verification (local dev mode)
      // In production, use dns.resolveTxt / dns.resolveCname
      let allVerified = true
      for (const record of entry.dnsRecords) {
        // Simulate: mark as verified for local dev
        record.verified = true
      }

      if (allVerified) {
        entry.status = 'verified'
        entry.verifiedAt = now
      } else {
        entry.status = 'failed'
      }

      entry.updatedAt = now
      writeStore(store)

      return entry
    },

    /**
     * List all registered email domains with their current status.
     */
    list(): EmailDomain[] {
      const store = readStore()
      return [...store.domains]
    },

    /**
     * Remove a domain from the system. If it was the default domain,
     * the default is cleared.
     */
    remove(domain: string): void {
      const store = readStore()
      const idx = store.domains.findIndex(d => d.domain === domain.toLowerCase())
      if (idx === -1) {
        throw new VibeKitError(`Domain "${domain}" not found.`, 'VALIDATION_FAILED', 404)
      }

      const removed = store.domains.splice(idx, 1)[0]
      if (removed.isDefault || store.defaultDomain === removed.domain) {
        store.defaultDomain = store.domains.length > 0 ? store.domains[0].domain : null
        if (store.domains.length > 0) {
          store.domains[0].isDefault = true
        }
      }
      writeStore(store)
    },

    /**
     * Get the required DNS records for a domain that need to be
     * configured at your DNS provider.
     */
    getDnsRecords(domain: string): DnsRecord[] {
      const store = readStore()
      const entry = findDomain(store, domain)
      if (!entry) {
        throw new VibeKitError(`Domain "${domain}" not found.`, 'VALIDATION_FAILED', 404)
      }
      return [...entry.dnsRecords]
    },

    /**
     * Check the current verification status of a domain.
     */
    getStatus(domain: string): { domain: string; status: DomainStatus; records: DnsRecord[] } {
      const store = readStore()
      const entry = findDomain(store, domain)
      if (!entry) {
        throw new VibeKitError(`Domain "${domain}" not found.`, 'VALIDATION_FAILED', 404)
      }
      return {
        domain: entry.domain,
        status: entry.status,
        records: entry.dnsRecords,
      }
    },

    /**
     * Set a domain as the default sending domain. The domain must
     * already be registered and verified.
     */
    setDefault(domain: string): EmailDomain {
      const store = readStore()
      const entry = findDomain(store, domain)
      if (!entry) {
        throw new VibeKitError(`Domain "${domain}" not found.`, 'VALIDATION_FAILED', 404)
      }
      if (entry.status !== 'verified') {
        throw new VibeKitError(
          `Domain "${domain}" must be verified before it can be set as default.`,
          'VALIDATION_FAILED',
          400,
        )
      }

      // Unset previous default
      for (const d of store.domains) {
        d.isDefault = false
      }
      entry.isDefault = true
      store.defaultDomain = entry.domain
      entry.updatedAt = new Date().toISOString()
      writeStore(store)

      return entry
    },

    /**
     * Get the current default sending domain, or `null` if none is set.
     */
    getDefault(): EmailDomain | null {
      const store = readStore()
      if (!store.defaultDomain) return null
      return findDomain(store, store.defaultDomain) ?? null
    },
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveStoragePath(): string {
  try {
    const config = getConfig()
    const dbPath = config.dbPath ?? '.vibekit/data.db'
    const dir = path.dirname(path.resolve(dbPath))
    return path.join(dir, '_vibekit_email_domains.json')
  } catch {
    return path.resolve('.vibekit', '_vibekit_email_domains.json')
  }
}
