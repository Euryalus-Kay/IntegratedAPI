/**
 * VibeKit Analytics Module
 * Event tracking, page views, Web Vitals, session tracking,
 * funnels, UTM tracking, and data export.
 *
 * Replaces: Vercel Analytics, Plausible, Mixpanel, PostHog
 */

import type {
  AnalyticsEvent,
  PageViewEvent,
  WebVitalEntry,
  TrackOptions,
  PageViewOptions,
  WebVitalsInput,
  IdentifyTraits,
  TimeRange,
  TimeFilter,
  EventQueryOptions,
  PageViewQueryOptions,
  TopPagesOptions,
  TopReferrersOptions,
  UniqueVisitorsOptions,
  WebVitalsQueryOptions,
  SessionQueryOptions,
  TopPageResult,
  TopReferrerResult,
  UniqueVisitorResult,
  WebVitalsSummary,
  SessionData,
  FunnelStep,
  FunnelResult,
  ExportOptions,
  AnalyticsDbAdapter,
  AnalyticsConfig,
  AnalyticsManager,
} from './types.js'

export type {
  AnalyticsEvent,
  PageViewEvent,
  WebVitalEntry,
  TrackOptions,
  PageViewOptions,
  WebVitalsInput,
  IdentifyTraits,
  TimeRange,
  TimeFilter,
  EventQueryOptions,
  PageViewQueryOptions,
  TopPagesOptions,
  TopReferrersOptions,
  UniqueVisitorsOptions,
  WebVitalsQueryOptions,
  SessionQueryOptions,
  TopPageResult,
  TopReferrerResult,
  UniqueVisitorResult,
  WebVitalsSummary,
  SessionData,
  FunnelStep,
  FunnelResult,
  ExportOptions,
  AnalyticsDbAdapter,
  AnalyticsConfig,
  AnalyticsManager,
}

// ── Helpers ──────────────────────────────────────────────────────────────

function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

function generateSessionId(): string {
  return 'sess_' + generateId()
}

function parseUserAgent(ua: string | null | undefined): { device: string; browser: string; os: string } {
  if (!ua) return { device: 'unknown', browser: 'unknown', os: 'unknown' }

  let device = 'desktop'
  if (/mobile|android|iphone|ipad|ipod/i.test(ua)) device = 'mobile'
  else if (/tablet|ipad/i.test(ua)) device = 'tablet'

  let browser = 'unknown'
  if (/edg\//i.test(ua)) browser = 'Edge'
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera'
  else if (/chrome\//i.test(ua) && !/edg/i.test(ua)) browser = 'Chrome'
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari'
  else if (/firefox\//i.test(ua)) browser = 'Firefox'

  let os = 'unknown'
  if (/windows/i.test(ua)) os = 'Windows'
  else if (/macintosh|mac os/i.test(ua)) os = 'macOS'
  else if (/linux/i.test(ua) && !/android/i.test(ua)) os = 'Linux'
  else if (/android/i.test(ua)) os = 'Android'
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS'

  return { device, browser, os }
}

function extractPath(url: string): string {
  try {
    const parsed = new URL(url, 'http://localhost')
    return parsed.pathname
  } catch {
    return url
  }
}

function resolveTimeRange(filter: TimeFilter): { start: string; end: string } {
  const end = filter.endDate ?? new Date().toISOString()
  let start: string

  if (filter.range === 'custom' && filter.startDate) {
    start = filter.startDate
  } else {
    const now = new Date()
    switch (filter.range) {
      case '24h':
        now.setHours(now.getHours() - 24)
        break
      case '7d':
        now.setDate(now.getDate() - 7)
        break
      case '30d':
        now.setDate(now.getDate() - 30)
        break
      case '90d':
        now.setDate(now.getDate() - 90)
        break
      default:
        now.setDate(now.getDate() - 30)
    }
    start = filter.startDate ?? now.toISOString()
  }

  return { start, end }
}

function rateWebVital(name: string, value: number): 'good' | 'needs-improvement' | 'poor' {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    FID: [100, 300],
    CLS: [0.1, 0.25],
    FCP: [1800, 3000],
    TTFB: [800, 1800],
    INP: [200, 500],
  }
  const t = thresholds[name]
  if (!t) return 'good'
  if (value <= t[0]) return 'good'
  if (value <= t[1]) return 'needs-improvement'
  return 'poor'
}

function percentileValue(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function escapeCsvField(value: unknown): string {
  const str = value === null || value === undefined ? '' : String(value)
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

// ── Database initialization ──────────────────────────────────────────────

async function initDbTables(db: AnalyticsDbAdapter): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_analytics_events (
      id TEXT PRIMARY KEY,
      event TEXT NOT NULL,
      properties TEXT NOT NULL DEFAULT '{}',
      user_id TEXT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      url TEXT,
      referrer TEXT,
      user_agent TEXT,
      ip TEXT,
      country TEXT,
      device TEXT,
      browser TEXT,
      os TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_analytics_pageviews (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      path TEXT NOT NULL,
      title TEXT,
      referrer TEXT,
      user_id TEXT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      duration REAL,
      user_agent TEXT,
      device TEXT,
      browser TEXT,
      os TEXT,
      country TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      utm_term TEXT,
      utm_content TEXT
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_analytics_vitals (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      value REAL NOT NULL,
      rating TEXT NOT NULL,
      url TEXT NOT NULL,
      user_id TEXT,
      session_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      navigation_type TEXT
    )
  `)

  await db.execute(`
    CREATE TABLE IF NOT EXISTS _vibekit_analytics_identities (
      user_id TEXT PRIMARY KEY,
      traits TEXT NOT NULL DEFAULT '{}',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL
    )
  `)

  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_timestamp ON _vibekit_analytics_events (timestamp)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_event ON _vibekit_analytics_events (event)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_events_session ON _vibekit_analytics_events (session_id)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_pageviews_timestamp ON _vibekit_analytics_pageviews (timestamp)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_pageviews_path ON _vibekit_analytics_pageviews (path)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_vitals_name ON _vibekit_analytics_vitals (name)`)
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_vitals_timestamp ON _vibekit_analytics_vitals (timestamp)`)
}

// ── Main Factory ─────────────────────────────────────────────────────────

export function createAnalytics(config: AnalyticsConfig = {}): AnalyticsManager {
  const useDb = config.persistence === 'database' && config.db !== undefined
  const db = config.db ?? null
  const maxBuffer = config.maxBufferSize ?? 100000

  // In-memory stores
  const eventStore: AnalyticsEvent[] = []
  const pageViewStore: PageViewEvent[] = []
  const vitalStore: WebVitalEntry[] = []
  const identityStore: Map<string, { traits: IdentifyTraits; firstSeen: string; lastSeen: string }> = new Map()

  let currentSessionId = generateSessionId()
  let lastActivity = Date.now()
  const sessionTimeoutMs = (config.sessionTimeout ?? 1800) * 1000
  let dbInitialized = false

  // ── Session management ─────────────────────────────────────────────

  function getSessionId(override?: string): string {
    if (override) return override
    const now = Date.now()
    if (now - lastActivity > sessionTimeoutMs) {
      currentSessionId = generateSessionId()
    }
    lastActivity = now
    return currentSessionId
  }

  // ── DB init ────────────────────────────────────────────────────────

  async function ensureDb(): Promise<void> {
    if (!useDb || dbInitialized) return
    await initDbTables(db!)
    dbInitialized = true
  }

  // ── Buffer trimming ────────────────────────────────────────────────

  function trimBuffer<T>(arr: T[]): void {
    if (arr.length > maxBuffer) {
      arr.splice(0, arr.length - maxBuffer)
    }
  }

  // ── Public API ─────────────────────────────────────────────────────

  return {
    async track(event: string, properties: Record<string, unknown> = {}, options: TrackOptions = {}): Promise<void> {
      const sessionId = getSessionId(options.sessionId)
      const ua = parseUserAgent(options.userAgent)
      const entry: AnalyticsEvent = {
        id: generateId(),
        event,
        properties,
        userId: options.userId ?? null,
        sessionId,
        timestamp: new Date().toISOString(),
        url: options.url ?? null,
        referrer: options.referrer ?? null,
        userAgent: options.userAgent ?? null,
        ip: options.ip ?? null,
        country: null,
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        utmSource: options.utmSource ?? null,
        utmMedium: options.utmMedium ?? null,
        utmCampaign: options.utmCampaign ?? null,
        utmTerm: options.utmTerm ?? null,
        utmContent: options.utmContent ?? null,
      }

      eventStore.push(entry)
      trimBuffer(eventStore)

      if (useDb) {
        await ensureDb()
        await db!.execute(
          `INSERT INTO _vibekit_analytics_events (id, event, properties, user_id, session_id, timestamp, url, referrer, user_agent, ip, country, device, browser, os, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [entry.id, entry.event, JSON.stringify(entry.properties), entry.userId, entry.sessionId, entry.timestamp, entry.url, entry.referrer, entry.userAgent, entry.ip, entry.country, entry.device, entry.browser, entry.os, entry.utmSource, entry.utmMedium, entry.utmCampaign, entry.utmTerm, entry.utmContent],
        )
      }
    },

    async pageView(url: string, options: PageViewOptions = {}): Promise<void> {
      const sessionId = getSessionId(options.sessionId)
      const ua = parseUserAgent(options.userAgent)
      const path = extractPath(url)
      const entry: PageViewEvent = {
        id: generateId(),
        url,
        path,
        title: options.title ?? null,
        referrer: options.referrer ?? null,
        userId: options.userId ?? null,
        sessionId,
        timestamp: new Date().toISOString(),
        duration: options.duration ?? null,
        userAgent: options.userAgent ?? null,
        device: ua.device,
        browser: ua.browser,
        os: ua.os,
        country: options.country ?? null,
        utmSource: options.utmSource ?? null,
        utmMedium: options.utmMedium ?? null,
        utmCampaign: options.utmCampaign ?? null,
        utmTerm: options.utmTerm ?? null,
        utmContent: options.utmContent ?? null,
      }

      pageViewStore.push(entry)
      trimBuffer(pageViewStore)

      if (useDb) {
        await ensureDb()
        await db!.execute(
          `INSERT INTO _vibekit_analytics_pageviews (id, url, path, title, referrer, user_id, session_id, timestamp, duration, user_agent, device, browser, os, country, utm_source, utm_medium, utm_campaign, utm_term, utm_content)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
          [entry.id, entry.url, entry.path, entry.title, entry.referrer, entry.userId, entry.sessionId, entry.timestamp, entry.duration, entry.userAgent, entry.device, entry.browser, entry.os, entry.country, entry.utmSource, entry.utmMedium, entry.utmCampaign, entry.utmTerm, entry.utmContent],
        )
      }
    },

    async identify(userId: string, traits: IdentifyTraits = {}): Promise<void> {
      const now = new Date().toISOString()
      const existing = identityStore.get(userId)
      if (existing) {
        existing.traits = { ...existing.traits, ...traits }
        existing.lastSeen = now
      } else {
        identityStore.set(userId, { traits, firstSeen: now, lastSeen: now })
      }

      if (useDb) {
        await ensureDb()
        const existingRow = await db!.query<Record<string, unknown>>(
          `SELECT user_id FROM _vibekit_analytics_identities WHERE user_id = $1`,
          [userId],
        )
        if (existingRow.rows.length > 0) {
          await db!.execute(
            `UPDATE _vibekit_analytics_identities SET traits = $1, last_seen = $2 WHERE user_id = $3`,
            [JSON.stringify(existing ? existing.traits : traits), now, userId],
          )
        } else {
          await db!.execute(
            `INSERT INTO _vibekit_analytics_identities (user_id, traits, first_seen, last_seen) VALUES ($1, $2, $3, $4)`,
            [userId, JSON.stringify(traits), now, now],
          )
        }
      }
    },

    async webVitals(metrics: WebVitalsInput, url?: string, options: TrackOptions = {}): Promise<void> {
      const sessionId = getSessionId(options.sessionId)
      const vitalUrl = url ?? options.url ?? '/'
      const timestamp = new Date().toISOString()

      const entries: WebVitalEntry[] = []
      const vitalNames: Array<keyof WebVitalsInput> = ['LCP', 'FID', 'CLS', 'FCP', 'TTFB', 'INP']

      for (const name of vitalNames) {
        const value = metrics[name]
        if (value === undefined) continue
        const entry: WebVitalEntry = {
          id: generateId(),
          name,
          value,
          rating: rateWebVital(name, value),
          url: vitalUrl,
          userId: options.userId ?? null,
          sessionId,
          timestamp,
          navigationType: null,
        }
        entries.push(entry)
        vitalStore.push(entry)
      }

      trimBuffer(vitalStore)

      if (useDb && entries.length > 0) {
        await ensureDb()
        for (const entry of entries) {
          await db!.execute(
            `INSERT INTO _vibekit_analytics_vitals (id, name, value, rating, url, user_id, session_id, timestamp, navigation_type)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [entry.id, entry.name, entry.value, entry.rating, entry.url, entry.userId, entry.sessionId, entry.timestamp, entry.navigationType],
          )
        }
      }
    },

    async getEvents(options: EventQueryOptions = {}): Promise<AnalyticsEvent[]> {
      if (useDb) {
        await ensureDb()
        const { start, end } = resolveTimeRange(options)
        const conditions: string[] = [`timestamp >= $1`, `timestamp <= $2`]
        const params: unknown[] = [start, end]
        let paramIdx = 3

        if (options.event) {
          conditions.push(`event = $${paramIdx}`)
          params.push(options.event)
          paramIdx++
        }
        if (options.userId) {
          conditions.push(`user_id = $${paramIdx}`)
          params.push(options.userId)
          paramIdx++
        }
        if (options.sessionId) {
          conditions.push(`session_id = $${paramIdx}`)
          params.push(options.sessionId)
          paramIdx++
        }

        const where = conditions.join(' AND ')
        const limit = options.limit ?? 1000
        const offset = options.offset ?? 0

        const result = await db!.query<Record<string, unknown>>(
          `SELECT * FROM _vibekit_analytics_events WHERE ${where} ORDER BY timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset],
        )

        return result.rows.map(row => ({
          id: row.id as string,
          event: row.event as string,
          properties: JSON.parse((row.properties as string) || '{}'),
          userId: row.user_id as string | null,
          sessionId: row.session_id as string,
          timestamp: row.timestamp as string,
          url: row.url as string | null,
          referrer: row.referrer as string | null,
          userAgent: row.user_agent as string | null,
          ip: row.ip as string | null,
          country: row.country as string | null,
          device: row.device as string | null,
          browser: row.browser as string | null,
          os: row.os as string | null,
          utmSource: row.utm_source as string | null,
          utmMedium: row.utm_medium as string | null,
          utmCampaign: row.utm_campaign as string | null,
          utmTerm: row.utm_term as string | null,
          utmContent: row.utm_content as string | null,
        }))
      }

      // In-memory
      const { start, end } = resolveTimeRange(options)
      let filtered = eventStore.filter(e => e.timestamp >= start && e.timestamp <= end)
      if (options.event) filtered = filtered.filter(e => e.event === options.event)
      if (options.userId) filtered = filtered.filter(e => e.userId === options.userId)
      if (options.sessionId) filtered = filtered.filter(e => e.sessionId === options.sessionId)

      const offset = options.offset ?? 0
      const limit = options.limit ?? 1000
      return filtered.slice().reverse().slice(offset, offset + limit)
    },

    async getPageViews(options: PageViewQueryOptions = {}): Promise<PageViewEvent[]> {
      if (useDb) {
        await ensureDb()
        const { start, end } = resolveTimeRange(options)
        const conditions: string[] = [`timestamp >= $1`, `timestamp <= $2`]
        const params: unknown[] = [start, end]
        let paramIdx = 3

        if (options.path) {
          conditions.push(`path = $${paramIdx}`)
          params.push(options.path)
          paramIdx++
        }
        if (options.userId) {
          conditions.push(`user_id = $${paramIdx}`)
          params.push(options.userId)
          paramIdx++
        }

        const where = conditions.join(' AND ')
        const limit = options.limit ?? 1000
        const offset = options.offset ?? 0

        const result = await db!.query<Record<string, unknown>>(
          `SELECT * FROM _vibekit_analytics_pageviews WHERE ${where} ORDER BY timestamp DESC LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset],
        )

        return result.rows.map(row => ({
          id: row.id as string,
          url: row.url as string,
          path: row.path as string,
          title: row.title as string | null,
          referrer: row.referrer as string | null,
          userId: row.user_id as string | null,
          sessionId: row.session_id as string,
          timestamp: row.timestamp as string,
          duration: row.duration as number | null,
          userAgent: row.user_agent as string | null,
          device: row.device as string | null,
          browser: row.browser as string | null,
          os: row.os as string | null,
          country: row.country as string | null,
          utmSource: row.utm_source as string | null,
          utmMedium: row.utm_medium as string | null,
          utmCampaign: row.utm_campaign as string | null,
          utmTerm: row.utm_term as string | null,
          utmContent: row.utm_content as string | null,
        }))
      }

      // In-memory
      const { start, end } = resolveTimeRange(options)
      let filtered = pageViewStore.filter(pv => pv.timestamp >= start && pv.timestamp <= end)
      if (options.path) filtered = filtered.filter(pv => pv.path === options.path)
      if (options.userId) filtered = filtered.filter(pv => pv.userId === options.userId)

      const offset = options.offset ?? 0
      const limit = options.limit ?? 1000
      return filtered.slice().reverse().slice(offset, offset + limit)
    },

    async getTopPages(options: TopPagesOptions = {}): Promise<TopPageResult[]> {
      const limit = options.limit ?? 10

      if (useDb) {
        await ensureDb()
        const { start, end } = resolveTimeRange(options)
        const result = await db!.query<{ path: string; views: number; unique_visitors: number }>(
          `SELECT path, COUNT(*) as views, COUNT(DISTINCT COALESCE(user_id, session_id)) as unique_visitors
           FROM _vibekit_analytics_pageviews
           WHERE timestamp >= $1 AND timestamp <= $2
           GROUP BY path
           ORDER BY views DESC
           LIMIT $3`,
          [start, end, limit],
        )
        return result.rows.map(r => ({
          path: r.path,
          views: Number(r.views),
          uniqueVisitors: Number(r.unique_visitors),
        }))
      }

      // In-memory
      const { start, end } = resolveTimeRange(options)
      const filtered = pageViewStore.filter(pv => pv.timestamp >= start && pv.timestamp <= end)
      const pathMap = new Map<string, { views: number; visitors: Set<string> }>()

      for (const pv of filtered) {
        let entry = pathMap.get(pv.path)
        if (!entry) {
          entry = { views: 0, visitors: new Set() }
          pathMap.set(pv.path, entry)
        }
        entry.views++
        entry.visitors.add(pv.userId ?? pv.sessionId)
      }

      const results: TopPageResult[] = []
      for (const [path, data] of pathMap) {
        results.push({ path, views: data.views, uniqueVisitors: data.visitors.size })
      }
      results.sort((a, b) => b.views - a.views)
      return results.slice(0, limit)
    },

    async getTopReferrers(options: TopReferrersOptions = {}): Promise<TopReferrerResult[]> {
      const limit = options.limit ?? 10

      if (useDb) {
        await ensureDb()
        const { start, end } = resolveTimeRange(options)
        const result = await db!.query<{ referrer: string; visits: number }>(
          `SELECT referrer, COUNT(*) as visits
           FROM _vibekit_analytics_pageviews
           WHERE timestamp >= $1 AND timestamp <= $2 AND referrer IS NOT NULL AND referrer != ''
           GROUP BY referrer
           ORDER BY visits DESC
           LIMIT $3`,
          [start, end, limit],
        )
        return result.rows.map(r => ({
          referrer: r.referrer,
          visits: Number(r.visits),
        }))
      }

      // In-memory
      const { start, end } = resolveTimeRange(options)
      const filtered = pageViewStore.filter(pv => pv.timestamp >= start && pv.timestamp <= end && pv.referrer)
      const refMap = new Map<string, number>()
      for (const pv of filtered) {
        refMap.set(pv.referrer!, (refMap.get(pv.referrer!) ?? 0) + 1)
      }

      const results: TopReferrerResult[] = []
      for (const [referrer, visits] of refMap) {
        results.push({ referrer, visits })
      }
      results.sort((a, b) => b.visits - a.visits)
      return results.slice(0, limit)
    },

    async getUniqueVisitors(options: UniqueVisitorsOptions = {}): Promise<UniqueVisitorResult[]> {
      const granularity = options.granularity ?? 'day'

      if (useDb) {
        await ensureDb()
        const { start, end } = resolveTimeRange(options)

        let dateExpr: string
        switch (granularity) {
          case 'hour':
            dateExpr = `substr(timestamp, 1, 13)`
            break
          case 'day':
            dateExpr = `substr(timestamp, 1, 10)`
            break
          case 'week':
            dateExpr = `substr(timestamp, 1, 10)`
            break
          case 'month':
            dateExpr = `substr(timestamp, 1, 7)`
            break
          default:
            dateExpr = `substr(timestamp, 1, 10)`
        }

        const result = await db!.query<{ period: string; visitors: number }>(
          `SELECT ${dateExpr} as period, COUNT(DISTINCT COALESCE(user_id, session_id)) as visitors
           FROM _vibekit_analytics_pageviews
           WHERE timestamp >= $1 AND timestamp <= $2
           GROUP BY period
           ORDER BY period ASC`,
          [start, end],
        )

        return result.rows.map(r => ({
          period: r.period,
          visitors: Number(r.visitors),
        }))
      }

      // In-memory
      const { start, end } = resolveTimeRange(options)
      const filtered = pageViewStore.filter(pv => pv.timestamp >= start && pv.timestamp <= end)
      const periodMap = new Map<string, Set<string>>()

      for (const pv of filtered) {
        let period: string
        switch (granularity) {
          case 'hour':
            period = pv.timestamp.substring(0, 13)
            break
          case 'day':
            period = pv.timestamp.substring(0, 10)
            break
          case 'week':
            period = pv.timestamp.substring(0, 10)
            break
          case 'month':
            period = pv.timestamp.substring(0, 7)
            break
          default:
            period = pv.timestamp.substring(0, 10)
        }
        let visitors = periodMap.get(period)
        if (!visitors) {
          visitors = new Set()
          periodMap.set(period, visitors)
        }
        visitors.add(pv.userId ?? pv.sessionId)
      }

      const results: UniqueVisitorResult[] = []
      for (const [period, visitors] of periodMap) {
        results.push({ period, visitors: visitors.size })
      }
      results.sort((a, b) => a.period.localeCompare(b.period))
      return results
    },

    async getWebVitals(options: WebVitalsQueryOptions = {}): Promise<WebVitalsSummary[]> {
      const vitalNames = ['LCP', 'FID', 'CLS', 'FCP', 'TTFB', 'INP']

      if (useDb) {
        await ensureDb()
        const { start, end } = resolveTimeRange(options)
        const conditions: string[] = [`timestamp >= $1`, `timestamp <= $2`]
        const params: unknown[] = [start, end]
        let paramIdx = 3

        if (options.url) {
          conditions.push(`url = $${paramIdx}`)
          params.push(options.url)
          paramIdx++
        }

        const where = conditions.join(' AND ')
        const result = await db!.query<{ name: string; value: number; rating: string }>(
          `SELECT name, value, rating FROM _vibekit_analytics_vitals WHERE ${where} ORDER BY name ASC, value ASC`,
          params,
        )

        const grouped = new Map<string, Array<{ value: number; rating: string }>>()
        for (const row of result.rows) {
          let arr = grouped.get(row.name)
          if (!arr) {
            arr = []
            grouped.set(row.name, arr)
          }
          arr.push({ value: row.value, rating: row.rating })
        }

        const summaries: WebVitalsSummary[] = []
        for (const name of vitalNames) {
          const entries = grouped.get(name)
          if (!entries || entries.length === 0) continue

          const values = entries.map(e => e.value).sort((a, b) => a - b)
          const sum = values.reduce((a, b) => a + b, 0)
          const goodCount = entries.filter(e => e.rating === 'good').length
          const niCount = entries.filter(e => e.rating === 'needs-improvement').length
          const poorCount = entries.filter(e => e.rating === 'poor').length
          const total = entries.length

          summaries.push({
            name,
            p50: percentileValue(values, 50),
            p75: percentileValue(values, 75),
            p95: percentileValue(values, 95),
            avg: Math.round((sum / total) * 100) / 100,
            count: total,
            goodPercent: Math.round((goodCount / total) * 10000) / 100,
            needsImprovementPercent: Math.round((niCount / total) * 10000) / 100,
            poorPercent: Math.round((poorCount / total) * 10000) / 100,
          })
        }

        return summaries
      }

      // In-memory
      const { start, end } = resolveTimeRange(options)
      let filtered = vitalStore.filter(v => v.timestamp >= start && v.timestamp <= end)
      if (options.url) filtered = filtered.filter(v => v.url === options.url)

      const grouped = new Map<string, WebVitalEntry[]>()
      for (const v of filtered) {
        let arr = grouped.get(v.name)
        if (!arr) {
          arr = []
          grouped.set(v.name, arr)
        }
        arr.push(v)
      }

      const summaries: WebVitalsSummary[] = []
      for (const name of vitalNames) {
        const entries = grouped.get(name)
        if (!entries || entries.length === 0) continue

        const values = entries.map(e => e.value).sort((a, b) => a - b)
        const sum = values.reduce((a, b) => a + b, 0)
        const goodCount = entries.filter(e => e.rating === 'good').length
        const niCount = entries.filter(e => e.rating === 'needs-improvement').length
        const poorCount = entries.filter(e => e.rating === 'poor').length
        const total = entries.length

        summaries.push({
          name,
          p50: percentileValue(values, 50),
          p75: percentileValue(values, 75),
          p95: percentileValue(values, 95),
          avg: Math.round((sum / total) * 100) / 100,
          count: total,
          goodPercent: Math.round((goodCount / total) * 10000) / 100,
          needsImprovementPercent: Math.round((niCount / total) * 10000) / 100,
          poorPercent: Math.round((poorCount / total) * 10000) / 100,
        })
      }

      return summaries
    },

    async getSessions(options: SessionQueryOptions = {}): Promise<SessionData[]> {
      if (useDb) {
        await ensureDb()
        const { start, end } = resolveTimeRange(options)
        const conditions: string[] = []
        const params: unknown[] = [start, end]
        let paramIdx = 3

        if (options.userId) {
          conditions.push(`AND e.user_id = $${paramIdx}`)
          params.push(options.userId)
          paramIdx++
        }

        const limit = options.limit ?? 100
        const offset = options.offset ?? 0
        const extraWhere = conditions.join(' ')

        const result = await db!.query<Record<string, unknown>>(
          `SELECT
             session_id,
             MIN(user_id) as user_id,
             MIN(timestamp) as started_at,
             MAX(timestamp) as last_activity_at,
             COUNT(*) as event_count
           FROM (
             SELECT session_id, user_id, timestamp FROM _vibekit_analytics_events
             WHERE timestamp >= $1 AND timestamp <= $2 ${extraWhere}
             UNION ALL
             SELECT session_id, user_id, timestamp FROM _vibekit_analytics_pageviews
             WHERE timestamp >= $1 AND timestamp <= $2 ${extraWhere}
           ) e
           GROUP BY session_id
           ORDER BY started_at DESC
           LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
          [...params, limit, offset],
        )

        const sessions: SessionData[] = []
        for (const row of result.rows) {
          const startedAt = row.started_at as string
          const lastActivityAt = row.last_activity_at as string
          const duration = Math.round((new Date(lastActivityAt).getTime() - new Date(startedAt).getTime()) / 1000)

          const pvCount = await db!.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM _vibekit_analytics_pageviews WHERE session_id = $1`,
            [row.session_id],
          )
          const evCount = await db!.query<{ cnt: number }>(
            `SELECT COUNT(*) as cnt FROM _vibekit_analytics_events WHERE session_id = $1`,
            [row.session_id],
          )

          sessions.push({
            sessionId: row.session_id as string,
            userId: row.user_id as string | null,
            startedAt,
            lastActivityAt,
            pageViews: Number(pvCount.rows[0]?.cnt ?? 0),
            events: Number(evCount.rows[0]?.cnt ?? 0),
            duration,
          })
        }

        return sessions
      }

      // In-memory
      const { start, end } = resolveTimeRange(options)
      const sessionMap = new Map<string, { userId: string | null; startedAt: string; lastActivityAt: string; pageViews: number; events: number }>()

      const filteredEvents = eventStore.filter(e => e.timestamp >= start && e.timestamp <= end)
      const filteredPageViews = pageViewStore.filter(pv => pv.timestamp >= start && pv.timestamp <= end)

      if (options.userId) {
        const uid = options.userId
        for (const e of filteredEvents.filter(ev => ev.userId === uid)) {
          let sess = sessionMap.get(e.sessionId)
          if (!sess) {
            sess = { userId: e.userId, startedAt: e.timestamp, lastActivityAt: e.timestamp, pageViews: 0, events: 0 }
            sessionMap.set(e.sessionId, sess)
          }
          sess.events++
          if (e.timestamp < sess.startedAt) sess.startedAt = e.timestamp
          if (e.timestamp > sess.lastActivityAt) sess.lastActivityAt = e.timestamp
          if (e.userId) sess.userId = e.userId
        }
        for (const pv of filteredPageViews.filter(p => p.userId === uid)) {
          let sess = sessionMap.get(pv.sessionId)
          if (!sess) {
            sess = { userId: pv.userId, startedAt: pv.timestamp, lastActivityAt: pv.timestamp, pageViews: 0, events: 0 }
            sessionMap.set(pv.sessionId, sess)
          }
          sess.pageViews++
          if (pv.timestamp < sess.startedAt) sess.startedAt = pv.timestamp
          if (pv.timestamp > sess.lastActivityAt) sess.lastActivityAt = pv.timestamp
          if (pv.userId) sess.userId = pv.userId
        }
      } else {
        for (const e of filteredEvents) {
          let sess = sessionMap.get(e.sessionId)
          if (!sess) {
            sess = { userId: e.userId, startedAt: e.timestamp, lastActivityAt: e.timestamp, pageViews: 0, events: 0 }
            sessionMap.set(e.sessionId, sess)
          }
          sess.events++
          if (e.timestamp < sess.startedAt) sess.startedAt = e.timestamp
          if (e.timestamp > sess.lastActivityAt) sess.lastActivityAt = e.timestamp
          if (e.userId) sess.userId = e.userId
        }
        for (const pv of filteredPageViews) {
          let sess = sessionMap.get(pv.sessionId)
          if (!sess) {
            sess = { userId: pv.userId, startedAt: pv.timestamp, lastActivityAt: pv.timestamp, pageViews: 0, events: 0 }
            sessionMap.set(pv.sessionId, sess)
          }
          sess.pageViews++
          if (pv.timestamp < sess.startedAt) sess.startedAt = pv.timestamp
          if (pv.timestamp > sess.lastActivityAt) sess.lastActivityAt = pv.timestamp
          if (pv.userId) sess.userId = pv.userId
        }
      }

      const sessions: SessionData[] = []
      for (const [sessionId, data] of sessionMap) {
        sessions.push({
          sessionId,
          userId: data.userId,
          startedAt: data.startedAt,
          lastActivityAt: data.lastActivityAt,
          pageViews: data.pageViews,
          events: data.events,
          duration: Math.round((new Date(data.lastActivityAt).getTime() - new Date(data.startedAt).getTime()) / 1000),
        })
      }
      sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt))

      const offset = options.offset ?? 0
      const limit = options.limit ?? 100
      return sessions.slice(offset, offset + limit)
    },

    async funnel(steps: FunnelStep[]): Promise<FunnelResult> {
      if (steps.length === 0) {
        return { steps: [], overallConversionRate: 0 }
      }

      // Gather session-level event lists
      const sessionEvents = new Map<string, Array<{ event: string; properties: Record<string, unknown>; timestamp: string }>>()

      if (useDb) {
        await ensureDb()
        const result = await db!.query<{ session_id: string; event: string; properties: string; timestamp: string }>(
          `SELECT session_id, event, properties, timestamp FROM _vibekit_analytics_events ORDER BY timestamp ASC`,
        )
        for (const row of result.rows) {
          let arr = sessionEvents.get(row.session_id)
          if (!arr) {
            arr = []
            sessionEvents.set(row.session_id, arr)
          }
          arr.push({ event: row.event, properties: JSON.parse(row.properties), timestamp: row.timestamp })
        }
      } else {
        for (const e of eventStore) {
          let arr = sessionEvents.get(e.sessionId)
          if (!arr) {
            arr = []
            sessionEvents.set(e.sessionId, arr)
          }
          arr.push({ event: e.event, properties: e.properties, timestamp: e.timestamp })
        }
      }

      // For each session, check how far it progresses through the funnel
      const stepCounts = new Array(steps.length).fill(0) as number[]

      for (const events of sessionEvents.values()) {
        let stepIdx = 0
        for (const e of events) {
          if (stepIdx >= steps.length) break
          const step = steps[stepIdx]
          if (e.event !== step.event) continue

          // Check properties match if specified
          if (step.properties) {
            let match = true
            for (const [key, val] of Object.entries(step.properties)) {
              if (e.properties[key] !== val) {
                match = false
                break
              }
            }
            if (!match) continue
          }

          stepCounts[stepIdx]++
          stepIdx++
        }
      }

      const funnelSteps = steps.map((step, idx) => {
        const count = stepCounts[idx]
        const prevCount = idx === 0 ? sessionEvents.size : stepCounts[idx - 1]
        const conversionRate = prevCount > 0 ? Math.round((count / prevCount) * 10000) / 100 : 0
        const dropoffRate = Math.round((100 - conversionRate) * 100) / 100

        return {
          event: step.event,
          count,
          conversionRate,
          dropoffRate,
        }
      })

      const firstCount = sessionEvents.size
      const lastCount = stepCounts[stepCounts.length - 1]
      const overallConversionRate = firstCount > 0 ? Math.round((lastCount / firstCount) * 10000) / 100 : 0

      return { steps: funnelSteps, overallConversionRate }
    },

    async export(options: ExportOptions = {}): Promise<string> {
      const format = options.format ?? 'json'
      const type = options.type ?? 'events'

      if (type === 'events') {
        const events = await this.getEvents({ range: options.range, startDate: options.startDate, endDate: options.endDate, limit: 100000 })
        if (format === 'json') return JSON.stringify(events, null, 2)

        if (events.length === 0) return ''
        const headers = ['id', 'event', 'properties', 'userId', 'sessionId', 'timestamp', 'url', 'referrer', 'device', 'browser', 'os', 'utmSource', 'utmMedium', 'utmCampaign']
        const rows = events.map(e =>
          [e.id, e.event, JSON.stringify(e.properties), e.userId, e.sessionId, e.timestamp, e.url, e.referrer, e.device, e.browser, e.os, e.utmSource, e.utmMedium, e.utmCampaign]
            .map(escapeCsvField).join(',')
        )
        return [headers.join(','), ...rows].join('\n')
      }

      if (type === 'pageviews') {
        const views = await this.getPageViews({ range: options.range, startDate: options.startDate, endDate: options.endDate, limit: 100000 })
        if (format === 'json') return JSON.stringify(views, null, 2)

        if (views.length === 0) return ''
        const headers = ['id', 'url', 'path', 'title', 'referrer', 'userId', 'sessionId', 'timestamp', 'duration', 'device', 'browser', 'os']
        const rows = views.map(pv =>
          [pv.id, pv.url, pv.path, pv.title, pv.referrer, pv.userId, pv.sessionId, pv.timestamp, pv.duration, pv.device, pv.browser, pv.os]
            .map(escapeCsvField).join(',')
        )
        return [headers.join(','), ...rows].join('\n')
      }

      if (type === 'vitals') {
        const vitals = await this.getWebVitals({ range: options.range, startDate: options.startDate, endDate: options.endDate })
        if (format === 'json') return JSON.stringify(vitals, null, 2)

        if (vitals.length === 0) return ''
        const headers = ['name', 'p50', 'p75', 'p95', 'avg', 'count', 'goodPercent', 'needsImprovementPercent', 'poorPercent']
        const rows = vitals.map(v =>
          [v.name, v.p50, v.p75, v.p95, v.avg, v.count, v.goodPercent, v.needsImprovementPercent, v.poorPercent]
            .map(escapeCsvField).join(',')
        )
        return [headers.join(','), ...rows].join('\n')
      }

      return '[]'
    },

    async clear(before?: string): Promise<number> {
      let deleted = 0

      if (before) {
        if (useDb) {
          await ensureDb()
          const r1 = await db!.execute(`DELETE FROM _vibekit_analytics_events WHERE timestamp < $1`, [before])
          const r2 = await db!.execute(`DELETE FROM _vibekit_analytics_pageviews WHERE timestamp < $1`, [before])
          const r3 = await db!.execute(`DELETE FROM _vibekit_analytics_vitals WHERE timestamp < $1`, [before])
          deleted = r1.rowCount + r2.rowCount + r3.rowCount
        }

        const beforeTime = before
        let count = 0
        for (let i = eventStore.length - 1; i >= 0; i--) {
          if (eventStore[i].timestamp < beforeTime) {
            eventStore.splice(i, 1)
            count++
          }
        }
        for (let i = pageViewStore.length - 1; i >= 0; i--) {
          if (pageViewStore[i].timestamp < beforeTime) {
            pageViewStore.splice(i, 1)
            count++
          }
        }
        for (let i = vitalStore.length - 1; i >= 0; i--) {
          if (vitalStore[i].timestamp < beforeTime) {
            vitalStore.splice(i, 1)
            count++
          }
        }
        if (!useDb) deleted = count
      } else {
        if (useDb) {
          await ensureDb()
          const r1 = await db!.execute(`DELETE FROM _vibekit_analytics_events`)
          const r2 = await db!.execute(`DELETE FROM _vibekit_analytics_pageviews`)
          const r3 = await db!.execute(`DELETE FROM _vibekit_analytics_vitals`)
          deleted = r1.rowCount + r2.rowCount + r3.rowCount
        }

        const count = eventStore.length + pageViewStore.length + vitalStore.length
        eventStore.length = 0
        pageViewStore.length = 0
        vitalStore.length = 0
        identityStore.clear()
        if (!useDb) deleted = count
      }

      return deleted
    },
  }
}
