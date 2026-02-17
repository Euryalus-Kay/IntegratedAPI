// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Shared Types
// ──────────────────────────────────────────────────────────────────────────────

import type { AuthContext, ProjectRecord } from './middleware/api-auth.js'

/**
 * Custom Hono environment type that declares all context variables
 * used across middleware and route handlers.
 *
 * This ensures type-safe access to `c.get()` and `c.set()` throughout
 * the application.
 */
export type AppEnv = {
  Variables: {
    requestId: string
    auth: AuthContext
    projectId: string
    project: ProjectRecord
  }
}
