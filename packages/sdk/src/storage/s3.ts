/**
 * VibeKit Storage — S3-Compatible Adapter
 *
 * Uses fetch() with AWS Signature V4 signing to communicate with S3-compatible
 * APIs (AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, etc.).
 *
 * No AWS SDK dependency required.
 */

import crypto from 'node:crypto'
import type {
  StorageAdapter,
  UploadOptions,
  FileInfo,
  ListFilesOptions,
  ListFilesResult,
} from './types.js'
import { getMimeTypeFromExtension } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('vibekit:storage:s3')

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface S3AdapterConfig {
  bucket: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  /** Custom endpoint for R2, MinIO, etc. If not set, uses AWS S3 default. */
  endpoint?: string
  /** Whether to use path-style URLs (required for MinIO, optional for others). */
  forcePathStyle?: boolean
  /** Public base URL for generating public file URLs. */
  publicUrl?: string
}

// ---------------------------------------------------------------------------
// AWS Signature V4 Helpers
// ---------------------------------------------------------------------------

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest()
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function getSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacSha256(`AWS4${secretKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'aws4_request')
  return kSigning
}

function toAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return {
    amzDate: iso, // e.g. 20240101T120000Z
    dateStamp: iso.slice(0, 8), // e.g. 20240101
  }
}

interface SignedRequestOptions {
  method: string
  path: string
  queryParams?: Record<string, string>
  headers: Record<string, string>
  body?: Buffer | string
  config: S3AdapterConfig
}

function signRequest(opts: SignedRequestOptions): Record<string, string> {
  const { method, path, queryParams, headers, body, config } = opts
  const now = new Date()
  const { amzDate, dateStamp } = toAmzDate(now)
  const region = config.region
  const service = 's3'

  const payloadHash = sha256Hex(body || '')

  // Build canonical headers
  const signedHeaderEntries: Record<string, string> = {
    ...headers,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  const sortedHeaderKeys = Object.keys(signedHeaderEntries).sort()
  const canonicalHeaders = sortedHeaderKeys
    .map(k => `${k.toLowerCase()}:${signedHeaderEntries[k].trim()}`)
    .join('\n') + '\n'
  const signedHeaders = sortedHeaderKeys.map(k => k.toLowerCase()).join(';')

  // Build canonical query string
  const sortedQueryKeys = Object.keys(queryParams || {}).sort()
  const canonicalQueryString = sortedQueryKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent((queryParams || {})[k])}`)
    .join('&')

  // Build canonical request
  const canonicalRequest = [
    method,
    path,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, region, service)
  const signature = hmacSha256(signingKey, stringToSign).toString('hex')

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    ...signedHeaderEntries,
    Authorization: authorization,
  }
}

// ---------------------------------------------------------------------------
// S3 request helper
// ---------------------------------------------------------------------------

function getHostAndPath(
  config: S3AdapterConfig,
  objectKey?: string,
): { host: string; basePath: string; baseUrl: string } {
  if (config.endpoint) {
    const url = new URL(config.endpoint)
    const host = url.host
    if (config.forcePathStyle) {
      const basePath = `/${config.bucket}${objectKey ? `/${objectKey}` : ''}`
      return { host, basePath, baseUrl: `${url.protocol}//${host}` }
    }
    // Virtual-hosted style with custom endpoint
    const vHost = `${config.bucket}.${host}`
    const basePath = objectKey ? `/${objectKey}` : '/'
    return { host: vHost, basePath, baseUrl: `${url.protocol}//${vHost}` }
  }

  // Default AWS S3
  const host = `${config.bucket}.s3.${config.region}.amazonaws.com`
  const basePath = objectKey ? `/${objectKey}` : '/'
  return { host, basePath, baseUrl: `https://${host}` }
}

async function s3Request(
  config: S3AdapterConfig,
  method: string,
  objectKey?: string,
  options?: {
    body?: Buffer | string
    queryParams?: Record<string, string>
    extraHeaders?: Record<string, string>
  },
): Promise<Response> {
  const { host, basePath, baseUrl } = getHostAndPath(config, objectKey)

  const headers: Record<string, string> = {
    host,
    ...(options?.extraHeaders || {}),
  }

  const signedHeaders = signRequest({
    method,
    path: basePath,
    queryParams: options?.queryParams,
    headers,
    body: options?.body,
    config,
  })

  const queryString = options?.queryParams
    ? '?' + Object.entries(options.queryParams)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&')
    : ''

  const url = `${baseUrl}${basePath}${queryString}`

  const fetchHeaders: Record<string, string> = { ...signedHeaders }
  // Remove the 'host' header for fetch (it's set automatically)
  delete fetchHeaders['host']

  const response = await fetch(url, {
    method,
    headers: fetchHeaders,
    body: options?.body || undefined,
  })

  return response
}

// ---------------------------------------------------------------------------
// XML parsing helpers (minimal, no dependency needed)
// ---------------------------------------------------------------------------

function extractXmlTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)
  const match = xml.match(regex)
  return match ? match[1] : null
}

function extractAllXmlTags(xml: string, tag: string): string[] {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g')
  const results: string[] = []
  let match
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1])
  }
  return results
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createS3StorageAdapter(config: S3AdapterConfig): StorageAdapter {
  log.info('Initializing S3 storage adapter', {
    bucket: config.bucket,
    region: config.region,
    endpoint: config.endpoint || 'AWS S3',
  })

  function buildObjectKey(options: UploadOptions): string {
    const parts: string[] = []
    if (options.folder) parts.push(options.folder)
    parts.push(options.filename)
    return parts.join('/')
  }

  function getPublicUrl(objectKey: string): string {
    if (config.publicUrl) {
      return `${config.publicUrl.replace(/\/$/, '')}/${objectKey}`
    }
    const { baseUrl } = getHostAndPath(config, objectKey)
    return `${baseUrl}/${objectKey}`
  }

  const adapter: StorageAdapter = {
    async upload(data: Buffer | Uint8Array, options: UploadOptions): Promise<FileInfo> {
      const objectKey = buildObjectKey(options)
      const contentType = options.contentType || getMimeTypeFromExtension(options.filename)
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data)

      const extraHeaders: Record<string, string> = {
        'content-type': contentType,
        'content-length': String(buf.length),
      }

      if (options.cacheControl) {
        extraHeaders['cache-control'] = options.cacheControl
      }

      if (options.metadata) {
        for (const [k, v] of Object.entries(options.metadata)) {
          extraHeaders[`x-amz-meta-${k.toLowerCase()}`] = v
        }
      }

      const response = await s3Request(config, 'PUT', objectKey, {
        body: buf,
        extraHeaders,
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`S3 upload failed (${response.status}): ${errorBody}`)
      }

      const etag = response.headers.get('etag') || undefined

      const info: FileInfo = {
        id: crypto.randomUUID(),
        path: objectKey,
        url: getPublicUrl(objectKey),
        filename: options.filename,
        contentType,
        size: buf.length,
        folder: options.folder || '',
        bucket: config.bucket,
        public: options.public !== false,
        metadata: options.metadata || {},
        etag: etag?.replace(/"/g, ''),
        cacheControl: options.cacheControl,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      return info
    },

    async delete(objectPath: string): Promise<void> {
      const response = await s3Request(config, 'DELETE', objectPath)
      if (!response.ok && response.status !== 204 && response.status !== 404) {
        const errorBody = await response.text()
        throw new Error(`S3 delete failed (${response.status}): ${errorBody}`)
      }
    },

    async deleteMany(paths: string[]): Promise<void> {
      // Use S3 batch delete API
      if (paths.length === 0) return

      const xmlObjects = paths
        .map(p => `<Object><Key>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Key></Object>`)
        .join('')
      const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${xmlObjects}</Delete>`
      const bodyBuf = Buffer.from(body, 'utf-8')
      const contentMd5 = crypto.createHash('md5').update(bodyBuf).digest('base64')

      const response = await s3Request(config, 'POST', undefined, {
        body: bodyBuf,
        queryParams: { delete: '' },
        extraHeaders: {
          'content-type': 'application/xml',
          'content-md5': contentMd5,
        },
      })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`S3 batch delete failed (${response.status}): ${errorBody}`)
      }
    },

    async getInfo(objectPath: string): Promise<FileInfo | null> {
      const response = await s3Request(config, 'HEAD', objectPath)

      if (response.status === 404 || response.status === 403) {
        return null
      }

      if (!response.ok) {
        return null
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const size = parseInt(response.headers.get('content-length') || '0', 10)
      const etag = response.headers.get('etag')?.replace(/"/g, '')
      const lastModified = response.headers.get('last-modified')

      // Extract folder from path
      const lastSlash = objectPath.lastIndexOf('/')
      const folder = lastSlash >= 0 ? objectPath.slice(0, lastSlash) : ''
      const filename = lastSlash >= 0 ? objectPath.slice(lastSlash + 1) : objectPath

      // Extract user metadata
      const metadata: Record<string, string> = {}
      response.headers.forEach((value, key) => {
        if (key.startsWith('x-amz-meta-')) {
          metadata[key.slice(11)] = value
        }
      })

      return {
        id: etag || objectPath,
        path: objectPath,
        url: getPublicUrl(objectPath),
        filename,
        contentType,
        size,
        folder,
        bucket: config.bucket,
        public: true,
        metadata,
        etag,
        cacheControl: response.headers.get('cache-control') || undefined,
        createdAt: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
        updatedAt: lastModified ? new Date(lastModified).toISOString() : new Date().toISOString(),
      }
    },

    getUrl(objectPath: string): string {
      return getPublicUrl(objectPath)
    },

    async list(options: ListFilesOptions = {}): Promise<ListFilesResult> {
      const queryParams: Record<string, string> = {
        'list-type': '2',
        'max-keys': String(options.limit || 100),
      }

      if (options.prefix) {
        queryParams['prefix'] = options.prefix
      } else if (options.folder) {
        queryParams['prefix'] = options.folder.endsWith('/') ? options.folder : `${options.folder}/`
      }

      if (options.cursor) {
        queryParams['continuation-token'] = options.cursor
      }

      const response = await s3Request(config, 'GET', undefined, { queryParams })

      if (!response.ok) {
        const errorBody = await response.text()
        throw new Error(`S3 list failed (${response.status}): ${errorBody}`)
      }

      const xml = await response.text()
      const isTruncated = extractXmlTag(xml, 'IsTruncated') === 'true'
      const nextToken = extractXmlTag(xml, 'NextContinuationToken')

      // Parse Contents elements
      const contentBlocks = extractAllXmlTags(xml, 'Contents')
      const files: FileInfo[] = contentBlocks.map(block => {
        const key = extractXmlTag(block, 'Key') || ''
        const size = parseInt(extractXmlTag(block, 'Size') || '0', 10)
        const lastModified = extractXmlTag(block, 'LastModified') || new Date().toISOString()
        const etag = (extractXmlTag(block, 'ETag') || '').replace(/"/g, '')

        const lastSlash = key.lastIndexOf('/')
        const folder = lastSlash >= 0 ? key.slice(0, lastSlash) : ''
        const filename = lastSlash >= 0 ? key.slice(lastSlash + 1) : key

        return {
          id: etag || key,
          path: key,
          url: getPublicUrl(key),
          filename,
          contentType: getMimeTypeFromExtension(filename),
          size,
          folder,
          bucket: config.bucket,
          public: true,
          metadata: {},
          etag,
          createdAt: lastModified,
          updatedAt: lastModified,
        }
      })

      // Apply search filter if provided
      const filtered = options.search
        ? files.filter(f => f.filename.includes(options.search!))
        : files

      return {
        files: filtered,
        cursor: isTruncated && nextToken ? nextToken : null,
        hasMore: isTruncated,
      }
    },

    async exists(objectPath: string): Promise<boolean> {
      const response = await s3Request(config, 'HEAD', objectPath)
      return response.ok
    },
  }

  return adapter
}

// ---------------------------------------------------------------------------
// Config from environment
// ---------------------------------------------------------------------------

export function s3ConfigFromEnv(): S3AdapterConfig | null {
  const bucket = process.env.S3_BUCKET
  if (!bucket) return null

  return {
    bucket,
    region: process.env.S3_REGION || 'us-east-1',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY || '',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    publicUrl: process.env.S3_PUBLIC_URL || undefined,
  }
}

export function r2ConfigFromEnv(): S3AdapterConfig | null {
  const bucket = process.env.R2_BUCKET
  const accountId = process.env.R2_ACCOUNT_ID || process.env.CF_ACCOUNT_ID
  if (!bucket) return null

  return {
    bucket,
    region: 'auto',
    accessKeyId: process.env.R2_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || '',
    endpoint: accountId ? `https://${accountId}.r2.cloudflarestorage.com` : process.env.R2_ENDPOINT || '',
    forcePathStyle: true,
    publicUrl: process.env.R2_PUBLIC_URL || undefined,
  }
}
