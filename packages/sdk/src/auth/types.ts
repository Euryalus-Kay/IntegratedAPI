export interface User {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  role: string
  email_verified: boolean
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface Session {
  id: string
  user_id: string
  token_hash: string
  expires_at: string
  ip_address: string | null
  user_agent: string | null
  created_at: string
}

export interface AuthCode {
  id: string
  email: string
  code_hash: string
  expires_at: string
  used: boolean
  attempts: number
  created_at: string
}

export interface AuthResult {
  user: User
  token: string
  expiresAt: Date
}

export interface SendCodeResult {
  success: boolean
  message: string
  expiresAt: Date
}

export interface ListUsersOptions {
  page?: number
  limit?: number
  role?: string
  search?: string
  orderBy?: 'created_at' | 'email' | 'name'
  order?: 'asc' | 'desc'
}

export interface ListUsersResult {
  users: User[]
  total: number
  page: number
  limit: number
  totalPages: number
}

export interface AuthConfig {
  methods: string[]
  sessionDuration: string
  allowSignup: boolean
  redirectAfterLogin: string
}

export interface RateLimitEntry {
  count: number
  resetAt: number
}
