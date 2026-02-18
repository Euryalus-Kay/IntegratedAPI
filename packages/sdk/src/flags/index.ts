/**
 * VibeKit Feature Flags / A/B Testing Module
 * In-memory + database-backed feature flags with targeting rules,
 * percentage rollouts, experiments, and evaluation metrics.
 *
 * Replaces: Vercel Flags, LaunchDarkly, Unleash, Flagsmith
 */

import type {
  FlagType,
  FlagValue,
  FlagTargetingRule,
  FlagConfig,
  FlagCreateOptions,
  FlagUpdateOptions,
  EvaluationContext,
  EvaluationResult,
  FlagEvaluationMetrics,
  ExperimentVariant,
  ExperimentConfig,
  ExperimentCreateOptions,
  ExperimentAssignment,
  ExperimentResults,
  FlagDbAdapter,
  FlagManagerConfig,
  FlagManager,
} from './types.js'

export type {
  FlagType,
  FlagValue,
  FlagTargetingRule,
  FlagConfig,
  FlagCreateOptions,
  FlagUpdateOptions,
  EvaluationContext,
  EvaluationResult,
  FlagEvaluationMetrics,
  ExperimentVariant,
  ExperimentConfig,
  ExperimentCreateOptions,
  ExperimentAssignment,
  ExperimentResults,
  FlagDbAdapter,
  FlagManagerConfig,
  FlagManager,
}

// ── Helpers ──────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function deterministicHash(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    const chr = input.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return Math.abs(hash)
}

function normalizeHash(input: string): number {
  return (deterministicHash(input) % 10000) / 100
}

function inferType(value: FlagValue): FlagType {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'string') return 'string'
  return 'json'
}

// ── Rule Matching ────────────────────────────────────────────────────────

function evaluateOperator(operator: FlagTargetingRule['operator'], actual: unknown, expected: unknown): boolean {
  switch (operator) {
    case 'eq':
      return actual === expected
    case 'neq':
      return actual !== expected
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case 'in':
      return Array.isArray(expected) && expected.includes(actual)
    case 'notIn':
      return Array.isArray(expected) && !expected.includes(actual)
    case 'contains':
      return typeof actual === 'string' && typeof expected === 'string' && actual.includes(expected)
    case 'startsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.startsWith(expected)
    case 'endsWith':
      return typeof actual === 'string' && typeof expected === 'string' && actual.endsWith(expected)
    case 'regex':
      if (typeof actual !== 'string' || typeof expected !== 'string') return false
      try {
        return new RegExp(expected).test(actual)
      } catch {
        return false
      }
    default:
      return false
  }
}

function matchRule(rule: FlagTargetingRule, context: EvaluationContext): boolean {
  const attributeValue = context.attributes?.[rule.attribute] ?? (context as Record<string, unknown>)[rule.attribute]
  return evaluateOperator(rule.operator, attributeValue, rule.value)
}

// ── Database initialization ──────────────────────────────────────────────

async function initDbTables(db: FlagDbAdapter): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_flags (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'boolean',
      enabled INTEGER NOT NULL DEFAULT 1,
      default_value TEXT NOT NULL,
      rules TEXT NOT NULL DEFAULT '[]',
      percentage REAL NOT NULL DEFAULT 100,
      specific_users TEXT NOT NULL DEFAULT '[]',
      specific_groups TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_experiments (
      name TEXT PRIMARY KEY,
      description TEXT NOT NULL DEFAULT '',
      flag_name TEXT NOT NULL,
      variants TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_experiment_assignments (
      id TEXT PRIMARY KEY,
      experiment_name TEXT NOT NULL,
      variant_name TEXT NOT NULL,
      user_id TEXT NOT NULL,
      assigned_at TEXT NOT NULL
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_flag_evaluations (
      id TEXT PRIMARY KEY,
      flag_name TEXT NOT NULL,
      result_value TEXT NOT NULL,
      reason TEXT NOT NULL,
      evaluated_at TEXT NOT NULL
    )
  `)
}

// ── Serialize / Deserialize helpers ──────────────────────────────────────

function serializeFlag(flag: FlagConfig): Record<string, unknown> {
  return {
    name: flag.name,
    description: flag.description,
    type: flag.type,
    enabled: flag.enabled ? 1 : 0,
    default_value: JSON.stringify(flag.defaultValue),
    rules: JSON.stringify(flag.rules),
    percentage: flag.percentage,
    specific_users: JSON.stringify(flag.specificUsers),
    specific_groups: JSON.stringify(flag.specificGroups),
    created_at: flag.createdAt,
    updated_at: flag.updatedAt,
  }
}

function deserializeFlag(row: Record<string, unknown>): FlagConfig {
  return {
    name: row.name as string,
    description: row.description as string,
    type: row.type as FlagType,
    enabled: row.enabled === 1 || row.enabled === true,
    defaultValue: JSON.parse(row.default_value as string) as FlagValue,
    rules: JSON.parse(row.rules as string) as FlagTargetingRule[],
    percentage: row.percentage as number,
    specificUsers: JSON.parse(row.specific_users as string) as string[],
    specificGroups: JSON.parse(row.specific_groups as string) as string[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function deserializeExperiment(row: Record<string, unknown>): ExperimentConfig {
  return {
    name: row.name as string,
    description: row.description as string,
    flagName: row.flag_name as string,
    variants: JSON.parse(row.variants as string) as ExperimentVariant[],
    status: row.status as ExperimentConfig['status'],
    startedAt: row.started_at as string | null,
    completedAt: row.completed_at as string | null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

// ── Main Factory ─────────────────────────────────────────────────────────

export function createFlagManager(config: FlagManagerConfig = {}): FlagManager {
  const useDb = config.persistence === 'database' && config.db !== undefined
  const db = config.db ?? null

  // In-memory stores (always used as cache, primary storage when no db)
  const flagCache: Map<string, FlagConfig> = new Map()
  const experimentCache: Map<string, ExperimentConfig> = new Map()
  const assignmentStore: ExperimentAssignment[] = []
  const evaluationStore: Array<{ flagName: string; resultValue: string; reason: string; evaluatedAt: string }> = []
  let dbInitialized = false

  // ── Ensure DB tables ───────────────────────────────────────────────

  async function ensureDb(): Promise<void> {
    if (!useDb || dbInitialized) return
    await initDbTables(db!)
    dbInitialized = true
  }

  // ── DB persistence helpers ─────────────────────────────────────────

  async function saveFlag(flag: FlagConfig): Promise<void> {
    flagCache.set(flag.name, flag)
    if (!useDb) return
    await ensureDb()
    const s = serializeFlag(flag)
    await db!.execute(
      `INSERT OR REPLACE INTO _vibekit_flags (name, description, type, enabled, default_value, rules, percentage, specific_users, specific_groups, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [s.name, s.description, s.type, s.enabled, s.default_value, s.rules, s.percentage, s.specific_users, s.specific_groups, s.created_at, s.updated_at],
    )
  }

  async function loadFlag(name: string): Promise<FlagConfig | null> {
    const cached = flagCache.get(name)
    if (cached) return cached
    if (!useDb) return null
    await ensureDb()
    const result = await db!.query<Record<string, unknown>>(
      `SELECT * FROM _vibekit_flags WHERE name = $1`,
      [name],
    )
    if (result.rows.length === 0) return null
    const flag = deserializeFlag(result.rows[0])
    flagCache.set(name, flag)
    return flag
  }

  async function loadAllFlags(): Promise<FlagConfig[]> {
    if (!useDb) return [...flagCache.values()]
    await ensureDb()
    const result = await db!.query<Record<string, unknown>>(
      `SELECT * FROM _vibekit_flags ORDER BY created_at ASC`,
    )
    const flags: FlagConfig[] = []
    for (const row of result.rows) {
      const flag = deserializeFlag(row)
      flagCache.set(flag.name, flag)
      flags.push(flag)
    }
    return flags
  }

  async function deleteFlagFromDb(name: string): Promise<void> {
    flagCache.delete(name)
    if (!useDb) return
    await ensureDb()
    await db!.execute(`DELETE FROM _vibekit_flags WHERE name = $1`, [name])
    await db!.execute(`DELETE FROM _vibekit_flag_evaluations WHERE flag_name = $1`, [name])
  }

  async function recordEvaluation(flagName: string, value: FlagValue, reason: string): Promise<void> {
    const entry = {
      flagName,
      resultValue: JSON.stringify(value),
      reason,
      evaluatedAt: new Date().toISOString(),
    }
    evaluationStore.push(entry)
    if (evaluationStore.length > 100000) {
      evaluationStore.splice(0, evaluationStore.length - 100000)
    }
    if (useDb) {
      await ensureDb()
      await db!.execute(
        `INSERT INTO _vibekit_flag_evaluations (id, flag_name, result_value, reason, evaluated_at) VALUES ($1, $2, $3, $4, $5)`,
        [generateId(), entry.flagName, entry.resultValue, entry.reason, entry.evaluatedAt],
      )
    }
  }

  async function saveExperiment(exp: ExperimentConfig): Promise<void> {
    experimentCache.set(exp.name, exp)
    if (!useDb) return
    await ensureDb()
    await db!.execute(
      `INSERT OR REPLACE INTO _vibekit_experiments (name, description, flag_name, variants, status, started_at, completed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [exp.name, exp.description, exp.flagName, JSON.stringify(exp.variants), exp.status, exp.startedAt, exp.completedAt, exp.createdAt, exp.updatedAt],
    )
  }

  async function loadExperiment(name: string): Promise<ExperimentConfig | null> {
    const cached = experimentCache.get(name)
    if (cached) return cached
    if (!useDb) return null
    await ensureDb()
    const result = await db!.query<Record<string, unknown>>(
      `SELECT * FROM _vibekit_experiments WHERE name = $1`,
      [name],
    )
    if (result.rows.length === 0) return null
    const exp = deserializeExperiment(result.rows[0])
    experimentCache.set(name, exp)
    return exp
  }

  async function saveAssignment(assignment: ExperimentAssignment): Promise<void> {
    assignmentStore.push(assignment)
    if (useDb) {
      await ensureDb()
      await db!.execute(
        `INSERT INTO _vibekit_experiment_assignments (id, experiment_name, variant_name, user_id, assigned_at) VALUES ($1, $2, $3, $4, $5)`,
        [generateId(), assignment.experimentName, assignment.variantName, assignment.userId, assignment.assignedAt],
      )
    }
  }

  // ── Evaluation core ────────────────────────────────────────────────

  function evaluateFlag(flag: FlagConfig, context: EvaluationContext = {}): EvaluationResult {
    if (!flag.enabled) {
      return { name: flag.name, value: flag.defaultValue, reason: 'disabled' }
    }

    // Check specific users
    if (context.userId && flag.specificUsers.length > 0) {
      if (flag.specificUsers.includes(context.userId)) {
        return { name: flag.name, value: flag.defaultValue, reason: 'specific_user' }
      }
    }

    // Check specific groups
    if (context.groupId && flag.specificGroups.length > 0) {
      if (flag.specificGroups.includes(context.groupId)) {
        return { name: flag.name, value: flag.defaultValue, reason: 'specific_group' }
      }
    }

    // Check targeting rules (sorted by priority ascending)
    const sortedRules = [...flag.rules].sort((a, b) => a.priority - b.priority)
    for (const rule of sortedRules) {
      if (matchRule(rule, context)) {
        return { name: flag.name, value: rule.flagValue, reason: 'rule', ruleId: rule.id }
      }
    }

    // Check percentage rollout
    if (flag.percentage < 100) {
      const hashInput = `${flag.name}:${context.userId ?? 'anonymous'}`
      const hashPct = normalizeHash(hashInput)
      if (hashPct >= flag.percentage) {
        // Outside the rollout — return the "off" value
        const offValue = flag.type === 'boolean' ? false : flag.defaultValue
        return { name: flag.name, value: offValue, reason: 'percentage' }
      }
    }

    return { name: flag.name, value: flag.defaultValue, reason: 'default' }
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    async create(name: string, options: FlagCreateOptions): Promise<FlagConfig> {
      const existing = await loadFlag(name)
      if (existing) {
        throw new Error(`Flag "${name}" already exists`)
      }

      const now = new Date().toISOString()
      const flag: FlagConfig = {
        name,
        description: options.description ?? '',
        type: options.type ?? inferType(options.defaultValue),
        enabled: options.enabled ?? true,
        defaultValue: options.defaultValue,
        rules: (options.rules ?? []).map(r => ({ ...r, id: generateId() })),
        percentage: options.percentage ?? 100,
        specificUsers: options.specificUsers ?? [],
        specificGroups: options.specificGroups ?? [],
        createdAt: now,
        updatedAt: now,
      }

      await saveFlag(flag)
      return flag
    },

    async get(name: string): Promise<FlagConfig | null> {
      return loadFlag(name)
    },

    async evaluate(name: string, context: EvaluationContext = {}): Promise<EvaluationResult> {
      const flag = await loadFlag(name)
      if (!flag) {
        throw new Error(`Flag "${name}" does not exist`)
      }
      const result = evaluateFlag(flag, context)
      await recordEvaluation(name, result.value, result.reason)
      return result
    },

    async evaluateAll(context: EvaluationContext = {}): Promise<EvaluationResult[]> {
      const flags = await loadAllFlags()
      const results: EvaluationResult[] = []
      for (const flag of flags) {
        const result = evaluateFlag(flag, context)
        await recordEvaluation(flag.name, result.value, result.reason)
        results.push(result)
      }
      return results
    },

    async update(name: string, updates: FlagUpdateOptions): Promise<FlagConfig> {
      const flag = await loadFlag(name)
      if (!flag) {
        throw new Error(`Flag "${name}" does not exist`)
      }

      if (updates.description !== undefined) flag.description = updates.description
      if (updates.enabled !== undefined) flag.enabled = updates.enabled
      if (updates.defaultValue !== undefined) flag.defaultValue = updates.defaultValue
      if (updates.percentage !== undefined) flag.percentage = updates.percentage
      if (updates.specificUsers !== undefined) flag.specificUsers = updates.specificUsers
      if (updates.specificGroups !== undefined) flag.specificGroups = updates.specificGroups
      flag.updatedAt = new Date().toISOString()

      await saveFlag(flag)
      return flag
    },

    async delete(name: string): Promise<void> {
      const flag = await loadFlag(name)
      if (!flag) {
        throw new Error(`Flag "${name}" does not exist`)
      }
      await deleteFlagFromDb(name)
    },

    async list(): Promise<FlagConfig[]> {
      return loadAllFlags()
    },

    async enable(name: string): Promise<void> {
      const flag = await loadFlag(name)
      if (!flag) throw new Error(`Flag "${name}" does not exist`)
      flag.enabled = true
      flag.updatedAt = new Date().toISOString()
      await saveFlag(flag)
    },

    async disable(name: string): Promise<void> {
      const flag = await loadFlag(name)
      if (!flag) throw new Error(`Flag "${name}" does not exist`)
      flag.enabled = false
      flag.updatedAt = new Date().toISOString()
      await saveFlag(flag)
    },

    async setPercentage(name: string, percentage: number): Promise<void> {
      if (percentage < 0 || percentage > 100) {
        throw new Error(`Percentage must be between 0 and 100, got ${percentage}`)
      }
      const flag = await loadFlag(name)
      if (!flag) throw new Error(`Flag "${name}" does not exist`)
      flag.percentage = percentage
      flag.updatedAt = new Date().toISOString()
      await saveFlag(flag)
    },

    async addRule(name: string, rule: Omit<FlagTargetingRule, 'id'>): Promise<FlagTargetingRule> {
      const flag = await loadFlag(name)
      if (!flag) throw new Error(`Flag "${name}" does not exist`)

      const fullRule: FlagTargetingRule = { ...rule, id: generateId() }
      flag.rules.push(fullRule)
      flag.updatedAt = new Date().toISOString()
      await saveFlag(flag)
      return fullRule
    },

    async removeRule(name: string, ruleId: string): Promise<void> {
      const flag = await loadFlag(name)
      if (!flag) throw new Error(`Flag "${name}" does not exist`)

      const idx = flag.rules.findIndex(r => r.id === ruleId)
      if (idx === -1) throw new Error(`Rule "${ruleId}" not found on flag "${name}"`)
      flag.rules.splice(idx, 1)
      flag.updatedAt = new Date().toISOString()
      await saveFlag(flag)
    },

    async getMetrics(name: string): Promise<FlagEvaluationMetrics> {
      const flag = await loadFlag(name)
      if (!flag) throw new Error(`Flag "${name}" does not exist`)

      let evals: Array<{ resultValue: string; evaluatedAt: string }>

      if (useDb) {
        await ensureDb()
        const result = await db!.query<{ result_value: string; evaluated_at: string }>(
          `SELECT result_value, evaluated_at FROM _vibekit_flag_evaluations WHERE flag_name = $1 ORDER BY evaluated_at ASC`,
          [name],
        )
        evals = result.rows.map(r => ({ resultValue: r.result_value, evaluatedAt: r.evaluated_at }))
      } else {
        evals = evaluationStore
          .filter(e => e.flagName === name)
          .map(e => ({ resultValue: e.resultValue, evaluatedAt: e.evaluatedAt }))
      }

      let trueCount = 0
      let falseCount = 0
      const variantCounts: Record<string, number> = {}

      for (const e of evals) {
        const parsed = JSON.parse(e.resultValue)
        if (parsed === true) trueCount++
        else if (parsed === false) falseCount++
        const key = String(parsed)
        variantCounts[key] = (variantCounts[key] ?? 0) + 1
      }

      return {
        name,
        totalEvaluations: evals.length,
        trueCount,
        falseCount,
        variantCounts,
        lastEvaluatedAt: evals.length > 0 ? evals[evals.length - 1].evaluatedAt : null,
      }
    },

    async createExperiment(name: string, options: ExperimentCreateOptions): Promise<ExperimentConfig> {
      const existing = await loadExperiment(name)
      if (existing) throw new Error(`Experiment "${name}" already exists`)

      // Validate total weight
      const totalWeight = options.variants.reduce((sum, v) => sum + v.weight, 0)
      if (Math.abs(totalWeight - 100) > 0.01) {
        throw new Error(`Variant weights must sum to 100, got ${totalWeight}`)
      }

      const now = new Date().toISOString()
      const experiment: ExperimentConfig = {
        name,
        description: options.description ?? '',
        flagName: options.flagName,
        variants: options.variants,
        status: 'running',
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      }

      await saveExperiment(experiment)
      return experiment
    },

    async getExperimentResults(name: string): Promise<ExperimentResults> {
      const experiment = await loadExperiment(name)
      if (!experiment) throw new Error(`Experiment "${name}" does not exist`)

      let assignments: Array<{ variantName: string }>

      if (useDb) {
        await ensureDb()
        const result = await db!.query<{ variant_name: string }>(
          `SELECT variant_name FROM _vibekit_experiment_assignments WHERE experiment_name = $1`,
          [name],
        )
        assignments = result.rows.map(r => ({ variantName: r.variant_name }))
      } else {
        assignments = assignmentStore
          .filter(a => a.experimentName === name)
          .map(a => ({ variantName: a.variantName }))
      }

      const assignmentCountByVariant: Record<string, number> = {}
      for (const a of assignments) {
        assignmentCountByVariant[a.variantName] = (assignmentCountByVariant[a.variantName] ?? 0) + 1
      }

      const totalAssignments = assignments.length

      const variantResults = experiment.variants.map(v => ({
        name: v.name,
        value: v.value,
        weight: v.weight,
        assignments: assignmentCountByVariant[v.name] ?? 0,
        conversionRate: totalAssignments > 0
          ? Math.round(((assignmentCountByVariant[v.name] ?? 0) / totalAssignments) * 10000) / 100
          : 0,
      }))

      return {
        name: experiment.name,
        status: experiment.status,
        variants: variantResults,
        totalAssignments,
        startedAt: experiment.startedAt,
        completedAt: experiment.completedAt,
      }
    },
  }
}
