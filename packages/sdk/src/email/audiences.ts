import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * VibeKit Email Audiences & Contacts
 * Manage email lists, contacts, and segmentation.
 * Replaces: Resend Audiences, Mailchimp Lists, SendGrid Contacts
 */

export interface Audience {
  id: string
  name: string
  description: string
  contactCount: number
  createdAt: string
  updatedAt: string
}

export interface Contact {
  id: string
  audienceId: string
  email: string
  firstName: string | null
  lastName: string | null
  metadata: Record<string, unknown>
  subscribed: boolean
  unsubscribedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ContactListOptions {
  limit?: number
  offset?: number
  subscribed?: boolean
  search?: string
}

export interface ContactListResult {
  contacts: Contact[]
  total: number
}

interface AudienceStore {
  audiences: Record<string, Audience>
  contacts: Record<string, Contact[]>
}

function getStorePath(dataDir: string): string {
  return path.join(dataDir, '.vibekit-audiences.json')
}

function loadStore(storePath: string): AudienceStore {
  if (!fs.existsSync(storePath)) return { audiences: {}, contacts: {} }
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')) }
  catch { return { audiences: {}, contacts: {} } }
}

function saveStore(storePath: string, store: AudienceStore): void {
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
}

export function createAudienceManager(dataDir?: string) {
  const dir = dataDir || path.join(process.cwd(), '.vibekit')
  const storePath = getStorePath(dir)

  const audiences = {
    create(name: string, description = ''): Audience {
      const store = loadStore(storePath)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const audience: Audience = { id, name, description, contactCount: 0, createdAt: now, updatedAt: now }
      store.audiences[id] = audience
      store.contacts[id] = []
      saveStore(storePath, store)
      return audience
    },

    get(id: string): Audience | null {
      return loadStore(storePath).audiences[id] || null
    },

    list(): Audience[] {
      return Object.values(loadStore(storePath).audiences)
    },

    delete(id: string): void {
      const store = loadStore(storePath)
      delete store.audiences[id]
      delete store.contacts[id]
      saveStore(storePath, store)
    },

    update(id: string, updates: { name?: string; description?: string }): Audience {
      const store = loadStore(storePath)
      if (!store.audiences[id]) throw new Error(`Audience "${id}" not found`)
      if (updates.name) store.audiences[id].name = updates.name
      if (updates.description !== undefined) store.audiences[id].description = updates.description
      store.audiences[id].updatedAt = new Date().toISOString()
      saveStore(storePath, store)
      return store.audiences[id]
    },

    // ── Contacts ──────────────────────────────────

    addContact(audienceId: string, email: string, data?: { firstName?: string; lastName?: string; metadata?: Record<string, unknown> }): Contact {
      const store = loadStore(storePath)
      if (!store.audiences[audienceId]) throw new Error(`Audience "${audienceId}" not found`)

      // Check for duplicate
      const existing = (store.contacts[audienceId] || []).find(c => c.email.toLowerCase() === email.toLowerCase())
      if (existing) {
        // Update existing
        if (data?.firstName !== undefined) existing.firstName = data.firstName
        if (data?.lastName !== undefined) existing.lastName = data.lastName
        if (data?.metadata) Object.assign(existing.metadata, data.metadata)
        existing.subscribed = true
        existing.unsubscribedAt = null
        existing.updatedAt = new Date().toISOString()
        saveStore(storePath, store)
        return existing
      }

      const now = new Date().toISOString()
      const contact: Contact = {
        id: crypto.randomUUID(), audienceId, email: email.toLowerCase(),
        firstName: data?.firstName || null, lastName: data?.lastName || null,
        metadata: data?.metadata || {},
        subscribed: true, unsubscribedAt: null,
        createdAt: now, updatedAt: now,
      }
      if (!store.contacts[audienceId]) store.contacts[audienceId] = []
      store.contacts[audienceId].push(contact)
      store.audiences[audienceId].contactCount = store.contacts[audienceId].filter(c => c.subscribed).length
      store.audiences[audienceId].updatedAt = now
      saveStore(storePath, store)
      return contact
    },

    addContacts(audienceId: string, contacts: Array<{ email: string; firstName?: string; lastName?: string; metadata?: Record<string, unknown> }>): number {
      let count = 0
      for (const c of contacts) {
        audiences.addContact(audienceId, c.email, c)
        count++
      }
      return count
    },

    removeContact(audienceId: string, email: string): void {
      const store = loadStore(storePath)
      if (!store.contacts[audienceId]) return
      store.contacts[audienceId] = store.contacts[audienceId].filter(c => c.email.toLowerCase() !== email.toLowerCase())
      if (store.audiences[audienceId]) {
        store.audiences[audienceId].contactCount = store.contacts[audienceId].filter(c => c.subscribed).length
      }
      saveStore(storePath, store)
    },

    unsubscribe(audienceId: string, email: string): void {
      const store = loadStore(storePath)
      const contact = (store.contacts[audienceId] || []).find(c => c.email.toLowerCase() === email.toLowerCase())
      if (contact) {
        contact.subscribed = false
        contact.unsubscribedAt = new Date().toISOString()
        if (store.audiences[audienceId]) {
          store.audiences[audienceId].contactCount = store.contacts[audienceId].filter(c => c.subscribed).length
        }
        saveStore(storePath, store)
      }
    },

    getContacts(audienceId: string, options?: ContactListOptions): ContactListResult {
      const store = loadStore(storePath)
      let contacts = store.contacts[audienceId] || []
      if (options?.subscribed !== undefined) contacts = contacts.filter(c => c.subscribed === options.subscribed)
      if (options?.search) {
        const term = options.search.toLowerCase()
        contacts = contacts.filter(c =>
          c.email.includes(term) || (c.firstName || '').toLowerCase().includes(term) || (c.lastName || '').toLowerCase().includes(term)
        )
      }
      const total = contacts.length
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 100
      return { contacts: contacts.slice(offset, offset + limit), total }
    },

    getContact(audienceId: string, email: string): Contact | null {
      const store = loadStore(storePath)
      return (store.contacts[audienceId] || []).find(c => c.email.toLowerCase() === email.toLowerCase()) || null
    },

    /** Get stats for an audience */
    getStats(audienceId: string): { total: number; subscribed: number; unsubscribed: number } {
      const store = loadStore(storePath)
      const contacts = store.contacts[audienceId] || []
      return {
        total: contacts.length,
        subscribed: contacts.filter(c => c.subscribed).length,
        unsubscribed: contacts.filter(c => !c.subscribed).length,
      }
    },
  }

  return audiences
}
