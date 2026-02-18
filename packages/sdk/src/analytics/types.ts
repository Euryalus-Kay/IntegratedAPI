/**
 * VibeKit Analytics Module — Type Definitions
 */

// ── Core Events ──────────────────────────────────────────────────────────

export interface AnalyticsEvent {
  id: string
  event: string
  properties: Record<string, unknown>
  userId: string | null
  sessionId: string
  timestamp: string
  url: string | null
  referrer: string | null
  userAgent: string | null
  ip: string | null
  country: string | null
  device: string | null
  browser: string | null
  os: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
}

export interface PageViewEvent {
  id: string
  url: string
  path: string
  title: string | null
  referrer: string | null
  userId: string | null
  sessionId: string
  timestamp: string
  duration: number | null
  userAgent: string | null
  device: string | null
  browser: string | null
  os: string | null
  country: string | null
  utmSource: string | null
  utmMedium: string | null
  utmCampaign: string | null
  utmTerm: string | null
  utmContent: string | null
}

export interface WebVitalEntry {
  id: string
  name: 'LCP' | 'FID' | 'CLS' | 'FCP' | 'TTFB' | 'INP'
  value: number
  rating: 'good' | 'needs-improvement' | 'poor'
  url: string
  userId: string | null
  sessionId: string
  timestamp: string
  navigationType: string | null
}

// ── Tracking Options ─────────────────────────────────────────────────────

export interface TrackOptions {
  userId?: string
  sessionId?: string
  url?: string
  referrer?: string
  userAgent?: string
  ip?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
}

export interface PageViewOptions {
  title?: string
  referrer?: string
  userId?: string
  sessionId?: string
  duration?: number
  userAgent?: string
  country?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
  utmTerm?: string
  utmContent?: string
}

export interface WebVitalsInput {
  LCP?: number
  FID?: number
  CLS?: number
  FCP?: number
  TTFB?: number
  INP?: number
}

export interface IdentifyTraits {
  email?: string
  name?: string
  plan?: string
  [key: string]: unknown
}

// ── Query Options ────────────────────────────────────────────────────────

export type TimeRange = '24h' | '7d' | '30d' | '90d' | 'custom'

export interface TimeFilter {
  range?: TimeRange
  startDate?: string
  endDate?: string
}

export interface EventQueryOptions extends TimeFilter {
  event?: string
  userId?: string
  sessionId?: string
  limit?: number
  offset?: number
}

export interface PageViewQueryOptions extends TimeFilter {
  path?: string
  userId?: string
  limit?: number
  offset?: number
}

export interface TopPagesOptions extends TimeFilter {
  limit?: number
}

export interface TopReferrersOptions extends TimeFilter {
  limit?: number
}

export interface UniqueVisitorsOptions extends TimeFilter {
  granularity?: 'hour' | 'day' | 'week' | 'month'
}

export interface WebVitalsQueryOptions extends TimeFilter {
  url?: string
}

export interface SessionQueryOptions extends TimeFilter {
  userId?: string
  limit?: number
  offset?: number
}

// ── Query Results ────────────────────────────────────────────────────────

export interface TopPageResult {
  path: string
  views: number
  uniqueVisitors: number
}

export interface TopReferrerResult {
  referrer: string
  visits: number
}

export interface UniqueVisitorResult {
  period: string
  visitors: number
}

export interface WebVitalsSummary {
  name: string
  p50: number
  p75: number
  p95: number
  avg: number
  count: number
  goodPercent: number
  needsImprovementPercent: number
  poorPercent: number
}

export interface SessionData {
  sessionId: string
  userId: string | null
  startedAt: string
  lastActivityAt: string
  pageViews: number
  events: number
  duration: number
}

export interface FunnelStep {
  event: string
  properties?: Record<string, unknown>
}

export interface FunnelResult {
  steps: Array<{
    event: string
    count: number
    conversionRate: number
    dropoffRate: number
  }>
  overallConversionRate: number
}

export interface ExportOptions extends TimeFilter {
  format?: 'json' | 'csv'
  type?: 'events' | 'pageviews' | 'vitals'
}

// ── Database Adapter ─────────────────────────────────────────────────────

export interface AnalyticsDbAdapter {
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount: number }>
  execute: (sql: string, params?: unknown[]) => Promise<{ rowCount: number }>
}

// ── Config ───────────────────────────────────────────────────────────────

export interface AnalyticsConfig {
  db?: AnalyticsDbAdapter
  persistence?: 'memory' | 'database'
  sessionTimeout?: number
  maxBufferSize?: number
}

// ── Manager Interface ────────────────────────────────────────────────────

export interface AnalyticsManager {
  track: (event: string, properties?: Record<string, unknown>, options?: TrackOptions) => Promise<void>
  pageView: (url: string, options?: PageViewOptions) => Promise<void>
  identify: (userId: string, traits?: IdentifyTraits) => Promise<void>
  webVitals: (metrics: WebVitalsInput, url?: string, options?: TrackOptions) => Promise<void>
  getEvents: (options?: EventQueryOptions) => Promise<AnalyticsEvent[]>
  getPageViews: (options?: PageViewQueryOptions) => Promise<PageViewEvent[]>
  getTopPages: (options?: TopPagesOptions) => Promise<TopPageResult[]>
  getTopReferrers: (options?: TopReferrersOptions) => Promise<TopReferrerResult[]>
  getUniqueVisitors: (options?: UniqueVisitorsOptions) => Promise<UniqueVisitorResult[]>
  getWebVitals: (options?: WebVitalsQueryOptions) => Promise<WebVitalsSummary[]>
  getSessions: (options?: SessionQueryOptions) => Promise<SessionData[]>
  funnel: (steps: FunnelStep[]) => Promise<FunnelResult>
  export: (options?: ExportOptions) => Promise<string>
  clear: (before?: string) => Promise<number>
}
