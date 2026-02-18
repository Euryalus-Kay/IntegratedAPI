import crypto from 'node:crypto'
import { db } from '../db/client.js'
import { ensureAuthTables } from './internals.js'
import type { Permission, Role, RolePermission, UserRole } from './types.js'

const PERM_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS vibekit_permissions (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vibekit_roles (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS vibekit_role_permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES vibekit_roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES vibekit_permissions(id) ON DELETE CASCADE,
  UNIQUE(role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS vibekit_user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vibekit_users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES vibekit_roles(id) ON DELETE CASCADE,
  assigned_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, role_id)
);
CREATE INDEX IF NOT EXISTS idx_user_roles ON vibekit_user_roles(user_id);
`

let _permInitialized = false
async function ensurePermTables(): Promise<void> {
  await ensureAuthTables()
  if (_permInitialized) return
  const adapter = db._getAdapter()
  for (const stmt of PERM_TABLES_SQL.split(';').filter(s => s.trim())) {
    await adapter.execute(stmt + ';')
  }
  _permInitialized = true
}

export const permissions = {
  // ── Permissions ──────────────────────────────
  async createPermission(name: string, description?: string): Promise<Permission> {
    await ensurePermTables()
    const id = crypto.randomUUID()
    await db.execute(`INSERT INTO vibekit_permissions (id, name, description) VALUES ($1, $2, $3)`, [id, name, description || null])
    return (await db.queryOne<Permission>(`SELECT * FROM vibekit_permissions WHERE id = $1`, [id]))!
  },

  async deletePermission(name: string): Promise<void> {
    await ensurePermTables()
    await db.execute(`DELETE FROM vibekit_permissions WHERE name = $1`, [name])
  },

  async listPermissions(): Promise<Permission[]> {
    await ensurePermTables()
    const { rows } = await db.query<Permission>(`SELECT * FROM vibekit_permissions ORDER BY name`)
    return rows
  },

  // ── Roles ────────────────────────────────────
  async createRole(name: string, description?: string): Promise<Role> {
    await ensurePermTables()
    const id = crypto.randomUUID()
    await db.execute(`INSERT INTO vibekit_roles (id, name, description) VALUES ($1, $2, $3)`, [id, name, description || null])
    return (await db.queryOne<Role>(`SELECT * FROM vibekit_roles WHERE id = $1`, [id]))!
  },

  async deleteRole(name: string): Promise<void> {
    await ensurePermTables()
    await db.execute(`DELETE FROM vibekit_roles WHERE name = $1`, [name])
  },

  async listRoles(): Promise<Role[]> {
    await ensurePermTables()
    const { rows } = await db.query<Role>(`SELECT * FROM vibekit_roles ORDER BY name`)
    return rows
  },

  // ── Role-Permission mapping ──────────────────
  async grantPermission(roleName: string, permissionName: string): Promise<void> {
    await ensurePermTables()
    const role = await db.queryOne<Role>(`SELECT * FROM vibekit_roles WHERE name = $1`, [roleName])
    const perm = await db.queryOne<Permission>(`SELECT * FROM vibekit_permissions WHERE name = $1`, [permissionName])
    if (!role) throw new Error(`Role "${roleName}" not found`)
    if (!perm) throw new Error(`Permission "${permissionName}" not found`)
    await db.execute(
      `INSERT OR IGNORE INTO vibekit_role_permissions (id, role_id, permission_id) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), role.id, perm.id]
    )
  },

  async revokePermission(roleName: string, permissionName: string): Promise<void> {
    await ensurePermTables()
    const role = await db.queryOne<Role>(`SELECT * FROM vibekit_roles WHERE name = $1`, [roleName])
    const perm = await db.queryOne<Permission>(`SELECT * FROM vibekit_permissions WHERE name = $1`, [permissionName])
    if (!role || !perm) return
    await db.execute(
      `DELETE FROM vibekit_role_permissions WHERE role_id = $1 AND permission_id = $2`,
      [role.id, perm.id]
    )
  },

  async getRolePermissions(roleName: string): Promise<Permission[]> {
    await ensurePermTables()
    const { rows } = await db.query<Permission>(
      `SELECT p.* FROM vibekit_permissions p
       JOIN vibekit_role_permissions rp ON p.id = rp.permission_id
       JOIN vibekit_roles r ON rp.role_id = r.id
       WHERE r.name = $1 ORDER BY p.name`, [roleName]
    )
    return rows
  },

  // ── User-Role mapping ────────────────────────
  async assignRole(userId: string, roleName: string): Promise<void> {
    await ensurePermTables()
    const role = await db.queryOne<Role>(`SELECT * FROM vibekit_roles WHERE name = $1`, [roleName])
    if (!role) throw new Error(`Role "${roleName}" not found`)
    await db.execute(
      `INSERT OR IGNORE INTO vibekit_user_roles (id, user_id, role_id) VALUES ($1, $2, $3)`,
      [crypto.randomUUID(), userId, role.id]
    )
  },

  async removeRole(userId: string, roleName: string): Promise<void> {
    await ensurePermTables()
    const role = await db.queryOne<Role>(`SELECT * FROM vibekit_roles WHERE name = $1`, [roleName])
    if (!role) return
    await db.execute(`DELETE FROM vibekit_user_roles WHERE user_id = $1 AND role_id = $2`, [userId, role.id])
  },

  async getUserRoles(userId: string): Promise<Role[]> {
    await ensurePermTables()
    const { rows } = await db.query<Role>(
      `SELECT r.* FROM vibekit_roles r
       JOIN vibekit_user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1 ORDER BY r.name`, [userId]
    )
    return rows
  },

  async getUserPermissions(userId: string): Promise<Permission[]> {
    await ensurePermTables()
    const { rows } = await db.query<Permission>(
      `SELECT DISTINCT p.* FROM vibekit_permissions p
       JOIN vibekit_role_permissions rp ON p.id = rp.permission_id
       JOIN vibekit_user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1 ORDER BY p.name`, [userId]
    )
    return rows
  },

  async userHasPermission(userId: string, permissionName: string): Promise<boolean> {
    await ensurePermTables()
    const perm = await db.queryOne<{ id: string }>(
      `SELECT p.id FROM vibekit_permissions p
       JOIN vibekit_role_permissions rp ON p.id = rp.permission_id
       JOIN vibekit_user_roles ur ON rp.role_id = ur.role_id
       WHERE ur.user_id = $1 AND p.name = $2 LIMIT 1`, [userId, permissionName]
    )
    return !!perm
  },

  async userHasRole(userId: string, roleName: string): Promise<boolean> {
    await ensurePermTables()
    const role = await db.queryOne<{ id: string }>(
      `SELECT r.id FROM vibekit_roles r
       JOIN vibekit_user_roles ur ON r.id = ur.role_id
       WHERE ur.user_id = $1 AND r.name = $2 LIMIT 1`, [userId, roleName]
    )
    return !!role
  },
}
