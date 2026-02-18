import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * VibeKit Deployment Manager
 * Track deployments, rollbacks, and build artifacts.
 * Replaces: Vercel Deployments, Railway Deployments
 */

export type DeploymentStatus = 'pending' | 'building' | 'deploying' | 'ready' | 'failed' | 'cancelled' | 'rolled_back'

export interface Deployment {
  id: string
  environment: string
  status: DeploymentStatus
  commitHash: string | null
  commitMessage: string | null
  branch: string | null
  buildDuration: number | null
  deployDuration: number | null
  url: string | null
  domains: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
  readyAt: string | null
  rolledBackAt: string | null
  rolledBackBy: string | null
  error: string | null
}

export interface DeploymentLog {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  phase: 'build' | 'deploy' | 'promote'
}

export interface CreateDeploymentOptions {
  environment?: string
  commitHash?: string
  commitMessage?: string
  branch?: string
  metadata?: Record<string, unknown>
}

export interface DeploymentListOptions {
  environment?: string
  status?: DeploymentStatus
  limit?: number
  offset?: number
  branch?: string
}

export interface DeploymentListResult {
  deployments: Deployment[]
  total: number
}

export interface DomainConfig {
  domain: string
  environment: string
  ssl: boolean
  createdAt: string
}

interface DeployStore {
  deployments: Record<string, Deployment>
  logs: Record<string, DeploymentLog[]>
  domains: DomainConfig[]
  activeDeployment: Record<string, string>  // env -> deploymentId
}

function getStorePath(dataDir: string): string {
  return path.join(dataDir, '.vibekit-deployments.json')
}

function loadStore(storePath: string): DeployStore {
  if (!fs.existsSync(storePath)) return { deployments: {}, logs: {}, domains: [], activeDeployment: {} }
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')) } catch { return { deployments: {}, logs: {}, domains: [], activeDeployment: {} } }
}

function saveStore(storePath: string, store: DeployStore): void {
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
}

export function createDeployManager(dataDir?: string) {
  const dir = dataDir || path.join(process.cwd(), '.vibekit')
  const storePath = getStorePath(dir)

  const deploy = {
    /** Create a new deployment */
    create(options?: CreateDeploymentOptions): Deployment {
      const store = loadStore(storePath)
      const id = crypto.randomUUID()
      const now = new Date().toISOString()
      const deployment: Deployment = {
        id, environment: options?.environment || 'production',
        status: 'pending',
        commitHash: options?.commitHash || null,
        commitMessage: options?.commitMessage || null,
        branch: options?.branch || null,
        buildDuration: null, deployDuration: null,
        url: null, domains: [],
        metadata: options?.metadata || {},
        createdAt: now, updatedAt: now,
        readyAt: null, rolledBackAt: null, rolledBackBy: null, error: null,
      }
      store.deployments[id] = deployment
      store.logs[id] = []
      saveStore(storePath, store)
      return deployment
    },

    /** Update deployment status */
    updateStatus(id: string, status: DeploymentStatus, details?: { error?: string; url?: string; buildDuration?: number; deployDuration?: number }): Deployment {
      const store = loadStore(storePath)
      const deployment = store.deployments[id]
      if (!deployment) throw new Error(`Deployment "${id}" not found`)
      deployment.status = status
      deployment.updatedAt = new Date().toISOString()
      if (status === 'ready') {
        deployment.readyAt = deployment.updatedAt
        store.activeDeployment[deployment.environment] = id
      }
      if (details?.error) deployment.error = details.error
      if (details?.url) deployment.url = details.url
      if (details?.buildDuration) deployment.buildDuration = details.buildDuration
      if (details?.deployDuration) deployment.deployDuration = details.deployDuration
      saveStore(storePath, store)
      return deployment
    },

    /** Add a log entry to a deployment */
    addLog(id: string, log: Omit<DeploymentLog, 'timestamp'>): void {
      const store = loadStore(storePath)
      if (!store.logs[id]) store.logs[id] = []
      store.logs[id].push({ ...log, timestamp: new Date().toISOString() })
      saveStore(storePath, store)
    },

    /** Get deployment logs */
    getLogs(id: string): DeploymentLog[] {
      const store = loadStore(storePath)
      return store.logs[id] || []
    },

    /** Get a deployment by ID */
    get(id: string): Deployment | null {
      const store = loadStore(storePath)
      return store.deployments[id] || null
    },

    /** List deployments */
    list(options?: DeploymentListOptions): DeploymentListResult {
      const store = loadStore(storePath)
      let deployments = Object.values(store.deployments)
      if (options?.environment) deployments = deployments.filter(d => d.environment === options.environment)
      if (options?.status) deployments = deployments.filter(d => d.status === options.status)
      if (options?.branch) deployments = deployments.filter(d => d.branch === options.branch)
      deployments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      const total = deployments.length
      const offset = options?.offset || 0
      const limit = options?.limit || 20
      return { deployments: deployments.slice(offset, offset + limit), total }
    },

    /** Rollback to a previous deployment */
    rollback(environment: string, targetId?: string): Deployment {
      const store = loadStore(storePath)
      if (targetId) {
        const target = store.deployments[targetId]
        if (!target) throw new Error(`Deployment "${targetId}" not found`)
        store.activeDeployment[environment] = targetId
        target.status = 'ready'
        target.updatedAt = new Date().toISOString()
        saveStore(storePath, store)
        return target
      }
      // Rollback to previous ready deployment
      const envDeployments = Object.values(store.deployments)
        .filter(d => d.environment === environment && d.status === 'ready')
        .sort((a, b) => new Date(b.readyAt || b.createdAt).getTime() - new Date(a.readyAt || a.createdAt).getTime())
      if (envDeployments.length < 2) throw new Error('No previous deployment to rollback to')
      const current = envDeployments[0]
      const previous = envDeployments[1]
      current.status = 'rolled_back'
      current.rolledBackAt = new Date().toISOString()
      current.updatedAt = current.rolledBackAt
      store.activeDeployment[environment] = previous.id
      saveStore(storePath, store)
      return previous
    },

    /** Get the currently active deployment for an environment */
    getActive(environment = 'production'): Deployment | null {
      const store = loadStore(storePath)
      const id = store.activeDeployment[environment]
      return id ? store.deployments[id] || null : null
    },

    /** Promote a deployment from one environment to another */
    promote(id: string, toEnvironment: string): Deployment {
      const store = loadStore(storePath)
      const source = store.deployments[id]
      if (!source) throw new Error(`Deployment "${id}" not found`)
      const promoted = deploy.create({
        environment: toEnvironment,
        commitHash: source.commitHash || undefined,
        commitMessage: source.commitMessage || undefined,
        branch: source.branch || undefined,
        metadata: { ...source.metadata, promotedFrom: source.id, promotedFromEnv: source.environment },
      })
      return deploy.updateStatus(promoted.id, 'ready', { url: source.url || undefined })
    },

    // ── Domains ─────────────────────────────────────────────────

    /** Add a custom domain */
    addDomain(domain: string, environment = 'production'): DomainConfig {
      const store = loadStore(storePath)
      const existing = store.domains.find(d => d.domain === domain)
      if (existing) throw new Error(`Domain "${domain}" already configured`)
      const config: DomainConfig = { domain, environment, ssl: true, createdAt: new Date().toISOString() }
      store.domains.push(config)
      saveStore(storePath, store)
      return config
    },

    /** Remove a custom domain */
    removeDomain(domain: string): void {
      const store = loadStore(storePath)
      store.domains = store.domains.filter(d => d.domain !== domain)
      saveStore(storePath, store)
    },

    /** List all custom domains */
    listDomains(environment?: string): DomainConfig[] {
      const store = loadStore(storePath)
      return environment ? store.domains.filter(d => d.environment === environment) : store.domains
    },
  }

  return deploy
}
