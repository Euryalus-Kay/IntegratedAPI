import type { DatabaseAdapter, CronManager, CronJobConfig, CronHistoryEntry } from './types.js'

/**
 * Cron job scheduler for VibeKit.
 * Uses setInterval to approximate cron timing. Parses standard 5-field cron expressions.
 * Job metadata stored in _vibekit_cron_jobs, history in _vibekit_cron_history.
 */

interface CronJob {
  name: string
  expression: string
  fn: () => void | Promise<void>
  timer: ReturnType<typeof setInterval> | null
  enabled: boolean
}

function parseCronField(field: string, min: number, max: number): number[] {
  if (field === '*') return Array.from({ length: max - min + 1 }, (_, i) => min + i)
  if (field.includes('/')) {
    const [, step] = field.split('/')
    const s = parseInt(step, 10)
    return Array.from({ length: max - min + 1 }, (_, i) => min + i).filter(v => (v - min) % s === 0)
  }
  if (field.includes(',')) return field.split(',').map(Number)
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number)
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }
  return [parseInt(field, 10)]
}

function cronMatches(expression: string, date: Date): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [minF, hourF, domF, monF, dowF] = parts
  const minute = date.getMinutes()
  const hour = date.getHours()
  const dom = date.getDate()
  const month = date.getMonth() + 1
  const dow = date.getDay()
  return (
    parseCronField(minF, 0, 59).includes(minute) &&
    parseCronField(hourF, 0, 23).includes(hour) &&
    parseCronField(domF, 1, 31).includes(dom) &&
    parseCronField(monF, 1, 12).includes(month) &&
    parseCronField(dowF, 0, 6).includes(dow)
  )
}

function getNextRunTime(expression: string): Date {
  const now = new Date()
  const next = new Date(now)
  next.setSeconds(0, 0)
  for (let i = 0; i < 525960; i++) { // max ~1 year of minutes
    next.setMinutes(next.getMinutes() + 1)
    if (cronMatches(expression, next)) return next
  }
  return next
}

const _jobs: Map<string, CronJob> = new Map()

export function createCronManager(adapter: DatabaseAdapter): CronManager {
  let initialized = false

  async function ensureTables(): Promise<void> {
    if (initialized) return
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_cron_jobs (
        "name" TEXT PRIMARY KEY,
        "expression" TEXT NOT NULL,
        "enabled" INTEGER DEFAULT 1,
        "last_run" TEXT,
        "next_run" TEXT,
        "created_at" TEXT DEFAULT (datetime('now'))
      )
    `)
    await adapter.execute(`
      CREATE TABLE IF NOT EXISTS _vibekit_cron_history (
        "id" INTEGER PRIMARY KEY AUTOINCREMENT,
        "job_name" TEXT NOT NULL,
        "started_at" TEXT NOT NULL,
        "finished_at" TEXT NOT NULL,
        "duration_ms" INTEGER NOT NULL,
        "status" TEXT NOT NULL,
        "error" TEXT
      )
    `)
    initialized = true
  }

  async function executeJob(job: CronJob): Promise<void> {
    const startedAt = new Date().toISOString()
    const start = Date.now()
    let status = 'success'
    let error: string | undefined

    try {
      const result = job.fn()
      if (result && typeof (result as any).then === 'function') {
        await result
      }
    } catch (err) {
      status = 'error'
      error = err instanceof Error ? err.message : String(err)
    }

    const finishedAt = new Date().toISOString()
    const durationMs = Date.now() - start
    const nextRun = getNextRunTime(job.expression).toISOString()

    await adapter.execute(
      `UPDATE _vibekit_cron_jobs SET "last_run" = $1, "next_run" = $2 WHERE "name" = $3`,
      [finishedAt, nextRun, job.name]
    )

    await adapter.execute(
      `INSERT INTO _vibekit_cron_history ("job_name", "started_at", "finished_at", "duration_ms", "status", "error")
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [job.name, startedAt, finishedAt, durationMs, status, error || null]
    )
  }

  const manager: CronManager = {
    async schedule(name: string, cronExpression: string, fn: () => void | Promise<void>): Promise<void> {
      await ensureTables()

      // Stop existing job if any
      const existing = _jobs.get(name)
      if (existing?.timer) clearInterval(existing.timer)

      const nextRun = getNextRunTime(cronExpression)
      await adapter.execute(
        `INSERT OR REPLACE INTO _vibekit_cron_jobs ("name", "expression", "enabled", "next_run")
         VALUES ($1, $2, 1, $3)`,
        [name, cronExpression, nextRun.toISOString()]
      )

      const job: CronJob = { name, expression: cronExpression, fn, timer: null, enabled: true }

      // Check every 60 seconds if the cron expression matches
      job.timer = setInterval(async () => {
        if (!job.enabled) return
        const now = new Date()
        if (cronMatches(cronExpression, now)) {
          await executeJob(job)
        }
      }, 60_000)

      // Make the timer not prevent process exit
      if (job.timer && typeof job.timer === 'object' && 'unref' in job.timer) {
        (job.timer as any).unref()
      }

      _jobs.set(name, job)
    },

    async unschedule(name: string): Promise<void> {
      await ensureTables()
      const job = _jobs.get(name)
      if (job?.timer) clearInterval(job.timer)
      _jobs.delete(name)
      await adapter.execute(`DELETE FROM _vibekit_cron_jobs WHERE "name" = $1`, [name])
    },

    async list(): Promise<CronJobConfig[]> {
      await ensureTables()
      const { rows } = await adapter.query<{
        name: string; expression: string; enabled: number;
        last_run: string | null; next_run: string | null; created_at: string
      }>(`SELECT * FROM _vibekit_cron_jobs ORDER BY "name"`)
      return rows.map(r => ({
        name: r.name,
        expression: r.expression,
        enabled: r.enabled === 1,
        lastRun: r.last_run,
        nextRun: r.next_run,
        createdAt: r.created_at,
      }))
    },

    async getHistory(name: string, limit = 20): Promise<CronHistoryEntry[]> {
      await ensureTables()
      const { rows } = await adapter.query<{
        id: number; job_name: string; started_at: string; finished_at: string;
        duration_ms: number; status: string; error: string | null
      }>(
        `SELECT * FROM _vibekit_cron_history WHERE "job_name" = $1 ORDER BY "id" DESC LIMIT $2`,
        [name, limit]
      )
      return rows.map(r => ({
        id: r.id,
        jobName: r.job_name,
        startedAt: r.started_at,
        finishedAt: r.finished_at,
        durationMs: r.duration_ms,
        status: r.status as 'success' | 'error',
        error: r.error || undefined,
      }))
    },

    async trigger(name: string): Promise<void> {
      const job = _jobs.get(name)
      if (!job) throw new Error(`Cron job "${name}" not found. Schedule it first.`)
      await executeJob(job)
    },

    stopAll(): void {
      for (const job of _jobs.values()) {
        if (job.timer) clearInterval(job.timer)
      }
      _jobs.clear()
    },
  }

  return manager
}
