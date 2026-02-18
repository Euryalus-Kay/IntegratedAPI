/**
 * VibeKit Feature Flags / A/B Testing — Type Definitions
 */

// ── Flag Types ───────────────────────────────────────────────────────────

export type FlagType = 'boolean' | 'string' | 'number' | 'json'

export type FlagValue = boolean | string | number | Record<string, unknown>

export interface FlagTargetingRule {
  id: string
  attribute: string
  operator: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn' | 'contains' | 'startsWith' | 'endsWith' | 'regex'
  value: unknown
  flagValue: FlagValue
  priority: number
}

export interface FlagConfig {
  name: string
  description: string
  type: FlagType
  enabled: boolean
  defaultValue: FlagValue
  rules: FlagTargetingRule[]
  percentage: number
  specificUsers: string[]
  specificGroups: string[]
  createdAt: string
  updatedAt: string
}

export interface FlagCreateOptions {
  description?: string
  type?: FlagType
  enabled?: boolean
  defaultValue: FlagValue
  percentage?: number
  rules?: Omit<FlagTargetingRule, 'id'>[]
  specificUsers?: string[]
  specificGroups?: string[]
}

export interface FlagUpdateOptions {
  description?: string
  enabled?: boolean
  defaultValue?: FlagValue
  percentage?: number
  specificUsers?: string[]
  specificGroups?: string[]
}

// ── Evaluation ───────────────────────────────────────────────────────────

export interface EvaluationContext {
  userId?: string
  groupId?: string
  attributes?: Record<string, unknown>
  [key: string]: unknown
}

export interface EvaluationResult {
  name: string
  value: FlagValue
  reason: 'disabled' | 'default' | 'rule' | 'percentage' | 'specific_user' | 'specific_group'
  ruleId?: string
}

// ── Metrics ──────────────────────────────────────────────────────────────

export interface FlagEvaluationMetrics {
  name: string
  totalEvaluations: number
  trueCount: number
  falseCount: number
  variantCounts: Record<string, number>
  lastEvaluatedAt: string | null
}

// ── Experiments / A/B Testing ────────────────────────────────────────────

export interface ExperimentVariant {
  name: string
  value: FlagValue
  weight: number
}

export interface ExperimentConfig {
  name: string
  description: string
  flagName: string
  variants: ExperimentVariant[]
  status: 'draft' | 'running' | 'paused' | 'completed'
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface ExperimentCreateOptions {
  description?: string
  flagName: string
  variants: ExperimentVariant[]
}

export interface ExperimentAssignment {
  experimentName: string
  variantName: string
  userId: string
  assignedAt: string
}

export interface ExperimentResults {
  name: string
  status: string
  variants: Array<{
    name: string
    value: FlagValue
    weight: number
    assignments: number
    conversionRate: number
  }>
  totalAssignments: number
  startedAt: string | null
  completedAt: string | null
}

// ── Database Adapter ─────────────────────────────────────────────────────

export interface FlagDbAdapter {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>
  execute: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }>
}

// ── Manager Config ───────────────────────────────────────────────────────

export interface FlagManagerConfig {
  db?: FlagDbAdapter
  persistence?: 'memory' | 'database'
}

// ── Manager Interface ────────────────────────────────────────────────────

export interface FlagManager {
  create: (name: string, options: FlagCreateOptions) => Promise<FlagConfig>
  get: (name: string) => Promise<FlagConfig | null>
  evaluate: (name: string, context?: EvaluationContext) => Promise<EvaluationResult>
  evaluateAll: (context?: EvaluationContext) => Promise<EvaluationResult[]>
  update: (name: string, updates: FlagUpdateOptions) => Promise<FlagConfig>
  delete: (name: string) => Promise<void>
  list: () => Promise<FlagConfig[]>
  enable: (name: string) => Promise<void>
  disable: (name: string) => Promise<void>
  setPercentage: (name: string, percentage: number) => Promise<void>
  addRule: (name: string, rule: Omit<FlagTargetingRule, 'id'>) => Promise<FlagTargetingRule>
  removeRule: (name: string, ruleId: string) => Promise<void>
  getMetrics: (name: string) => Promise<FlagEvaluationMetrics>
  createExperiment: (name: string, options: ExperimentCreateOptions) => Promise<ExperimentConfig>
  getExperimentResults: (name: string) => Promise<ExperimentResults>
}
