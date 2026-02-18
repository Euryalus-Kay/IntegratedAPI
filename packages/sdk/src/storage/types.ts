// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Storage — Complete Type Definitions
// Replicates features from Supabase Storage, Vercel Blob, R2, and more
// ──────────────────────────────────────────────────────────────────────────────

// ── Core File Types ─────────────────────────────────────────────────────────

export interface UploadOptions {
  filename: string
  contentType?: string
  folder?: string
  bucket?: string
  public?: boolean
  maxSize?: string
  metadata?: Record<string, string>
  /** If set, validates against bucket's allowedTypes */
  allowedTypes?: string[]
  /** Cache-Control header for CDN */
  cacheControl?: string
  /** Whether to upsert (overwrite existing) */
  upsert?: boolean
}

export interface FileInfo {
  id: string
  path: string
  url: string
  filename: string
  contentType: string
  size: number
  folder: string
  bucket: string
  public: boolean
  metadata: Record<string, string>
  etag?: string
  cacheControl?: string
  createdAt: string
  updatedAt: string
}

export interface ListFilesOptions {
  folder?: string
  bucket?: string
  limit?: number
  cursor?: string
  prefix?: string
  sortBy?: { column: 'name' | 'created_at' | 'updated_at' | 'size'; order: 'asc' | 'desc' }
  search?: string
}

export interface ListFilesResult {
  files: FileInfo[]
  cursor: string | null
  hasMore: boolean
}

export interface UploadUrlResult {
  uploadUrl: string
  publicUrl: string
  expiresAt: Date
}

// ── Bucket Types ────────────────────────────────────────────────────────────

export interface BucketConfig {
  id: string
  name: string
  public: boolean
  fileSizeLimit: number | null
  allowedMimeTypes: string[] | null
  createdAt: string
  updatedAt: string
  owner?: string
}

export interface CreateBucketOptions {
  /** Whether files are publicly accessible by default */
  public?: boolean
  /** Maximum file size in bytes */
  fileSizeLimit?: number
  /** Allowed MIME types, e.g. ['image/png', 'image/jpeg'] */
  allowedTypes?: string[]
}

export interface UpdateBucketOptions {
  public?: boolean
  fileSizeLimit?: number | null
  allowedTypes?: string[] | null
}

// ── Signed URL Types ────────────────────────────────────────────────────────

export interface CreateSignedUrlOptions {
  /** Expiration time in seconds (default: 3600 = 1 hour) */
  expiresIn?: number
  /** Transform options to apply */
  transform?: ImageTransformOptions
  /** Download disposition */
  download?: boolean | string
}

export interface CreateSignedUploadUrlOptions {
  /** Expiration time in seconds (default: 3600 = 1 hour) */
  expiresIn?: number
  /** Allowed content types for the upload */
  allowedContentTypes?: string[]
  /** Maximum file size for the upload */
  maxSize?: number
}

export interface SignedUrl {
  url: string
  path: string
  token: string
  expiresAt: string
}

export interface SignedUploadUrl {
  url: string
  path: string
  token: string
  expiresAt: string
}

export interface SignedUrlVerification {
  valid: boolean
  expired: boolean
  path: string | null
  expiresAt: string | null
}

// ── Image Transform Types ───────────────────────────────────────────────────

export type ResizeMode = 'cover' | 'contain' | 'fill'
export type ImageFormat = 'webp' | 'jpeg' | 'png' | 'avif' | 'gif'

export interface ImageTransformOptions {
  /** Width in pixels */
  width?: number
  /** Height in pixels */
  height?: number
  /** Quality 1-100 (default: 80) */
  quality?: number
  /** Output format */
  format?: ImageFormat
  /** Resize mode */
  resize?: ResizeMode
  /** Rotation in degrees (0, 90, 180, 270) */
  rotate?: 0 | 90 | 180 | 270
  /** Blur amount 0-100 */
  blur?: number
}

export interface TransformResult {
  url: string
  path: string
  transform: ImageTransformOptions
}

export interface PublicUrlOptions {
  transform?: ImageTransformOptions
  download?: boolean | string
}

// ── Resumable Upload Types ──────────────────────────────────────────────────

export type UploadSessionStatus = 'active' | 'completed' | 'aborted' | 'expired'

export interface CreateUploadSessionOptions {
  /** Target file path */
  path: string
  /** Bucket name */
  bucket?: string
  /** Content type of the file */
  contentType?: string
  /** Total file size in bytes (if known) */
  totalSize?: number
  /** Custom metadata */
  metadata?: Record<string, string>
  /** Session expiration in seconds (default: 86400 = 24h) */
  expiresIn?: number
  /** Chunk size in bytes (default: 5MB) */
  chunkSize?: number
}

export interface UploadSession {
  uploadId: string
  path: string
  bucket: string
  contentType: string
  totalSize: number | null
  uploadedSize: number
  chunkSize: number
  chunks: UploadChunkInfo[]
  status: UploadSessionStatus
  metadata: Record<string, string>
  createdAt: string
  expiresAt: string
}

export interface UploadChunkInfo {
  offset: number
  size: number
  etag: string
  uploadedAt: string
}

export interface UploadChunkOptions {
  offset: number
}

export interface UploadProgress {
  uploadId: string
  status: UploadSessionStatus
  totalSize: number | null
  uploadedSize: number
  progress: number
  chunksUploaded: number
  remainingSize: number | null
}

// ── Storage Policy Types ────────────────────────────────────────────────────

export type StoragePolicyOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

export interface StoragePolicyDefinition {
  /** Policy name */
  name: string
  /** Operation this policy applies to */
  operation: StoragePolicyOperation
  /** Check expression as serialized string */
  check: string
}

export interface StoragePolicy {
  id: string
  bucket: string
  name: string
  operation: StoragePolicyOperation
  check: string
  createdAt: string
}

// ── Enhanced File Operations ────────────────────────────────────────────────

export interface CopyFileOptions {
  /** Destination bucket (defaults to source bucket) */
  destBucket?: string
}

export interface MoveFileOptions {
  /** Destination bucket (defaults to source bucket) */
  destBucket?: string
}

export interface FileMetadata {
  id: string
  path: string
  bucket: string
  contentType: string
  size: number
  etag: string
  cacheControl: string | null
  lastModified: string
  customMetadata: Record<string, string>
}

// ── Storage Adapter (Extended) ──────────────────────────────────────────────

export interface StorageAdapter {
  upload(data: Buffer | Uint8Array, options: UploadOptions): Promise<FileInfo>
  delete(path: string): Promise<void>
  deleteMany(paths: string[]): Promise<void>
  getInfo(path: string): Promise<FileInfo | null>
  getUrl(path: string): string
  list(options?: ListFilesOptions): Promise<ListFilesResult>
  exists(path: string): Promise<boolean>
  // Enhanced operations
  copy?(sourcePath: string, destPath: string, options?: CopyFileOptions): Promise<FileInfo>
  move?(sourcePath: string, destPath: string, options?: MoveFileOptions): Promise<FileInfo>
  download?(path: string): Promise<Buffer>
  getMetadata?(path: string): Promise<FileMetadata | null>
  updateMetadata?(path: string, metadata: Record<string, string>): Promise<FileMetadata>
}

// ── MIME Type Mapping ───────────────────────────────────────────────────────

export const MIME_TYPES: Record<string, string> = {
  // Images
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  // Documents
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // Text
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.md': 'text/markdown',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  // Audio
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  // Video
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.wmv': 'video/x-ms-wmv',
  // Archives
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  // Fonts
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  // Other
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
}

/**
 * Get MIME type from file extension.
 */
export function getMimeTypeFromExtension(filename: string): string {
  const ext = filename.lastIndexOf('.') >= 0
    ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
    : ''
  return MIME_TYPES[ext] || 'application/octet-stream'
}
