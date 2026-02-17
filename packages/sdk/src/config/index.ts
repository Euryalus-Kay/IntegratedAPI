import { resolveConfig, findConfig, detectEnv } from './detector.js'
import type { VibeKitConfig, ResolvedConfig, VibeKitEnv } from './types.js'

let _config: ResolvedConfig | null = null

export function getConfig(): ResolvedConfig {
  if (!_config) {
    _config = resolveConfig()
  }
  return _config
}

export function resetConfig(): void {
  _config = null
}

export function setConfig(overrides: Partial<ResolvedConfig>): ResolvedConfig {
  _config = resolveConfig(overrides)
  return _config
}

export function isLocal(): boolean {
  return getConfig().env === 'local'
}

export function isProduction(): boolean {
  return getConfig().env === 'production'
}

export { resolveConfig, findConfig, detectEnv }
export type { VibeKitConfig, ResolvedConfig, VibeKitEnv }
