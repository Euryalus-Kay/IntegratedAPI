import type {
  DatabaseAdapter,
  RLSManager,
  RLSPolicy,
  RLSPolicyDefinition,
  RLSOperation,
} from './types.js'

/**
 * Row Level Security (RLS) implementation for SQLite.
 *
 * Policies are stored in a `_vibekit_rls_policies` meta-table and evaluated
 * in-process when queries flow through the QueryBuilder.  Enabled tables are
 * tracked in `_vibekit_rls_enabled`.
 *
 * Because SQLite has no native RLS, the enforcement is done at the application
 * layer: the RLS manager exposes a `checkRow` method that the QueryBuilder
 * calls to filter / gate rows.
 */

/** In-memory registry mapping "table:policyName" -> check function. */
const _policyFunctions: Map<string, (row: Record<string, unknown>, user: Record<string, unknown>) => boolean> = new Map()

export function createRLSManager(adapter: DatabaseAdapter): RLSManager {
  let initialized = false

  async function ensureTables(): Promise<void> {
    if (initialized) return
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_rls_enabled (
        "table_name" TEXT PRIMARY KEY,
        "enabled_at" TEXT DEFAULT (datetime('now'))
      )
    `)
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_rls_policies (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "table_name" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "operation" TEXT NOT NULL,
        "check_fn" TEXT NOT NULL,
        "created_at" TEXT DEFAULT (datetime('now')),
        UNIQUE("table_name", "name")
      )
    `)
    // Load existing policies into memory
    const { rows } = await adapter.query<{
      table_name: string
      name: string
      operation: string
      check_fn: string
    }>('SELECT * FROM _vibekit_rls_policies')

    for (const row of rows) {
      const key = `${row.table_name}:${row.name}`
      if (!_policyFunctions.has(key)) {
        try {
          // Reconstruct function from stored source
          // The stored check_fn is the function body as a string
          const fn = new Function('row', 'user', row.check_fn) as (
            row: Record<string, unknown>,
            user: Record<string, unknown>,
          ) => boolean
          _policyFunctions.set(key, fn)
        } catch {
          // If we cannot reconstruct, skip (policy will deny by default)
        }
      }
    }
    initialized = true
  }

  const manager: RLSManager = {
    async enable(table: string): Promise<void> {
      await ensureTables()
      await adapter.execute(
        `INSERT OR IGNORE INTO _vibekit_rls_enabled ("table_name") VALUES ($1)`,
        [table],
      )
    },

    async disable(table: string): Promise<void> {
      await ensureTables()
      await adapter.execute(
        `DELETE FROM _vibekit_rls_enabled WHERE "table_name" = $1`,
        [table],
      )
      // Remove all policies for this table from memory and DB
      const { rows } = await adapter.query<{ name: string }>(
        `SELECT "name" FROM _vibekit_rls_policies WHERE "table_name" = $1`,
        [table],
      )
      for (const row of rows) {
        _policyFunctions.delete(`${table}:${row.name}`)
      }
      await adapter.execute(
        `DELETE FROM _vibekit_rls_policies WHERE "table_name" = $1`,
        [table],
      )
    },

    async addPolicy(table: string, policy: RLSPolicyDefinition): Promise<void> {
      await ensureTables()

      // Serialize the check function body for storage
      const fnSource = policy.check.toString()
      // Store the function source so we can reconstruct it later
      const checkFnBody = extractFunctionBody(fnSource)

      await adapter.execute(
        `INSERT OR REPLACE INTO _vibekit_rls_policies ("table_name", "name", "operation", "check_fn")
         VALUES ($1, $2, $3, $4)`,
        [table, policy.name, policy.operation, checkFnBody],
      )

      // Register in-memory
      const key = `${table}:${policy.name}`
      _policyFunctions.set(key, policy.check)
    },

    async removePolicy(table: string, policyName: string): Promise<void> {
      await ensureTables()
      await adapter.execute(
        `DELETE FROM _vibekit_rls_policies WHERE "table_name" = $1 AND "name" = $2`,
        [table, policyName],
      )
      _policyFunctions.delete(`${table}:${policyName}`)
    },

    async listPolicies(table?: string): Promise<RLSPolicy[]> {
      await ensureTables()
      let sql = 'SELECT * FROM _vibekit_rls_policies'
      const params: unknown[] = []
      if (table) {
        sql += ' WHERE "table_name" = $1'
        params.push(table)
      }
      sql += ' ORDER BY "table_name", "name"'

      const { rows } = await adapter.query<{
        name: string
        table_name: string
        operation: string
        check_fn: string
      }>(sql, params)

      return rows.map(r => ({
        name: r.name,
        table: r.table_name,
        operation: r.operation as RLSOperation,
        checkFn: r.check_fn,
      }))
    },

    async isEnabled(table: string): Promise<boolean> {
      await ensureTables()
      const row = await adapter.queryOne<{ table_name: string }>(
        `SELECT "table_name" FROM _vibekit_rls_enabled WHERE "table_name" = $1`,
        [table],
      )
      return row !== null
    },

    checkRow(
      table: string,
      operation: RLSOperation,
      row: Record<string, unknown>,
      user: Record<string, unknown>,
    ): boolean {
      // Gather all policies for this table + operation
      const applicablePolicies: Array<(row: Record<string, unknown>, user: Record<string, unknown>) => boolean> = []

      for (const [key, fn] of _policyFunctions.entries()) {
        if (!key.startsWith(`${table}:`)) continue
        // We need to check the operation matches; look it up from the key
        // Since we need the operation, we store it alongside. For speed, we
        // maintain a parallel map.
        applicablePolicies.push(fn)
      }

      // To properly filter by operation, let's maintain a second lookup.
      // We'll use the _policyOperations map.
      const matchingFns = getMatchingPolicies(table, operation)
      if (matchingFns.length === 0) {
        // No policies defined -> deny by default when RLS is enabled
        // (matches Postgres behavior: RLS enabled + no policies = deny all)
        return false
      }

      // OR semantics: if ANY policy allows, the row passes (like Postgres)
      for (const fn of matchingFns) {
        try {
          if (fn(row, user)) return true
        } catch {
          // Policy function threw -> treat as deny
        }
      }
      return false
    },
  }

  return manager
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Secondary map: "table:operation" -> Set of check functions. */
const _policyOperations: Map<string, Set<string>> = new Map()

/**
 * Register an operation mapping when a policy is added.
 * Called internally by addPolicy (we patch it above through _policyFunctions).
 */
function getMatchingPolicies(
  table: string,
  operation: RLSOperation,
): Array<(row: Record<string, unknown>, user: Record<string, unknown>) => boolean> {
  const fns: Array<(row: Record<string, unknown>, user: Record<string, unknown>) => boolean> = []
  // We iterate _policyFunctions and cross-reference with stored metadata
  // For performance in production you'd want a more efficient index, but
  // for a local-first SQLite DB this is perfectly fine.
  for (const [key, fn] of _policyFunctions.entries()) {
    if (!key.startsWith(`${table}:`)) continue
    // The key is "table:policyName" – we need to know the operation.
    // We store it in _policyOperations.
    const opKey = key
    const ops = _policyOperations.get(opKey)
    if (ops && ops.has(operation)) {
      fns.push(fn)
    }
  }
  return fns
}

/**
 * Enhanced addPolicy that also tracks operation mapping.
 * We re-export createRLSManager which patches this internally.
 */
export function registerPolicyOperation(table: string, policyName: string, operation: RLSOperation): void {
  const key = `${table}:${policyName}`
  if (!_policyOperations.has(key)) {
    _policyOperations.set(key, new Set())
  }
  _policyOperations.get(key)!.add(operation)
}

export function unregisterPolicyOperation(table: string, policyName: string): void {
  _policyOperations.delete(`${table}:${policyName}`)
}

/**
 * Extract the body of a function from its toString() representation.
 */
function extractFunctionBody(fnStr: string): string {
  // Arrow function: (row, user) => expression  or (row, user) => { ... }
  const arrowMatch = fnStr.match(/=>\s*\{?([\s\S]*)\}?\s*$/)
  if (arrowMatch) {
    let body = arrowMatch[1].trim()
    // Remove trailing } if it was a block body
    if (fnStr.includes('=>') && fnStr.trim().endsWith('}')) {
      body = body.replace(/\}$/, '').trim()
    }
    // If it's a single expression (no { }), wrap in return
    if (!fnStr.match(/=>\s*\{/)) {
      return `return ${body}`
    }
    return body
  }
  // Regular function: function(row, user) { ... }
  const funcMatch = fnStr.match(/\{([\s\S]*)\}\s*$/)
  if (funcMatch) {
    return funcMatch[1].trim()
  }
  return fnStr
}

// Patch the createRLSManager to integrate operation tracking
const _origCreateRLS = createRLSManager
export { _origCreateRLS }

/**
 * Factory wrapper that ensures operation tracking is wired into addPolicy/removePolicy.
 */
export function createRLSManagerWithTracking(adapter: DatabaseAdapter): RLSManager {
  const mgr = createRLSManager(adapter)

  const origAdd = mgr.addPolicy.bind(mgr)
  const origRemove = mgr.removePolicy.bind(mgr)
  const origDisable = mgr.disable.bind(mgr)

  mgr.addPolicy = async (table: string, policy: RLSPolicyDefinition): Promise<void> => {
    await origAdd(table, policy)
    registerPolicyOperation(table, policy.name, policy.operation)
  }

  mgr.removePolicy = async (table: string, policyName: string): Promise<void> => {
    await origRemove(table, policyName)
    unregisterPolicyOperation(table, policyName)
  }

  mgr.disable = async (table: string): Promise<void> => {
    // Remove all operation tracking for this table
    for (const key of [..._policyOperations.keys()]) {
      if (key.startsWith(`${table}:`)) {
        _policyOperations.delete(key)
      }
    }
    await origDisable(table)
  }

  return mgr
}
