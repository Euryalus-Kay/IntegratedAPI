import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Storage — Resumable Uploads (TUS Protocol)
// Implements chunked, resumable file uploads with offset tracking,
// expiry management, and automatic chunk assembly on completion.
// Replaces: Supabase TUS uploads, AWS S3 multipart, tus.io protocol
// ──────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export type ResumableUploadStatus = 'uploading' | 'completed' | 'cancelled' | 'expired'

export interface ResumableUploadConfig {
  /** Base directory for storing upload state and chunks */
  dataDir?: string
  /** Storage directory where completed files are assembled */
  storageDir?: string
  /** Default expiry for incomplete uploads in seconds (default: 86400 = 24h) */
  defaultExpiresIn?: number
  /** Maximum upload size in bytes (default: 5GB) */
  maxUploadSize?: number
  /** Default chunk size in bytes (default: 5MB) */
  defaultChunkSize?: number
  /** Base URL for generating upload URLs */
  baseUrl?: string
}

export interface CreateUploadOptions {
  /** Original filename */
  filename: string
  /** MIME content type */
  contentType: string
  /** Total file size in bytes */
  totalSize: number
  /** Target storage bucket */
  bucket?: string
  /** Custom metadata key-value pairs */
  metadata?: Record<string, string>
  /** Upload expiry in seconds (default: config.defaultExpiresIn) */
  expiresIn?: number
}

export interface ResumableUploadState {
  uploadId: string
  filename: string
  contentType: string
  totalSize: number
  bytesUploaded: number
  bucket: string
  metadata: Record<string, string>
  status: ResumableUploadStatus
  createdAt: string
  lastChunkAt: string | null
  expiresAt: string
  uploadUrl: string
  /** TUS protocol headers */
  tusHeaders: {
    uploadOffset: number
    uploadLength: number
    uploadMetadata: string
  }
}

export interface UploadStatusResult {
  uploadId: string
  status: ResumableUploadStatus
  bytesUploaded: number
  totalSize: number
  percentage: number
  createdAt: string
  lastChunkAt: string | null
  expiresAt: string
}

export interface UploadChunkResult {
  uploadId: string
  offset: number
  bytesWritten: number
  bytesUploaded: number
  totalSize: number
  percentage: number
}

export interface CompleteUploadResult {
  uploadId: string
  filename: string
  bucket: string
  contentType: string
  size: number
  path: string
  etag: string
  completedAt: string
}

export interface ListUploadsOptions {
  /** Filter by status */
  status?: ResumableUploadStatus
  /** Filter by bucket */
  bucket?: string
  /** Maximum results to return */
  limit?: number
  /** Offset for pagination */
  offset?: number
}

export interface ResumeUploadInfo {
  uploadId: string
  uploadUrl: string
  bytesUploaded: number
  totalSize: number
  remainingBytes: number
  tusHeaders: {
    uploadOffset: number
    uploadLength: number
    uploadMetadata: string
  }
}

// ── Internal Store ───────────────────────────────────────────────────────────

interface UploadStore {
  uploads: Record<string, ResumableUploadState>
}

function getStorePath(dataDir: string): string {
  return path.join(dataDir, '_vibekit_uploads.json')
}

function getChunksDir(dataDir: string, uploadId: string): string {
  return path.join(dataDir, '_vibekit_upload_chunks', uploadId)
}

function loadStore(storePath: string): UploadStore {
  if (!fs.existsSync(storePath)) return { uploads: {} }
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'))
  } catch {
    return { uploads: {} }
  }
}

function saveStore(storePath: string, store: UploadStore): void {
  const dir = path.dirname(storePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2))
}

function encodeTusMetadata(metadata: Record<string, string>): string {
  return Object.entries(metadata)
    .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
    .join(',')
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createResumableUploadManager(config?: ResumableUploadConfig) {
  const dataDir = config?.dataDir || path.join(process.cwd(), '.vibekit')
  const storageDir = config?.storageDir || path.join(dataDir, 'storage')
  const defaultExpiresIn = config?.defaultExpiresIn || 86400
  const maxUploadSize = config?.maxUploadSize || 5 * 1024 * 1024 * 1024
  const defaultChunkSize = config?.defaultChunkSize || 5 * 1024 * 1024
  const baseUrl = config?.baseUrl || 'http://localhost:3000'
  const storePath = getStorePath(dataDir)

  /** Create a new resumable upload session, returning upload URL and ID */
  function createUpload(options: CreateUploadOptions): ResumableUploadState {
    if (options.totalSize > maxUploadSize) {
      throw new Error(
        `Upload size ${options.totalSize} exceeds maximum allowed size of ${maxUploadSize} bytes`
      )
    }

    if (!options.filename || !options.contentType || !options.totalSize) {
      throw new Error('filename, contentType, and totalSize are required to create an upload')
    }

    const store = loadStore(storePath)
    const uploadId = crypto.randomUUID()
    const now = new Date()
    const expiresIn = options.expiresIn || defaultExpiresIn
    const expiresAt = new Date(now.getTime() + expiresIn * 1000)
    const bucket = options.bucket || 'default'
    const metadata = options.metadata || {}

    const tusMetadata: Record<string, string> = {
      filename: options.filename,
      contentType: options.contentType,
      ...metadata,
    }

    const uploadUrl = `${baseUrl}/storage/v1/upload/resumable/${uploadId}`

    const state: ResumableUploadState = {
      uploadId,
      filename: options.filename,
      contentType: options.contentType,
      totalSize: options.totalSize,
      bytesUploaded: 0,
      bucket,
      metadata,
      status: 'uploading',
      createdAt: now.toISOString(),
      lastChunkAt: null,
      expiresAt: expiresAt.toISOString(),
      uploadUrl,
      tusHeaders: {
        uploadOffset: 0,
        uploadLength: options.totalSize,
        uploadMetadata: encodeTusMetadata(tusMetadata),
      },
    }

    // Create chunks directory
    const chunksDir = getChunksDir(dataDir, uploadId)
    if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true })

    store.uploads[uploadId] = state
    saveStore(storePath, store)

    return state
  }

  /** Upload a chunk of data at a given byte offset */
  function uploadChunk(
    uploadId: string,
    chunk: Buffer | Uint8Array,
    offset: number
  ): UploadChunkResult {
    const store = loadStore(storePath)
    const upload = store.uploads[uploadId]

    if (!upload) {
      throw new Error(`Upload "${uploadId}" not found`)
    }

    if (upload.status !== 'uploading') {
      throw new Error(`Upload "${uploadId}" is in "${upload.status}" state and cannot accept chunks`)
    }

    // Check expiry
    if (new Date(upload.expiresAt).getTime() < Date.now()) {
      upload.status = 'expired'
      saveStore(storePath, store)
      throw new Error(`Upload "${uploadId}" has expired`)
    }

    // Validate offset matches current upload position (TUS requirement)
    if (offset !== upload.bytesUploaded) {
      throw new Error(
        `Offset mismatch: expected ${upload.bytesUploaded}, received ${offset}. ` +
        `Use getUploadStatus() to get the current offset before uploading.`
      )
    }

    // Validate chunk does not exceed total size
    if (offset + chunk.length > upload.totalSize) {
      throw new Error(
        `Chunk at offset ${offset} with size ${chunk.length} would exceed total upload size of ${upload.totalSize}`
      )
    }

    // Write chunk to disk
    const chunksDir = getChunksDir(dataDir, uploadId)
    if (!fs.existsSync(chunksDir)) fs.mkdirSync(chunksDir, { recursive: true })
    const chunkPath = path.join(chunksDir, `chunk_${String(offset).padStart(16, '0')}`)
    fs.writeFileSync(chunkPath, chunk)

    // Update state
    const now = new Date().toISOString()
    upload.bytesUploaded += chunk.length
    upload.lastChunkAt = now
    upload.tusHeaders.uploadOffset = upload.bytesUploaded

    saveStore(storePath, store)

    return {
      uploadId,
      offset,
      bytesWritten: chunk.length,
      bytesUploaded: upload.bytesUploaded,
      totalSize: upload.totalSize,
      percentage: Math.round((upload.bytesUploaded / upload.totalSize) * 10000) / 100,
    }
  }

  /** Get the current status and progress of an upload */
  function getUploadStatus(uploadId: string): UploadStatusResult {
    const store = loadStore(storePath)
    const upload = store.uploads[uploadId]

    if (!upload) {
      throw new Error(`Upload "${uploadId}" not found`)
    }

    // Check and update expiry
    if (
      upload.status === 'uploading' &&
      new Date(upload.expiresAt).getTime() < Date.now()
    ) {
      upload.status = 'expired'
      saveStore(storePath, store)
    }

    return {
      uploadId: upload.uploadId,
      status: upload.status,
      bytesUploaded: upload.bytesUploaded,
      totalSize: upload.totalSize,
      percentage: upload.totalSize > 0
        ? Math.round((upload.bytesUploaded / upload.totalSize) * 10000) / 100
        : 0,
      createdAt: upload.createdAt,
      lastChunkAt: upload.lastChunkAt,
      expiresAt: upload.expiresAt,
    }
  }

  /** Finalize an upload: assemble chunks into the final file */
  function completeUpload(uploadId: string): CompleteUploadResult {
    const store = loadStore(storePath)
    const upload = store.uploads[uploadId]

    if (!upload) {
      throw new Error(`Upload "${uploadId}" not found`)
    }

    if (upload.status !== 'uploading') {
      throw new Error(`Upload "${uploadId}" is in "${upload.status}" state and cannot be completed`)
    }

    if (upload.bytesUploaded !== upload.totalSize) {
      throw new Error(
        `Upload "${uploadId}" is incomplete: ${upload.bytesUploaded}/${upload.totalSize} bytes uploaded`
      )
    }

    // Assemble chunks in order
    const chunksDir = getChunksDir(dataDir, uploadId)
    const chunkFiles = fs.readdirSync(chunksDir).sort()
    const hash = crypto.createHash('md5')
    const assembledChunks: Buffer[] = []

    for (const chunkFile of chunkFiles) {
      const chunkData = fs.readFileSync(path.join(chunksDir, chunkFile))
      assembledChunks.push(chunkData)
      hash.update(chunkData)
    }

    const assembledBuffer = Buffer.concat(assembledChunks)
    const etag = hash.digest('hex')

    // Write final file to storage
    const bucketDir = path.join(storageDir, upload.bucket)
    if (!fs.existsSync(bucketDir)) fs.mkdirSync(bucketDir, { recursive: true })

    const destPath = path.join(bucketDir, upload.filename)
    const destDir = path.dirname(destPath)
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    fs.writeFileSync(destPath, assembledBuffer)

    // Cleanup chunks
    fs.rmSync(chunksDir, { recursive: true, force: true })

    // Update state
    const now = new Date().toISOString()
    upload.status = 'completed'
    upload.lastChunkAt = now
    saveStore(storePath, store)

    return {
      uploadId,
      filename: upload.filename,
      bucket: upload.bucket,
      contentType: upload.contentType,
      size: assembledBuffer.length,
      path: `${upload.bucket}/${upload.filename}`,
      etag,
      completedAt: now,
    }
  }

  /** Cancel an in-progress upload and clean up all partial data */
  function cancelUpload(uploadId: string): void {
    const store = loadStore(storePath)
    const upload = store.uploads[uploadId]

    if (!upload) {
      throw new Error(`Upload "${uploadId}" not found`)
    }

    if (upload.status === 'completed') {
      throw new Error(`Upload "${uploadId}" is already completed and cannot be cancelled`)
    }

    // Remove chunk files
    const chunksDir = getChunksDir(dataDir, uploadId)
    if (fs.existsSync(chunksDir)) {
      fs.rmSync(chunksDir, { recursive: true, force: true })
    }

    upload.status = 'cancelled'
    saveStore(storePath, store)
  }

  /** List uploads, optionally filtered by status and/or bucket */
  function listUploads(options?: ListUploadsOptions): {
    uploads: ResumableUploadState[]
    total: number
  } {
    const store = loadStore(storePath)
    let uploads = Object.values(store.uploads)

    // Check and update expired uploads
    const now = Date.now()
    let storeChanged = false
    for (const upload of uploads) {
      if (upload.status === 'uploading' && new Date(upload.expiresAt).getTime() < now) {
        upload.status = 'expired'
        storeChanged = true
      }
    }
    if (storeChanged) saveStore(storePath, store)

    // Apply filters
    if (options?.status) {
      uploads = uploads.filter(u => u.status === options.status)
    }
    if (options?.bucket) {
      uploads = uploads.filter(u => u.bucket === options.bucket)
    }

    // Sort by creation date descending
    uploads.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const total = uploads.length
    const offset = options?.offset || 0
    const limit = options?.limit || 100
    const sliced = uploads.slice(offset, offset + limit)

    return { uploads: sliced, total }
  }

  /** Remove all expired incomplete uploads and their chunk data */
  function cleanupExpired(): { removed: number; bytesFreed: number } {
    const store = loadStore(storePath)
    const now = Date.now()
    let removed = 0
    let bytesFreed = 0

    const uploadIds = Object.keys(store.uploads)
    for (const uploadId of uploadIds) {
      const upload = store.uploads[uploadId]

      const isExpired =
        upload.status === 'expired' ||
        (upload.status === 'uploading' && new Date(upload.expiresAt).getTime() < now)

      const isCancelled = upload.status === 'cancelled'

      if (isExpired || isCancelled) {
        // Calculate bytes to be freed from chunk files
        const chunksDir = getChunksDir(dataDir, uploadId)
        if (fs.existsSync(chunksDir)) {
          const chunkFiles = fs.readdirSync(chunksDir)
          for (const chunkFile of chunkFiles) {
            const chunkPath = path.join(chunksDir, chunkFile)
            const stat = fs.statSync(chunkPath)
            bytesFreed += stat.size
          }
          fs.rmSync(chunksDir, { recursive: true, force: true })
        }

        delete store.uploads[uploadId]
        removed++
      }
    }

    saveStore(storePath, store)
    return { removed, bytesFreed }
  }

  /** Get information needed to resume a previously started upload */
  function resumeUpload(uploadId: string): ResumeUploadInfo {
    const store = loadStore(storePath)
    const upload = store.uploads[uploadId]

    if (!upload) {
      throw new Error(`Upload "${uploadId}" not found`)
    }

    if (upload.status !== 'uploading') {
      throw new Error(
        `Upload "${uploadId}" is in "${upload.status}" state and cannot be resumed`
      )
    }

    // Check expiry
    if (new Date(upload.expiresAt).getTime() < Date.now()) {
      upload.status = 'expired'
      saveStore(storePath, store)
      throw new Error(`Upload "${uploadId}" has expired and cannot be resumed`)
    }

    return {
      uploadId: upload.uploadId,
      uploadUrl: upload.uploadUrl,
      bytesUploaded: upload.bytesUploaded,
      totalSize: upload.totalSize,
      remainingBytes: upload.totalSize - upload.bytesUploaded,
      tusHeaders: {
        uploadOffset: upload.tusHeaders.uploadOffset,
        uploadLength: upload.tusHeaders.uploadLength,
        uploadMetadata: upload.tusHeaders.uploadMetadata,
      },
    }
  }

  return {
    createUpload,
    uploadChunk,
    getUploadStatus,
    completeUpload,
    cancelUpload,
    listUploads,
    cleanupExpired,
    resumeUpload,
  }
}
