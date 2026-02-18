import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/**
 * VibeKit Secrets Vault
 * AES-256-GCM encrypted secrets storage.
 * Replaces: Railway Variables, Vercel Environment Variables, Vault, Doppler
 */

export interface Secret {
  key: string
  value: string
  environment: string
  createdAt: string
  updatedAt: string
  version: number
}

export interface SecretVersion {
  version: number
  value: string
  createdAt: string
  createdBy: string | null
}

export interface SecretListOptions {
  environment?: string
  prefix?: string
}

export interface VaultConfig {
  dataDir: string
  masterKey?: string
}

interface EncryptedPayload {
  iv: string
  authTag: string
  data: string
}

interface VaultStore {
  secrets: Record<string, Record<string, {
    value: EncryptedPayload
    environment: string
    createdAt: string
    updatedAt: string
    version: number
    history: Array<{ version: number; value: EncryptedPayload; createdAt: string; createdBy: string | null }>
  }>>
}

function deriveKey(masterKey: string): Buffer {
  return crypto.pbkdf2Sync(masterKey, 'vibekit-vault-salt', 100000, 32, 'sha256')
}

function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return { iv: iv.toString('hex'), authTag, data: encrypted }
}

function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'hex'))
  decipher.setAuthTag(Buffer.from(payload.authTag, 'hex'))
  let decrypted = decipher.update(payload.data, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function getVaultPath(dataDir: string): string {
  return path.join(dataDir, '.vibekit-vault.json')
}

function loadStore(vaultPath: string): VaultStore {
  if (!fs.existsSync(vaultPath)) return { secrets: {} }
  try {
    return JSON.parse(fs.readFileSync(vaultPath, 'utf8'))
  } catch {
    return { secrets: {} }
  }
}

function saveStore(vaultPath: string, store: VaultStore): void {
  const dir = path.dirname(vaultPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(vaultPath, JSON.stringify(store, null, 2), 'utf8')
}

export function createVault(config: VaultConfig) {
  const masterKey = config.masterKey || process.env.VIBEKIT_VAULT_KEY || 'vibekit-dev-key-change-in-production'
  const key = deriveKey(masterKey)
  const vaultPath = getVaultPath(config.dataDir)

  const vault = {
    set(secretKey: string, value: string, environment = 'default', createdBy: string | null = null): Secret {
      const store = loadStore(vaultPath)
      if (!store.secrets[environment]) store.secrets[environment] = {}

      const existing = store.secrets[environment][secretKey]
      const version = existing ? existing.version + 1 : 1
      const now = new Date().toISOString()
      const encryptedValue = encrypt(value, key)

      const history = existing?.history || []
      if (existing) {
        history.push({
          version: existing.version,
          value: existing.value,
          createdAt: existing.updatedAt,
          createdBy: null,
        })
      }

      store.secrets[environment][secretKey] = {
        value: encryptedValue,
        environment,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
        version,
        history,
      }

      saveStore(vaultPath, store)
      return { key: secretKey, value, environment, createdAt: existing?.createdAt || now, updatedAt: now, version }
    },

    get(secretKey: string, environment = 'default'): Secret | null {
      const store = loadStore(vaultPath)
      const entry = store.secrets[environment]?.[secretKey]
      if (!entry) return null

      try {
        const value = decrypt(entry.value, key)
        return {
          key: secretKey,
          value,
          environment: entry.environment,
          createdAt: entry.createdAt,
          updatedAt: entry.updatedAt,
          version: entry.version,
        }
      } catch {
        return null
      }
    },

    delete(secretKey: string, environment = 'default'): boolean {
      const store = loadStore(vaultPath)
      if (!store.secrets[environment]?.[secretKey]) return false
      delete store.secrets[environment][secretKey]
      saveStore(vaultPath, store)
      return true
    },

    list(options?: SecretListOptions): Array<{ key: string; environment: string; version: number; updatedAt: string }> {
      const store = loadStore(vaultPath)
      const results: Array<{ key: string; environment: string; version: number; updatedAt: string }> = []

      for (const [env, secrets] of Object.entries(store.secrets)) {
        if (options?.environment && env !== options.environment) continue
        for (const [k, entry] of Object.entries(secrets)) {
          if (options?.prefix && !k.startsWith(options.prefix)) continue
          results.push({ key: k, environment: env, version: entry.version, updatedAt: entry.updatedAt })
        }
      }

      return results.sort((a, b) => a.key.localeCompare(b.key))
    },

    getHistory(secretKey: string, environment = 'default'): SecretVersion[] {
      const store = loadStore(vaultPath)
      const entry = store.secrets[environment]?.[secretKey]
      if (!entry) return []

      const versions: SecretVersion[] = entry.history.map(h => ({
        version: h.version,
        value: decrypt(h.value, key),
        createdAt: h.createdAt,
        createdBy: h.createdBy,
      }))

      // Add current version
      versions.push({
        version: entry.version,
        value: decrypt(entry.value, key),
        createdAt: entry.updatedAt,
        createdBy: null,
      })

      return versions.sort((a, b) => a.version - b.version)
    },

    /** Export all secrets for an environment as a flat key-value object */
    export(environment = 'default'): Record<string, string> {
      const store = loadStore(vaultPath)
      const result: Record<string, string> = {}
      const secrets = store.secrets[environment] || {}
      for (const [k, entry] of Object.entries(secrets)) {
        try {
          result[k] = decrypt(entry.value, key)
        } catch { /* skip */ }
      }
      return result
    },

    /** Import secrets from a flat key-value object */
    import(secrets: Record<string, string>, environment = 'default'): number {
      let count = 0
      for (const [k, v] of Object.entries(secrets)) {
        vault.set(k, v, environment)
        count++
      }
      return count
    },

    /** Rotate the master key */
    rotate(newMasterKey: string): void {
      const newKey = deriveKey(newMasterKey)
      const store = loadStore(vaultPath)

      for (const env of Object.values(store.secrets)) {
        for (const entry of Object.values(env)) {
          const plainValue = decrypt(entry.value, key)
          entry.value = encrypt(plainValue, newKey)
          for (const h of entry.history) {
            const plainH = decrypt(h.value, key)
            h.value = encrypt(plainH, newKey)
          }
        }
      }
      saveStore(vaultPath, store)
    },

    /** Destroy the vault entirely */
    destroy(): void {
      if (fs.existsSync(vaultPath)) fs.unlinkSync(vaultPath)
    },

    /** Count secrets in an environment */
    count(environment?: string): number {
      const store = loadStore(vaultPath)
      if (environment) return Object.keys(store.secrets[environment] || {}).length
      let total = 0
      for (const env of Object.values(store.secrets)) total += Object.keys(env).length
      return total
    },
  }

  return vault
}

/** Convenience: create vault with sensible defaults */
export function createDefaultVault(dataDir?: string) {
  return createVault({
    dataDir: dataDir || path.join(process.cwd(), '.vibekit'),
  })
}
