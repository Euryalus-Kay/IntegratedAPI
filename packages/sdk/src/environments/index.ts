import fs from 'node:fs'
import path from 'node:path'

/**
 * VibeKit Environments Module
 * Manage multiple environments (dev, staging, production) with config overrides.
 * Replaces: Railway Environments, Vercel Environments, .env management
 */

export interface Environment {
  name: string
  description: string
  variables: Record<string, string>
  inherit: string | null
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

export interface EnvironmentListResult {
  environments: Environment[]
  current: string
}

export interface EnvironmentDiff {
  added: string[]
  removed: string[]
  modified: Array<{ key: string; from: string; to: string }>
}

interface EnvStore {
  current: string
  environments: Record<string, Environment>
}

function getStorePath(dataDir: string): string {
  return path.join(dataDir, '.vibekit-environments.json')
}

function loadStore(storePath: string): EnvStore {
  if (!fs.existsSync(storePath)) {
    return {
      current: 'development',
      environments: {
        development: {
          name: 'development', description: 'Local development environment',
          variables: {}, inherit: null, isDefault: true,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        staging: {
          name: 'staging', description: 'Staging environment',
          variables: {}, inherit: 'development', isDefault: false,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
        production: {
          name: 'production', description: 'Production environment',
          variables: {}, inherit: null, isDefault: false,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        },
      },
    }
  }
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'))
  } catch {
    return { current: 'development', environments: {} }
  }
}

function saveStore(storePath: string, store: EnvStore): void {
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
}

export function createEnvironments(dataDir?: string) {
  const dir = dataDir || path.join(process.cwd(), '.vibekit')
  const storePath = getStorePath(dir)

  const envs = {
    /** Get current environment name */
    current(): string {
      return loadStore(storePath).current
    },

    /** Switch to a different environment */
    switch(name: string): void {
      const store = loadStore(storePath)
      if (!store.environments[name]) throw new Error(`Environment "${name}" does not exist`)
      store.current = name
      saveStore(storePath, store)
    },

    /** Create a new environment */
    create(name: string, options?: { description?: string; inherit?: string; variables?: Record<string, string> }): Environment {
      const store = loadStore(storePath)
      if (store.environments[name]) throw new Error(`Environment "${name}" already exists`)
      const now = new Date().toISOString()
      const env: Environment = {
        name,
        description: options?.description || `Environment: ${name}`,
        variables: options?.variables || {},
        inherit: options?.inherit || null,
        isDefault: false,
        createdAt: now,
        updatedAt: now,
      }
      store.environments[name] = env
      saveStore(storePath, store)
      return env
    },

    /** Delete an environment */
    delete(name: string): void {
      const store = loadStore(storePath)
      if (!store.environments[name]) throw new Error(`Environment "${name}" does not exist`)
      if (store.environments[name].isDefault) throw new Error('Cannot delete the default environment')
      if (store.current === name) throw new Error('Cannot delete the current environment. Switch first.')
      delete store.environments[name]
      saveStore(storePath, store)
    },

    /** List all environments */
    list(): EnvironmentListResult {
      const store = loadStore(storePath)
      return {
        environments: Object.values(store.environments),
        current: store.current,
      }
    },

    /** Get an environment by name */
    get(name: string): Environment | null {
      const store = loadStore(storePath)
      return store.environments[name] || null
    },

    /** Set a variable in an environment */
    setVariable(name: string, key: string, value: string): void {
      const store = loadStore(storePath)
      if (!store.environments[name]) throw new Error(`Environment "${name}" does not exist`)
      store.environments[name].variables[key] = value
      store.environments[name].updatedAt = new Date().toISOString()
      saveStore(storePath, store)
    },

    /** Set multiple variables at once */
    setVariables(name: string, variables: Record<string, string>): void {
      const store = loadStore(storePath)
      if (!store.environments[name]) throw new Error(`Environment "${name}" does not exist`)
      Object.assign(store.environments[name].variables, variables)
      store.environments[name].updatedAt = new Date().toISOString()
      saveStore(storePath, store)
    },

    /** Remove a variable from an environment */
    removeVariable(name: string, key: string): void {
      const store = loadStore(storePath)
      if (!store.environments[name]) throw new Error(`Environment "${name}" does not exist`)
      delete store.environments[name].variables[key]
      store.environments[name].updatedAt = new Date().toISOString()
      saveStore(storePath, store)
    },

    /** Get all resolved variables for an environment (with inheritance) */
    resolve(name?: string): Record<string, string> {
      const store = loadStore(storePath)
      const envName = name || store.current
      const env = store.environments[envName]
      if (!env) throw new Error(`Environment "${envName}" does not exist`)

      let variables: Record<string, string> = {}

      // Apply inherited variables first
      if (env.inherit && store.environments[env.inherit]) {
        variables = envs.resolve(env.inherit)
      }

      // Override with own variables
      Object.assign(variables, env.variables)
      return variables
    },

    /** Diff two environments */
    diff(from: string, to: string): EnvironmentDiff {
      const fromVars = envs.resolve(from)
      const toVars = envs.resolve(to)
      const allKeys = new Set([...Object.keys(fromVars), ...Object.keys(toVars)])

      const added: string[] = []
      const removed: string[] = []
      const modified: Array<{ key: string; from: string; to: string }> = []

      for (const key of allKeys) {
        if (!(key in fromVars)) added.push(key)
        else if (!(key in toVars)) removed.push(key)
        else if (fromVars[key] !== toVars[key]) modified.push({ key, from: fromVars[key], to: toVars[key] })
      }

      return { added, removed, modified }
    },

    /** Clone an environment */
    clone(source: string, newName: string): Environment {
      const store = loadStore(storePath)
      const sourceEnv = store.environments[source]
      if (!sourceEnv) throw new Error(`Environment "${source}" does not exist`)
      return envs.create(newName, {
        description: `Clone of ${source}`,
        variables: { ...sourceEnv.variables },
        inherit: sourceEnv.inherit || undefined,
      })
    },

    /** Export environment variables as .env format string */
    exportDotEnv(name?: string): string {
      const vars = envs.resolve(name)
      return Object.entries(vars)
        .map(([k, v]) => `${k}=${v.includes(' ') || v.includes('"') ? `"${v.replace(/"/g, '\\"')}"` : v}`)
        .join('\n')
    },

    /** Import from .env format string */
    importDotEnv(name: string, content: string): number {
      const lines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))
      let count = 0
      for (const line of lines) {
        const match = line.match(/^([^=]+)=(.*)$/)
        if (match) {
          const key = match[1].trim()
          let value = match[2].trim()
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1)
          }
          envs.setVariable(name, key, value)
          count++
        }
      }
      return count
    },

    /** Apply environment variables to process.env */
    apply(name?: string): void {
      const vars = envs.resolve(name)
      for (const [k, v] of Object.entries(vars)) {
        process.env[k] = v
      }
    },
  }

  return envs
}
