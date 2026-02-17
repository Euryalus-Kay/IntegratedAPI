/**
 * @vibekit/server - The VibeKit API backend
 * [FUTURE] This will be the production backend that handles
 * API requests, proxies to Neon, R2, etc.
 *
 * For now, the local dev server in @vibekit/cli handles everything.
 */

export function createServer() {
  throw new Error(
    'The VibeKit production server is not yet available. ' +
    'Use "vibekit dev" for local development.'
  )
}
