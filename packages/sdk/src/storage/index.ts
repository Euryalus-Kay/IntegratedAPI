import { getConfig, isLocal } from '../config/index.js'
import { createLocalStorageAdapter } from './local.js'
import { createS3StorageAdapter, s3ConfigFromEnv, r2ConfigFromEnv } from './s3.js'
import type { StorageAdapter, UploadOptions, FileInfo, ListFilesOptions, ListFilesResult } from './types.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('vibekit:storage')

let _adapter: StorageAdapter | null = null

function getAdapter(): StorageAdapter {
  if (!_adapter) {
    if (isLocal()) {
      _adapter = createLocalStorageAdapter()
    } else {
      _adapter = resolveProductionAdapter()
    }
  }
  return _adapter
}

function resolveProductionAdapter(): StorageAdapter {
  const backend = process.env.STORAGE_BACKEND?.toLowerCase()

  // Explicit S3 backend or S3 env vars present
  if (backend === 's3' || process.env.S3_BUCKET) {
    const s3Config = s3ConfigFromEnv()
    if (s3Config) {
      log.info('Using S3 storage adapter', { bucket: s3Config.bucket, region: s3Config.region })
      return createS3StorageAdapter(s3Config)
    }
  }

  // Explicit R2 backend or R2 env vars present
  if (backend === 'r2' || process.env.R2_BUCKET) {
    const r2Config = r2ConfigFromEnv()
    if (r2Config) {
      log.info('Using R2 storage adapter', { bucket: r2Config.bucket, endpoint: r2Config.endpoint })
      return createS3StorageAdapter(r2Config)
    }
  }

  // Auto-detect: check for S3 env vars first, then R2
  const s3Config = s3ConfigFromEnv()
  if (s3Config) {
    log.info('Auto-detected S3 storage adapter', { bucket: s3Config.bucket })
    return createS3StorageAdapter(s3Config)
  }

  const r2Config = r2ConfigFromEnv()
  if (r2Config) {
    log.info('Auto-detected R2 storage adapter', { bucket: r2Config.bucket })
    return createS3StorageAdapter(r2Config)
  }

  // Fall back to local storage as default
  log.warn(
    'No production storage backend configured. Falling back to local file storage. ' +
    'Set S3_BUCKET, R2_BUCKET, or STORAGE_BACKEND to configure production storage.'
  )
  return createLocalStorageAdapter()
}

export const storage = {
  async upload(data: Buffer | Uint8Array, options: UploadOptions): Promise<FileInfo> {
    return getAdapter().upload(data, options)
  },

  async uploadFromRequest(request: any, options: { field?: string; folder?: string; maxSize?: string; allowedTypes?: string[] } = {}): Promise<FileInfo> {
    throw new Error('uploadFromRequest requires framework-specific implementation. Use upload() with a Buffer instead.')
  },

  getUrl(filePath: string): string {
    return getAdapter().getUrl(filePath)
  },

  async list(options?: ListFilesOptions): Promise<ListFilesResult> {
    return getAdapter().list(options)
  },

  async delete(filePath: string): Promise<void> {
    return getAdapter().delete(filePath)
  },

  async deleteMany(paths: string[]): Promise<void> {
    return getAdapter().deleteMany(paths)
  },

  async getInfo(filePath: string): Promise<FileInfo | null> {
    return getAdapter().getInfo(filePath)
  },

  async exists(filePath: string): Promise<boolean> {
    return getAdapter().exists(filePath)
  },
}

export type { StorageAdapter, UploadOptions, FileInfo, ListFilesOptions, ListFilesResult }

// S3-compatible adapter
export { createS3StorageAdapter, s3ConfigFromEnv, r2ConfigFromEnv } from './s3.js'
export type { S3AdapterConfig } from './s3.js'

// Advanced storage modules
export { createBucketManager } from './buckets.js'
export type {
  Bucket, StorageObject, UploadToBucketOptions,
  SignedUrlOptions, ImageTransformOptions,
  ListObjectsOptions, ListObjectsResult,
} from './buckets.js'

// Resumable uploads (TUS protocol)
export { createResumableUploadManager } from './resumable.js'
export type {
  ResumableUploadConfig, CreateUploadOptions, ResumableUploadState,
  ResumableUploadStatus, UploadStatusResult, UploadChunkResult,
  CompleteUploadResult, ListUploadsOptions, ResumeUploadInfo,
} from './resumable.js'

// Image transformation pipeline
export { createImageTransformer } from './transforms.js'
export type {
  ImageTransformerConfig, TransformOptions, ImageResizeMode, ImageOutputFormat,
  WatermarkPosition, ImageInfo, TransformResult, TransformUrlResult, BatchResult,
  SharpPlugin, SharpPipeline,
} from './transforms.js'

// CDN / Edge caching
export { createCdnManager } from './cdn.js'
export type {
  CdnConfig, CachePolicy, CacheHeaders, CdnStats,
  CustomDomain, PurgeResult, WarmCacheResult,
} from './cdn.js'
