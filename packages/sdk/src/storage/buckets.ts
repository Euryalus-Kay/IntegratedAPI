import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

/**
 * VibeKit Storage Buckets
 * Named storage containers with policies, signed URLs, and file management.
 * Replaces: Supabase Storage Buckets, AWS S3, Cloudflare R2
 */

export interface Bucket {
  id: string
  name: string
  public: boolean
  fileSizeLimit: number | null
  allowedMimeTypes: string[] | null
  createdAt: string
  updatedAt: string
}

export interface StorageObject {
  id: string
  bucketId: string
  name: string
  path: string
  size: number
  mimeType: string
  etag: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export interface UploadToBucketOptions {
  contentType?: string
  metadata?: Record<string, unknown>
  upsert?: boolean
}

export interface SignedUrlOptions {
  expiresIn?: number  // seconds, default 3600
  download?: boolean
  transform?: ImageTransformOptions
}

export interface ImageTransformOptions {
  width?: number
  height?: number
  quality?: number
  format?: 'webp' | 'png' | 'jpeg' | 'avif'
  resize?: 'cover' | 'contain' | 'fill'
}

export interface ListObjectsOptions {
  prefix?: string
  limit?: number
  offset?: number
  sortBy?: { column: 'name' | 'created_at' | 'updated_at' | 'size'; order: 'asc' | 'desc' }
  search?: string
}

export interface ListObjectsResult {
  objects: StorageObject[]
  total: number
}

interface BucketStore {
  buckets: Record<string, Bucket>
  objects: Record<string, StorageObject[]>
  signedUrls: Record<string, { objectPath: string; bucketId: string; expiresAt: number }>
}

function getStorePath(dataDir: string): string {
  return path.join(dataDir, '.vibekit-storage.json')
}

function loadStore(storePath: string): BucketStore {
  if (!fs.existsSync(storePath)) return { buckets: {}, objects: {}, signedUrls: {} }
  try { return JSON.parse(fs.readFileSync(storePath, 'utf8')) }
  catch { return { buckets: {}, objects: {}, signedUrls: {} } }
}

function saveStore(storePath: string, store: BucketStore): void {
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
}

function getBucketDir(dataDir: string, bucketName: string): string {
  return path.join(dataDir, 'storage', bucketName)
}

function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf', '.json': 'application/json',
    '.txt': 'text/plain', '.html': 'text/html', '.css': 'text/css',
    '.js': 'application/javascript', '.ts': 'text/typescript',
    '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
    '.zip': 'application/zip', '.csv': 'text/csv', '.xml': 'application/xml',
    '.avif': 'image/avif', '.ico': 'image/x-icon',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

export function createBucketManager(dataDir?: string) {
  const dir = dataDir || path.join(process.cwd(), '.vibekit')
  const storePath = getStorePath(dir)

  const buckets = {
    /** Create a new bucket */
    create(name: string, options?: { public?: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }): Bucket {
      const store = loadStore(storePath)
      if (store.buckets[name]) throw new Error(`Bucket "${name}" already exists`)
      const now = new Date().toISOString()
      const bucket: Bucket = {
        id: crypto.randomUUID(), name,
        public: options?.public ?? false,
        fileSizeLimit: options?.fileSizeLimit ?? null,
        allowedMimeTypes: options?.allowedMimeTypes ?? null,
        createdAt: now, updatedAt: now,
      }
      store.buckets[name] = bucket
      store.objects[name] = []
      saveStore(storePath, store)
      const bucketDir = getBucketDir(dir, name)
      if (!fs.existsSync(bucketDir)) fs.mkdirSync(bucketDir, { recursive: true })
      return bucket
    },

    /** Get a bucket by name */
    get(name: string): Bucket | null {
      return loadStore(storePath).buckets[name] || null
    },

    /** List all buckets */
    list(): Bucket[] {
      return Object.values(loadStore(storePath).buckets)
    },

    /** Delete a bucket */
    delete(name: string, options?: { force?: boolean }): void {
      const store = loadStore(storePath)
      if (!store.buckets[name]) throw new Error(`Bucket "${name}" not found`)
      if (!options?.force && (store.objects[name]?.length ?? 0) > 0) {
        throw new Error(`Bucket "${name}" is not empty. Use { force: true } to delete anyway.`)
      }
      delete store.buckets[name]
      delete store.objects[name]
      saveStore(storePath, store)
      const bucketDir = getBucketDir(dir, name)
      if (fs.existsSync(bucketDir)) fs.rmSync(bucketDir, { recursive: true })
    },

    /** Update bucket settings */
    update(name: string, updates: { public?: boolean; fileSizeLimit?: number; allowedMimeTypes?: string[] }): Bucket {
      const store = loadStore(storePath)
      if (!store.buckets[name]) throw new Error(`Bucket "${name}" not found`)
      if (updates.public !== undefined) store.buckets[name].public = updates.public
      if (updates.fileSizeLimit !== undefined) store.buckets[name].fileSizeLimit = updates.fileSizeLimit
      if (updates.allowedMimeTypes !== undefined) store.buckets[name].allowedMimeTypes = updates.allowedMimeTypes
      store.buckets[name].updatedAt = new Date().toISOString()
      saveStore(storePath, store)
      return store.buckets[name]
    },

    /** Empty a bucket */
    empty(name: string): number {
      const store = loadStore(storePath)
      if (!store.buckets[name]) throw new Error(`Bucket "${name}" not found`)
      const count = store.objects[name]?.length ?? 0
      store.objects[name] = []
      saveStore(storePath, store)
      const bucketDir = getBucketDir(dir, name)
      if (fs.existsSync(bucketDir)) {
        fs.rmSync(bucketDir, { recursive: true })
        fs.mkdirSync(bucketDir, { recursive: true })
      }
      return count
    },

    /** Upload a file to a bucket */
    upload(bucketName: string, filePath: string, data: Buffer | string, options?: UploadToBucketOptions): StorageObject {
      const store = loadStore(storePath)
      const bucket = store.buckets[bucketName]
      if (!bucket) throw new Error(`Bucket "${bucketName}" not found`)

      const buffer = typeof data === 'string' ? Buffer.from(data) : data
      const mimeType = options?.contentType || getMimeType(filePath)

      // Validate file size
      if (bucket.fileSizeLimit && buffer.length > bucket.fileSizeLimit) {
        throw new Error(`File size ${buffer.length} exceeds bucket limit of ${bucket.fileSizeLimit} bytes`)
      }

      // Validate mime type
      if (bucket.allowedMimeTypes && !bucket.allowedMimeTypes.includes(mimeType)) {
        throw new Error(`MIME type "${mimeType}" not allowed in bucket "${bucketName}"`)
      }

      // Write file to disk
      const fullPath = path.join(getBucketDir(dir, bucketName), filePath)
      const fileDir = path.dirname(fullPath)
      if (!fs.existsSync(fileDir)) fs.mkdirSync(fileDir, { recursive: true })
      fs.writeFileSync(fullPath, buffer)

      const etag = crypto.createHash('md5').update(buffer).digest('hex')
      const now = new Date().toISOString()

      // Check for existing object (upsert)
      const existingIdx = (store.objects[bucketName] || []).findIndex(o => o.path === filePath)
      const obj: StorageObject = {
        id: existingIdx >= 0 ? store.objects[bucketName][existingIdx].id : crypto.randomUUID(),
        bucketId: bucket.id, name: path.basename(filePath),
        path: filePath, size: buffer.length, mimeType, etag,
        metadata: options?.metadata || {},
        createdAt: existingIdx >= 0 ? store.objects[bucketName][existingIdx].createdAt : now,
        updatedAt: now,
      }

      if (existingIdx >= 0) {
        store.objects[bucketName][existingIdx] = obj
      } else {
        if (!store.objects[bucketName]) store.objects[bucketName] = []
        store.objects[bucketName].push(obj)
      }
      saveStore(storePath, store)
      return obj
    },

    /** Download a file from a bucket */
    download(bucketName: string, filePath: string): { data: Buffer; mimeType: string; size: number } {
      const fullPath = path.join(getBucketDir(dir, bucketName), filePath)
      if (!fs.existsSync(fullPath)) throw new Error(`File "${filePath}" not found in bucket "${bucketName}"`)
      const data = fs.readFileSync(fullPath)
      return { data, mimeType: getMimeType(filePath), size: data.length }
    },

    /** Delete a file from a bucket */
    remove(bucketName: string, filePaths: string | string[]): number {
      const store = loadStore(storePath)
      const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
      let deleted = 0
      for (const fp of paths) {
        const fullPath = path.join(getBucketDir(dir, bucketName), fp)
        if (fs.existsSync(fullPath)) { fs.unlinkSync(fullPath); deleted++ }
        if (store.objects[bucketName]) {
          store.objects[bucketName] = store.objects[bucketName].filter(o => o.path !== fp)
        }
      }
      saveStore(storePath, store)
      return deleted
    },

    /** List objects in a bucket */
    listObjects(bucketName: string, options?: ListObjectsOptions): ListObjectsResult {
      const store = loadStore(storePath)
      let objects = store.objects[bucketName] || []
      if (options?.prefix) objects = objects.filter(o => o.path.startsWith(options.prefix!))
      if (options?.search) {
        const term = options.search.toLowerCase()
        objects = objects.filter(o => o.name.toLowerCase().includes(term) || o.path.toLowerCase().includes(term))
      }
      const total = objects.length
      if (options?.sortBy) {
        const col = options.sortBy.column
        const dir = options.sortBy.order === 'desc' ? -1 : 1
        objects.sort((a: any, b: any) => (a[col] > b[col] ? dir : -dir))
      }
      const offset = options?.offset ?? 0
      const limit = options?.limit ?? 100
      return { objects: objects.slice(offset, offset + limit), total }
    },

    /** Get a public URL for an object */
    getPublicUrl(bucketName: string, filePath: string): string {
      const store = loadStore(storePath)
      const bucket = store.buckets[bucketName]
      if (!bucket?.public) throw new Error(`Bucket "${bucketName}" is not public`)
      return `/storage/v1/object/public/${bucketName}/${filePath}`
    },

    /** Create a signed URL for temporary access */
    createSignedUrl(bucketName: string, filePath: string, options?: SignedUrlOptions): { signedUrl: string; token: string; expiresAt: Date } {
      const store = loadStore(storePath)
      if (!store.buckets[bucketName]) throw new Error(`Bucket "${bucketName}" not found`)
      const expiresIn = options?.expiresIn ?? 3600
      const expiresAt = new Date(Date.now() + expiresIn * 1000)
      const token = crypto.randomBytes(32).toString('base64url')
      store.signedUrls[token] = { objectPath: filePath, bucketId: bucketName, expiresAt: expiresAt.getTime() }
      saveStore(storePath, store)
      const url = `/storage/v1/object/sign/${bucketName}/${filePath}?token=${token}`
      return { signedUrl: url, token, expiresAt }
    },

    /** Verify a signed URL token */
    verifySignedUrl(token: string): { valid: boolean; bucketId?: string; objectPath?: string } {
      const store = loadStore(storePath)
      const entry = store.signedUrls[token]
      if (!entry) return { valid: false }
      if (Date.now() > entry.expiresAt) {
        delete store.signedUrls[token]
        saveStore(storePath, store)
        return { valid: false }
      }
      return { valid: true, bucketId: entry.bucketId, objectPath: entry.objectPath }
    },

    /** Move/rename a file within or between buckets */
    move(fromBucket: string, fromPath: string, toBucket: string, toPath: string): StorageObject {
      const { data, mimeType } = buckets.download(fromBucket, fromPath)
      buckets.remove(fromBucket, fromPath)
      return buckets.upload(toBucket, toPath, data, { contentType: mimeType })
    },

    /** Copy a file within or between buckets */
    copy(fromBucket: string, fromPath: string, toBucket: string, toPath: string): StorageObject {
      const { data, mimeType } = buckets.download(fromBucket, fromPath)
      return buckets.upload(toBucket, toPath, data, { contentType: mimeType })
    },

    /** Get object metadata */
    getObject(bucketName: string, filePath: string): StorageObject | null {
      const store = loadStore(storePath)
      return (store.objects[bucketName] || []).find(o => o.path === filePath) || null
    },

    /** Get bucket usage stats */
    getUsage(bucketName: string): { totalFiles: number; totalSize: number; averageSize: number } {
      const store = loadStore(storePath)
      const objects = store.objects[bucketName] || []
      const totalSize = objects.reduce((sum, o) => sum + o.size, 0)
      return {
        totalFiles: objects.length,
        totalSize,
        averageSize: objects.length > 0 ? Math.round(totalSize / objects.length) : 0,
      }
    },
  }

  return buckets
}
