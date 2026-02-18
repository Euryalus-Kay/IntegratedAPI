import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Storage — CDN / Edge Caching Manager
// Manages CDN URLs, cache policies, invalidation tracking, custom domains,
// and bandwidth statistics for storage buckets.
// Replaces: Vercel CDN, Cloudflare R2, AWS CloudFront
// ──────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface CdnConfig {
  /** Base URL for CDN endpoints (e.g. https://cdn.example.com) */
  baseUrl?: string
  /** Default TTL in seconds for cache entries (default: 86400 = 24h) */
  defaultTtl?: number
  /** Default Cache-Control max-age in seconds (default: 31536000 = 1 year) */
  maxAge?: number
  /** s-maxage for shared/CDN caches in seconds (default: 86400) */
  sMaxAge?: number
  /** stale-while-revalidate window in seconds (default: 60) */
  staleWhileRevalidate?: number
  /** Whether assets are treated as immutable (default: false) */
  immutable?: boolean
  /** Enable compression hints in headers (default: true) */
  compression?: boolean
  /** Data directory for persisting CDN state */
  dataDir?: string
}

export interface CachePolicy {
  /** Cache-Control max-age in seconds */
  maxAge: number
  /** s-maxage for CDN/proxy caches in seconds */
  sMaxAge: number
  /** stale-while-revalidate window in seconds */
  staleWhileRevalidate: number
  /** Whether files are immutable (never change at the same URL) */
  immutable: boolean
  /** Custom Cache-Control directives */
  customDirectives?: string[]
  /** Content types that should not be cached */
  noCacheTypes?: string[]
  /** Whether to add Vary headers */
  vary?: string[]
}

export interface CacheHeaders {
  'Cache-Control': string
  'CDN-Cache-Control'?: string
  'Surrogate-Control'?: string
  Vary?: string
  ETag?: string
  'X-Cache-Status'?: string
}

export interface CdnStats {
  totalRequests: number
  cacheHits: number
  cacheMisses: number
  hitRate: number
  totalBandwidthBytes: number
  bandwidthByBucket: Record<string, number>
  purgeCount: number
  lastPurgeAt: string | null
}

export interface CustomDomain {
  domain: string
  bucket: string
  ssl: boolean
  status: 'pending' | 'active' | 'error'
  createdAt: string
  verifiedAt: string | null
  certificateExpiresAt: string | null
}

export interface PurgeResult {
  purgedUrls: string[]
  purgedAt: string
  estimatedPropagationSeconds: number
}

export interface WarmCacheResult {
  warmedUrls: string[]
  failedUrls: string[]
  warmedAt: string
}

// ── Internal Store ───────────────────────────────────────────────────────────

interface CdnStore {
  config: {
    baseUrl: string
    defaultTtl: number
    maxAge: number
    sMaxAge: number
    staleWhileRevalidate: number
    immutable: boolean
    compression: boolean
  }
  policies: Record<string, CachePolicy>
  domains: Record<string, CustomDomain>
  stats: CdnStats
  purgeLog: Array<{ urls: string[]; purgedAt: string }>
  warmLog: Array<{ urls: string[]; warmedAt: string }>
}

function getStorePath(dataDir: string): string {
  return path.join(dataDir, '_vibekit_cdn.json')
}

function loadStore(storePath: string, defaults: CdnStore['config']): CdnStore {
  if (!fs.existsSync(storePath)) {
    return {
      config: defaults,
      policies: {},
      domains: {},
      stats: {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        hitRate: 0,
        totalBandwidthBytes: 0,
        bandwidthByBucket: {},
        purgeCount: 0,
        lastPurgeAt: null,
      },
      purgeLog: [],
      warmLog: [],
    }
  }
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'))
  } catch {
    return {
      config: defaults,
      policies: {},
      domains: {},
      stats: {
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        hitRate: 0,
        totalBandwidthBytes: 0,
        bandwidthByBucket: {},
        purgeCount: 0,
        lastPurgeAt: null,
      },
      purgeLog: [],
      warmLog: [],
    }
  }
}

function saveStore(storePath: string, store: CdnStore): void {
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createCdnManager(config?: CdnConfig) {
  const dataDir = config?.dataDir || path.join(process.cwd(), '.vibekit')
  const storePath = getStorePath(dataDir)

  const defaults: CdnStore['config'] = {
    baseUrl: config?.baseUrl || 'http://localhost:3000',
    defaultTtl: config?.defaultTtl || 86400,
    maxAge: config?.maxAge || 31536000,
    sMaxAge: config?.sMaxAge || 86400,
    staleWhileRevalidate: config?.staleWhileRevalidate || 60,
    immutable: config?.immutable || false,
    compression: config?.compression !== false,
  }

  /** Update the CDN configuration */
  function configure(options: Partial<CdnConfig>): CdnStore['config'] {
    const store = loadStore(storePath, defaults)

    if (options.baseUrl !== undefined) store.config.baseUrl = options.baseUrl
    if (options.defaultTtl !== undefined) store.config.defaultTtl = options.defaultTtl
    if (options.maxAge !== undefined) store.config.maxAge = options.maxAge
    if (options.sMaxAge !== undefined) store.config.sMaxAge = options.sMaxAge
    if (options.staleWhileRevalidate !== undefined) store.config.staleWhileRevalidate = options.staleWhileRevalidate
    if (options.immutable !== undefined) store.config.immutable = options.immutable
    if (options.compression !== undefined) store.config.compression = options.compression

    saveStore(storePath, store)
    return store.config
  }

  /** Get a public CDN URL for a file in a bucket */
  function getPublicUrl(
    bucket: string,
    key: string,
    options?: { transform?: Record<string, string | number>; download?: boolean }
  ): string {
    const store = loadStore(storePath, defaults)

    // Check if there is a custom domain mapped to this bucket
    const customDomain = Object.values(store.domains).find(
      d => d.bucket === bucket && d.status === 'active'
    )

    let base: string
    if (customDomain) {
      const protocol = customDomain.ssl ? 'https' : 'http'
      base = `${protocol}://${customDomain.domain}`
    } else {
      base = store.config.baseUrl
    }

    let url = `${base}/storage/v1/object/public/${bucket}/${key}`

    const params: string[] = []
    if (options?.transform) {
      for (const [k, v] of Object.entries(options.transform)) {
        params.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      }
    }
    if (options?.download) {
      params.push('download=true')
    }
    if (params.length > 0) {
      url += `?${params.join('&')}`
    }

    // Track the request in stats
    store.stats.totalRequests++
    store.stats.cacheHits++
    store.stats.hitRate = store.stats.totalRequests > 0
      ? Math.round((store.stats.cacheHits / store.stats.totalRequests) * 10000) / 100
      : 0
    if (!store.stats.bandwidthByBucket[bucket]) {
      store.stats.bandwidthByBucket[bucket] = 0
    }
    saveStore(storePath, store)

    return url
  }

  /** Purge specific URLs from the CDN cache */
  function purge(urls: string[]): PurgeResult {
    if (urls.length === 0) {
      throw new Error('At least one URL is required for purging')
    }

    const store = loadStore(storePath, defaults)
    const now = new Date().toISOString()

    store.stats.purgeCount += urls.length
    store.stats.lastPurgeAt = now
    store.purgeLog.push({ urls, purgedAt: now })

    // Keep only last 100 purge log entries
    if (store.purgeLog.length > 100) {
      store.purgeLog = store.purgeLog.slice(-100)
    }

    saveStore(storePath, store)

    return {
      purgedUrls: urls,
      purgedAt: now,
      estimatedPropagationSeconds: 30,
    }
  }

  /** Purge the entire CDN cache */
  function purgeAll(): PurgeResult {
    const store = loadStore(storePath, defaults)
    const now = new Date().toISOString()

    store.stats.purgeCount++
    store.stats.lastPurgeAt = now
    store.stats.cacheHits = 0
    store.stats.cacheMisses = 0
    store.stats.hitRate = 0
    store.purgeLog.push({ urls: ['*'], purgedAt: now })

    if (store.purgeLog.length > 100) {
      store.purgeLog = store.purgeLog.slice(-100)
    }

    saveStore(storePath, store)

    return {
      purgedUrls: ['*'],
      purgedAt: now,
      estimatedPropagationSeconds: 120,
    }
  }

  /** Generate Cache-Control and related headers based on options or bucket policy */
  function getCacheHeaders(options?: {
    bucket?: string
    contentType?: string
    etag?: string
    isPublic?: boolean
  }): CacheHeaders {
    const store = loadStore(storePath, defaults)
    const bucket = options?.bucket
    const policy = bucket ? store.policies[bucket] : null

    const maxAge = policy?.maxAge ?? store.config.maxAge
    const sMaxAge = policy?.sMaxAge ?? store.config.sMaxAge
    const staleWhileRevalidate = policy?.staleWhileRevalidate ?? store.config.staleWhileRevalidate
    const immutable = policy?.immutable ?? store.config.immutable
    const isPublic = options?.isPublic !== false

    // Check if this content type should not be cached
    if (policy?.noCacheTypes && options?.contentType) {
      const shouldNotCache = policy.noCacheTypes.some(t => {
        if (t.endsWith('/*')) {
          return options.contentType!.startsWith(t.slice(0, -1))
        }
        return options.contentType === t
      })
      if (shouldNotCache) {
        const headers: CacheHeaders = {
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          'X-Cache-Status': 'BYPASS',
        }
        return headers
      }
    }

    // Build Cache-Control value
    const directives: string[] = []
    directives.push(isPublic ? 'public' : 'private')
    directives.push(`max-age=${maxAge}`)

    if (sMaxAge > 0) {
      directives.push(`s-maxage=${sMaxAge}`)
    }

    if (staleWhileRevalidate > 0) {
      directives.push(`stale-while-revalidate=${staleWhileRevalidate}`)
    }

    if (immutable) {
      directives.push('immutable')
    }

    if (policy?.customDirectives) {
      for (const d of policy.customDirectives) {
        directives.push(d)
      }
    }

    const headers: CacheHeaders = {
      'Cache-Control': directives.join(', '),
      'CDN-Cache-Control': `max-age=${sMaxAge}`,
      'Surrogate-Control': `max-age=${sMaxAge}`,
      'X-Cache-Status': 'HIT',
    }

    if (policy?.vary && policy.vary.length > 0) {
      headers.Vary = policy.vary.join(', ')
    } else {
      headers.Vary = 'Accept-Encoding'
    }

    if (options?.etag) {
      headers.ETag = `"${options.etag}"`
    }

    return headers
  }

  /** Set a caching policy for a specific bucket */
  function setCachePolicy(bucket: string, policy: CachePolicy): void {
    const store = loadStore(storePath, defaults)
    store.policies[bucket] = policy
    saveStore(storePath, store)
  }

  /** Get the caching policy for a bucket (or the global defaults) */
  function getCachePolicy(bucket: string): CachePolicy {
    const store = loadStore(storePath, defaults)
    const existing = store.policies[bucket]

    if (existing) return existing

    return {
      maxAge: store.config.maxAge,
      sMaxAge: store.config.sMaxAge,
      staleWhileRevalidate: store.config.staleWhileRevalidate,
      immutable: store.config.immutable,
    }
  }

  /** Get CDN cache statistics */
  function getStats(): CdnStats {
    const store = loadStore(storePath, defaults)
    return { ...store.stats }
  }

  /** Pre-warm the CDN cache for a list of URLs */
  function warmCache(urls: string[]): WarmCacheResult {
    if (urls.length === 0) {
      throw new Error('At least one URL is required for cache warming')
    }

    const store = loadStore(storePath, defaults)
    const now = new Date().toISOString()
    const warmedUrls: string[] = []
    const failedUrls: string[] = []

    for (const url of urls) {
      try {
        // In local development, verify the URL points to a valid path
        const parsed = new URL(url)
        const urlPath = decodeURIComponent(parsed.pathname)

        // Extract bucket and key from /storage/v1/object/public/{bucket}/{key}
        const match = urlPath.match(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/)
        if (match) {
          const fileBucket = match[1]
          const fileKey = match[2]
          const storageDir = path.join(dataDir, 'storage', fileBucket, fileKey)
          if (fs.existsSync(storageDir)) {
            const stat = fs.statSync(storageDir)
            if (!store.stats.bandwidthByBucket[fileBucket]) {
              store.stats.bandwidthByBucket[fileBucket] = 0
            }
            store.stats.bandwidthByBucket[fileBucket] += stat.size
            store.stats.totalBandwidthBytes += stat.size
          }
        }

        warmedUrls.push(url)
        store.stats.totalRequests++
        store.stats.cacheHits++
      } catch {
        failedUrls.push(url)
        store.stats.totalRequests++
        store.stats.cacheMisses++
      }
    }

    store.stats.hitRate = store.stats.totalRequests > 0
      ? Math.round((store.stats.cacheHits / store.stats.totalRequests) * 10000) / 100
      : 0

    store.warmLog.push({ urls: warmedUrls, warmedAt: now })
    if (store.warmLog.length > 100) {
      store.warmLog = store.warmLog.slice(-100)
    }

    saveStore(storePath, store)

    return { warmedUrls, failedUrls, warmedAt: now }
  }

  /** Add a custom domain mapped to a specific bucket */
  function addCustomDomain(domain: string, bucket: string): CustomDomain {
    if (!domain || !bucket) {
      throw new Error('Both domain and bucket are required')
    }

    // Basic domain validation
    const domainRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/
    if (!domainRegex.test(domain)) {
      throw new Error(`Invalid domain format: "${domain}"`)
    }

    const store = loadStore(storePath, defaults)

    if (store.domains[domain]) {
      throw new Error(`Domain "${domain}" is already configured`)
    }

    const now = new Date().toISOString()
    const entry: CustomDomain = {
      domain,
      bucket,
      ssl: true,
      status: 'pending',
      createdAt: now,
      verifiedAt: null,
      certificateExpiresAt: null,
    }

    store.domains[domain] = entry

    // In local dev, auto-activate the domain
    entry.status = 'active'
    entry.verifiedAt = now
    const certExpiry = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    entry.certificateExpiresAt = certExpiry.toISOString()

    saveStore(storePath, store)
    return entry
  }

  /** Remove a custom domain mapping */
  function removeCustomDomain(domain: string): void {
    const store = loadStore(storePath, defaults)

    if (!store.domains[domain]) {
      throw new Error(`Domain "${domain}" not found`)
    }

    delete store.domains[domain]
    saveStore(storePath, store)
  }

  /** List all custom domain mappings */
  function listCustomDomains(): CustomDomain[] {
    const store = loadStore(storePath, defaults)
    return Object.values(store.domains)
  }

  return {
    configure,
    getPublicUrl,
    purge,
    purgeAll,
    getCacheHeaders,
    setCachePolicy,
    getCachePolicy,
    getStats,
    warmCache,
    addCustomDomain,
    removeCustomDomain,
    listCustomDomains,
  }
}
