import type { DatabaseAdapter } from './types.js'

export function createPostgresAdapter(connectionString: string): DatabaseAdapter {
  throw new Error(
    'Production Postgres is not yet available. ' +
    'VibeKit is running in local mode with SQLite. ' +
    'Run "vibekit dev" to use the local development server.'
  )
}
