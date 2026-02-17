// ──────────────────────────────────────────────────────────────────────────────
// VibeKit — Developer Diagnostics & Debugging Tools
// Provides comprehensive system diagnostics, performance profiling, and
// debugging utilities for development and production troubleshooting.
// ──────────────────────────────────────────────────────────────────────────────

import { createLogger } from './logger.js'
import { isLocal } from '../config/index.js'

const log = createLogger('diagnostics')

export interface DiagnosticReport {
  timestamp: string
  environment: string
  node: { version: string; platform: string; arch: string; memory: NodeJS.MemoryUsage }
  modules: Record<string, { status: 'ok' | 'error' | 'disabled'; latencyMs?: number; details?: string }>
  config: Record<string, unknown>
  warnings: string[]
  errors: string[]
}

export interface PerformanceTrace {
  id: string
  operation: string
  startTime: number
  endTime?: number
  durationMs?: number
  children: PerformanceTrace[]
  metadata?: Record<string, unknown>
}

const _traces: PerformanceTrace[] = []
const MAX_TRACES = 200

export const diagnostics = {
  async generateReport(): Promise<DiagnosticReport> {
    const report: DiagnosticReport = {
      timestamp: new Date().toISOString(),
      environment: isLocal() ? 'local' : 'production',
      node: {
        version: process.version,
        platform: process.platform,
        arch: process.arch,
        memory: process.memoryUsage(),
      },
      modules: {},
      config: {},
      warnings: [],
      errors: [],
    }

    // Check database
    try {
      const { db } = await import('../db/index.js')
      const start = performance.now()
      const health = await db.health()
      const latency = Math.round(performance.now() - start)
      report.modules.database = { status: health.status === 'healthy' ? 'ok' : 'error', latencyMs: latency, details: `${health.tableCount} tables, ${health.sizeBytes ? (health.sizeBytes / 1024).toFixed(1) + ' KB' : 'unknown size'}` }
    } catch (e: any) {
      report.modules.database = { status: 'error', details: e.message }
      report.errors.push(`Database: ${e.message}`)
    }

    // Check storage
    try {
      const { storage } = await import('../storage/index.js')
      const start = performance.now()
      await storage.list({ limit: 1 })
      const latency = Math.round(performance.now() - start)
      report.modules.storage = { status: 'ok', latencyMs: latency }
    } catch (e: any) {
      if (e.message?.includes('not yet')) {
        report.modules.storage = { status: 'disabled', details: 'Production storage not configured' }
      } else {
        report.modules.storage = { status: 'error', details: e.message }
        report.errors.push(`Storage: ${e.message}`)
      }
    }

    // Check config
    try {
      const { getConfig } = await import('../config/index.js')
      const config = getConfig()
      report.config = {
        name: config.name,
        env: config.env,
        modules: config.modules,
        region: config.region,
      }
    } catch (e: any) {
      report.errors.push(`Config: ${e.message}`)
    }

    // Warnings
    if (report.environment === 'local') {
      report.warnings.push('Running in local development mode. Database is SQLite, storage is filesystem.')
    }

    const mem = report.node.memory
    const heapPercent = Math.round((mem.heapUsed / mem.heapTotal) * 100)
    if (heapPercent > 80) {
      report.warnings.push(`High memory usage: ${heapPercent}% of heap used (${(mem.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(mem.heapTotal / 1024 / 1024).toFixed(1)} MB)`)
    }

    return report
  },

  formatReport(report: DiagnosticReport): string {
    const lines: string[] = [
      '╔══════════════════════════════════════════════════════════════╗',
      '║  VibeKit Diagnostic Report                                  ║',
      '╚══════════════════════════════════════════════════════════════╝',
      '',
      `  Timestamp:    ${report.timestamp}`,
      `  Environment:  ${report.environment}`,
      `  Node:         ${report.node.version} (${report.node.platform}/${report.node.arch})`,
      `  Memory:       ${(report.node.memory.heapUsed / 1024 / 1024).toFixed(1)} MB / ${(report.node.memory.heapTotal / 1024 / 1024).toFixed(1)} MB heap`,
      '',
      '  Modules:',
    ]

    for (const [name, info] of Object.entries(report.modules)) {
      const icon = info.status === 'ok' ? '\u2714' : info.status === 'error' ? '\u2718' : '\u25CB'
      const latency = info.latencyMs !== undefined ? ` (${info.latencyMs}ms)` : ''
      const details = info.details ? ` — ${info.details}` : ''
      lines.push(`    ${icon} ${name}: ${info.status}${latency}${details}`)
    }

    if (report.warnings.length > 0) {
      lines.push('', '  Warnings:')
      for (const w of report.warnings) {
        lines.push(`    \u26A0 ${w}`)
      }
    }

    if (report.errors.length > 0) {
      lines.push('', '  Errors:')
      for (const e of report.errors) {
        lines.push(`    \u2718 ${e}`)
      }
    }

    lines.push('')
    return lines.join('\n')
  },

  startTrace(operation: string, metadata?: Record<string, unknown>): PerformanceTrace {
    const trace: PerformanceTrace = {
      id: `trace_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      operation,
      startTime: performance.now(),
      children: [],
      metadata,
    }
    _traces.push(trace)
    if (_traces.length > MAX_TRACES) _traces.shift()
    return trace
  },

  endTrace(trace: PerformanceTrace): number {
    trace.endTime = performance.now()
    trace.durationMs = Math.round((trace.endTime - trace.startTime) * 100) / 100
    log.debug(`Trace completed: ${trace.operation}`, { durationMs: trace.durationMs, ...trace.metadata })
    return trace.durationMs
  },

  getTraces(limit?: number): PerformanceTrace[] {
    return limit ? _traces.slice(-limit) : [..._traces]
  },

  clearTraces(): void {
    _traces.length = 0
  },

  getSlowOperations(thresholdMs: number = 100): PerformanceTrace[] {
    return _traces.filter(t => t.durationMs !== undefined && t.durationMs > thresholdMs)
  },

  async measureAsync<T>(operation: string, fn: () => Promise<T>): Promise<{ result: T; durationMs: number }> {
    const trace = this.startTrace(operation)
    try {
      const result = await fn()
      const durationMs = this.endTrace(trace)
      return { result, durationMs }
    } catch (err) {
      this.endTrace(trace)
      throw err
    }
  },

  measure<T>(operation: string, fn: () => T): { result: T; durationMs: number } {
    const trace = this.startTrace(operation)
    try {
      const result = fn()
      const durationMs = this.endTrace(trace)
      return { result, durationMs }
    } catch (err) {
      this.endTrace(trace)
      throw err
    }
  },
}
