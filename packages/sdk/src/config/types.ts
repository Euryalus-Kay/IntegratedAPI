export interface VibeKitConfig {
  name: string
  projectId: string
  region: string
  framework: 'nextjs' | 'react' | 'hono' | 'express' | 'html' | 'custom'
  modules: {
    db: boolean | DbConfig
    auth: boolean | AuthConfig
    storage: boolean | StorageConfig
    email: boolean | EmailConfig
    realtime: boolean
  }
}

export interface DbConfig {
  enabled: boolean
}

export interface AuthConfig {
  enabled: boolean
  methods: AuthMethod[]
  sessionDuration: string
  allowSignup: boolean
  redirectAfterLogin: string
}

export type AuthMethod = 'email-code' | 'passkey' | 'google' | 'github' | 'magic-link'

export interface StorageConfig {
  enabled: boolean
  maxFileSize: string
  allowedTypes?: string[]
}

export interface EmailConfig {
  enabled: boolean
  from: string
  replyTo?: string
}

export type VibeKitEnv = 'local' | 'preview' | 'production'

export interface ResolvedConfig extends VibeKitConfig {
  env: VibeKitEnv
  dataDir: string
  dbPath: string
  storagePath: string
  port: number
  jwtSecret: string
  apiUrl: string
  apiToken?: string
}
