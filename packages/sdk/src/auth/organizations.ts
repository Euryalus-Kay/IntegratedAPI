import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables, logAuditEvent } from './internals.js'
import type {
  Organization, OrgMember, OrgInvitation, CreateOrgOptions, UpdateOrgOptions,
  ListOrgsOptions, ListOrgsResult, ListMembersOptions, ListMembersResult, OrgInviteOptions,
} from './types.js'

const ORG_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_organizations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  metadata TEXT DEFAULT '{}',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vibekit_org_members (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES vibekit_organizations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES vibekit_users(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'member',
  joined_at TEXT DEFAULT (datetime('now')),
  UNIQUE(org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_org ON vibekit_org_members(org_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON vibekit_org_members(user_id);
CREATE TABLE IF NOT EXISTS vibekit_org_invitations (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES vibekit_organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  invited_by TEXT,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  accepted INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`

let _orgInitialized = false
async function ensureOrgTables(): Promise<void> {
  await ensureAuthTables()
  if (_orgInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of ORG_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _orgInitialized = true
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export const organizations = {
  async create(options: CreateOrgOptions): Promise<Organization> {
    await ensureOrgTables()
    const adapter = db._getAdapter()
    const id = crypto.randomUUID()
    const slug = options.slug || slugify(options.name)
    const now = new Date().toISOString()

    await adapter.execute(
      `INSERT INTO vibekit_organizations (id, name, slug, logo_url, metadata, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, options.name, slug, options.logoUrl || null, JSON.stringify(options.metadata || {}), options.createdBy || null]
    )

    if (options.createdBy) {
      await adapter.execute(
        `INSERT INTO vibekit_org_members (id, org_id, user_id, role) VALUES ($1, $2, $3, 'owner')`,
        [crypto.randomUUID(), id, options.createdBy]
      )
    }

    const org = await adapter.queryOne<Organization>(`SELECT * FROM vibekit_organizations WHERE id = $1`, [id])
    await logAuditEvent('org_create', { userId: options.createdBy, metadata: { orgId: id, name: options.name } })
    return org!
  },

  async get(idOrSlug: string): Promise<Organization | null> {
    await ensureOrgTables()
    return db.queryOne<Organization>(
      `SELECT * FROM vibekit_organizations WHERE id = $1 OR slug = $1`, [idOrSlug]
    )
  },

  async update(id: string, updates: UpdateOrgOptions): Promise<Organization> {
    await ensureOrgTables()
    const adapter = db._getAdapter()
    const parts: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (updates.name !== undefined) { parts.push(`name = $${idx++}`); params.push(updates.name) }
    if (updates.slug !== undefined) { parts.push(`slug = $${idx++}`); params.push(updates.slug) }
    if (updates.logoUrl !== undefined) { parts.push(`logo_url = $${idx++}`); params.push(updates.logoUrl) }
    if (updates.metadata !== undefined) { parts.push(`metadata = $${idx++}`); params.push(JSON.stringify(updates.metadata)) }
    parts.push(`updated_at = $${idx++}`); params.push(new Date().toISOString())
    params.push(id)

    await adapter.execute(
      `UPDATE vibekit_organizations SET ${parts.join(', ')} WHERE id = $${idx}`, params
    )
    return (await db.queryOne<Organization>(`SELECT * FROM vibekit_organizations WHERE id = $1`, [id]))!
  },

  async delete(id: string): Promise<void> {
    await ensureOrgTables()
    await db.execute(`DELETE FROM vibekit_organizations WHERE id = $1`, [id])
    await logAuditEvent('org_delete', { metadata: { orgId: id } })
  },

  async list(options?: ListOrgsOptions): Promise<ListOrgsResult> {
    await ensureOrgTables()
    const limit = options?.limit ?? 20
    const page = options?.page ?? 1
    const offset = (page - 1) * limit

    let where = ''
    const params: unknown[] = []
    if (options?.search) {
      where = `WHERE name LIKE $1 OR slug LIKE $1`
      params.push(`%${options.search}%`)
    }

    const countResult = await db.queryOne<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM vibekit_organizations ${where}`, params)
    const total = countResult?.cnt ?? 0

    const { rows } = await db.query<Organization>(
      `SELECT * FROM vibekit_organizations ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params
    )

    return { organizations: rows, total, page, limit, totalPages: Math.ceil(total / limit) }
  },

  async addMember(orgId: string, userId: string, role = 'member'): Promise<OrgMember> {
    await ensureOrgTables()
    const adapter = db._getAdapter()
    const id = crypto.randomUUID()
    await adapter.execute(
      `INSERT OR REPLACE INTO vibekit_org_members (id, org_id, user_id, role) VALUES ($1, $2, $3, $4)`,
      [id, orgId, userId, role]
    )
    return (await adapter.queryOne<OrgMember>(`SELECT * FROM vibekit_org_members WHERE id = $1`, [id]))!
  },

  async removeMember(orgId: string, userId: string): Promise<void> {
    await ensureOrgTables()
    await db.execute(`DELETE FROM vibekit_org_members WHERE org_id = $1 AND user_id = $2`, [orgId, userId])
  },

  async updateMemberRole(orgId: string, userId: string, role: string): Promise<void> {
    await ensureOrgTables()
    await db.execute(`UPDATE vibekit_org_members SET role = $1 WHERE org_id = $2 AND user_id = $3`, [role, orgId, userId])
  },

  async getMembers(orgId: string, options?: ListMembersOptions): Promise<ListMembersResult> {
    await ensureOrgTables()
    const limit = options?.limit ?? 20
    const page = options?.page ?? 1
    const offset = (page - 1) * limit
    let where = 'WHERE m.org_id = $1'
    const params: unknown[] = [orgId]
    if (options?.role) {
      where += ` AND m.role = $2`
      params.push(options.role)
    }

    const countResult = await db.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM vibekit_org_members m ${where}`, params
    )
    const total = countResult?.cnt ?? 0

    const { rows } = await db.query<OrgMember>(
      `SELECT m.*, u.email, u.name, u.avatar_url FROM vibekit_org_members m
       LEFT JOIN vibekit_users u ON m.user_id = u.id
       ${where} ORDER BY m.joined_at LIMIT ${limit} OFFSET ${offset}`, params
    )

    return { members: rows, total, page, limit, totalPages: Math.ceil(total / limit) }
  },

  async getUserOrgs(userId: string): Promise<Array<Organization & { role: string }>> {
    await ensureOrgTables()
    const { rows } = await db.query<Organization & { role: string }>(
      `SELECT o.*, m.role FROM vibekit_organizations o
       JOIN vibekit_org_members m ON o.id = m.org_id
       WHERE m.user_id = $1 ORDER BY o.name`, [userId]
    )
    return rows
  },

  async invite(orgId: string, options: OrgInviteOptions): Promise<OrgInvitation> {
    await ensureOrgTables()
    const adapter = db._getAdapter()
    const id = crypto.randomUUID()
    const token = crypto.randomBytes(32).toString('base64url')
    const expiresInDays = options.expiresInDays ?? 7
    const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()

    await adapter.execute(
      `INSERT INTO vibekit_org_invitations (id, org_id, email, role, invited_by, token, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, orgId, options.email.toLowerCase(), options.role || 'member', options.invitedBy || null, token, expiresAt]
    )

    console.log(`\n📨 Org invitation for ${options.email}: token=${token}\n`)
    return (await adapter.queryOne<OrgInvitation>(`SELECT * FROM vibekit_org_invitations WHERE id = $1`, [id]))!
  },

  async acceptInvite(token: string, userId: string): Promise<{ orgId: string; role: string }> {
    await ensureOrgTables()
    const adapter = db._getAdapter()
    const invite = await adapter.queryOne<OrgInvitation>(
      `SELECT * FROM vibekit_org_invitations WHERE token = $1 AND accepted = 0`, [token]
    )
    if (!invite) throw new Error('Invalid or expired invitation')
    if (new Date(invite.expires_at) < new Date()) throw new Error('Invitation expired')

    await adapter.execute(`UPDATE vibekit_org_invitations SET accepted = 1 WHERE id = $1`, [invite.id])
    await organizations.addMember(invite.org_id, userId, invite.role)
    return { orgId: invite.org_id, role: invite.role }
  },
}
