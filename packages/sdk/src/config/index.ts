import { resolveConfig, findConfig, detectEnv, writeConfig, migrateConfig } from './detector.js'
import { validateConfig, formatValidationErrors } from './validator.js'
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

export function isPreview(): boolean {
  return getConfig().env === 'preview'
}

export { resolveConfig, findConfig, detectEnv, writeConfig, migrateConfig }
export { validateConfig, formatValidationErrors }
export type { VibeKitConfig, ResolvedConfig, VibeKitEnv }
