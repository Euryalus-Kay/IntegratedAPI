// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Server — Storage Operation Routes
// ──────────────────────────────────────────────────────────────────────────────

import { Hono } from 'hono'
import { VibeKitError, ValidationError, ErrorCodes, createLogger } from 'vibekit'
import type { AppEnv } from '../types.js'

const log = createLogger('server:storage')

const storageRoutes = new Hono<AppEnv>()

// ──────────────────────────────────────────────────────────────────────────────
// In-memory file store (production would use R2/S3)
// ──────────────────────────────────────────────────────────────────────────────

interface StoredFile {
  key: string
  filename: string
  contentType: string
  size: number
  bucket: string
  url: string
  uploadedBy: string
  createdAt: string
  updatedAt: string
  metadata: Record<string, string>
}

const files = new Map<string, StoredFile>()

// Default limits
const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'application/pdf',
  'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
  'application/json', 'application/xml',
  'application/zip', 'application/gzip',
  'video/mp4', 'audio/mpeg', 'audio/wav',
]

// ──────────────────────────────────────────────────────────────────────────────
// Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/storage/upload — Upload a file.
 *
 * Accepts multipart/form-data with a `file` field, or JSON with base64 content.
 */
storageRoutes.post('/upload', async (c) => {
  const contentType = c.req.header('Content-Type') ?? ''

  let filename: string
  let fileContentType: string
  let size: number
  let fileKey: string

  if (contentType.includes('multipart/form-data')) {
    // Multipart upload
    const formData = await c.req.formData()
    const file = formData.get('file')

    if (!file || !(file instanceof File)) {
      throw new ValidationError('File is required', {
        code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
        fieldErrors: { file: 'A file must be provided in the "file" form field' },
      })
    }

    filename = file.name
    fileContentType = file.type || 'application/octet-stream'
    size = file.size

    // Validate file size
    if (size > MAX_FILE_SIZE) {
      throw new VibeKitError(`File too large: ${(size / 1024 / 1024).toFixed(1)} MB exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit`, {
        code: ErrorCodes.STORAGE_FILE_TOO_LARGE,
        statusCode: 413,
        context: { maxSize: MAX_FILE_SIZE, actualSize: size },
      })
    }

    // Validate content type
    if (ALLOWED_TYPES.length > 0 && !ALLOWED_TYPES.includes(fileContentType)) {
      throw new VibeKitError(`File type not allowed: ${fileContentType}`, {
        code: ErrorCodes.STORAGE_INVALID_TYPE,
        statusCode: 415,
        suggestion: `Allowed types: ${ALLOWED_TYPES.join(', ')}`,
      })
    }

    // Generate a unique key
    const ext = filename.split('.').pop() ?? ''
    fileKey = `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}.${ext}`

    // Custom path from form field
    const customPath = formData.get('path')
    if (customPath && typeof customPath === 'string') {
      fileKey = `${customPath.replace(/^\/|\/$/g, '')}/${fileKey}`
    }
  } else {
    // JSON upload with base64 content
    const body = await c.req.json<Record<string, unknown>>()

    if (!body.filename || typeof body.filename !== 'string') {
      throw new ValidationError('Filename is required', {
        code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
        fieldErrors: { filename: 'Filename is required for JSON upload' },
      })
    }

    if (!body.content || typeof body.content !== 'string') {
      throw new ValidationError('File content is required', {
        code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
        fieldErrors: { content: 'Base64-encoded file content is required' },
      })
    }

    filename = body.filename as string
    fileContentType = (body.contentType as string) ?? 'application/octet-stream'
    // Estimate base64 decoded size
    size = Math.ceil(((body.content as string).length * 3) / 4)

    if (size > MAX_FILE_SIZE) {
      throw new VibeKitError(`File too large: ${(size / 1024 / 1024).toFixed(1)} MB`, {
        code: ErrorCodes.STORAGE_FILE_TOO_LARGE,
        statusCode: 413,
      })
    }

    const ext = filename.split('.').pop() ?? ''
    fileKey = body.key
      ? String(body.key)
      : `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}.${ext}`
  }

  const bucket = process.env.VIBEKIT_STORAGE_BUCKET ?? 'vibekit-default'
  const baseUrl = process.env.VIBEKIT_STORAGE_URL ?? `https://${bucket}.storage.vibekit.dev`

  const stored: StoredFile = {
    key: fileKey,
    filename,
    contentType: fileContentType,
    size,
    bucket,
    url: `${baseUrl}/${fileKey}`,
    uploadedBy: c.get('projectId') ?? 'unknown',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    metadata: {},
  }

  files.set(fileKey, stored)

  log.info('File uploaded', { key: fileKey, filename, size, contentType: fileContentType })

  return c.json({ data: stored }, 201)
})

/**
 * GET /api/v1/storage/files — List all stored files.
 */
storageRoutes.get('/files', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)
  const prefix = c.req.query('prefix')

  let allFiles = Array.from(files.values())

  // Filter by prefix
  if (prefix) {
    allFiles = allFiles.filter((f) => f.key.startsWith(prefix))
  }

  // Sort by creation date descending
  allFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const paginated = allFiles.slice(offset, offset + limit)

  return c.json({
    data: paginated,
    total: allFiles.length,
    limit,
    offset,
  })
})

/**
 * GET /api/v1/storage/files/:key — Get file metadata by key.
 */
storageRoutes.get('/files/*', (c) => {
  // Extract the key from the URL (everything after /files/)
  const key = c.req.path.replace(/^.*\/files\//, '')

  if (!key) {
    throw new ValidationError('File key is required', {
      code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
      fieldErrors: { key: 'File key is required in the URL path' },
    })
  }

  const file = files.get(key)

  if (!file) {
    throw new VibeKitError(`File not found: ${key}`, {
      code: ErrorCodes.STORAGE_FILE_NOT_FOUND,
      statusCode: 404,
      suggestion: 'Verify the file key. Use GET /api/v1/storage/files to list all files.',
    })
  }

  return c.json({ data: file })
})

/**
 * DELETE /api/v1/storage/files/:key — Delete a file.
 */
storageRoutes.delete('/files/*', (c) => {
  const key = c.req.path.replace(/^.*\/files\//, '')

  if (!key) {
    throw new ValidationError('File key is required', {
      code: ErrorCodes.VALIDATION_REQUIRED_FIELD,
      fieldErrors: { key: 'File key is required in the URL path' },
    })
  }

  const file = files.get(key)

  if (!file) {
    throw new VibeKitError(`File not found: ${key}`, {
      code: ErrorCodes.STORAGE_FILE_NOT_FOUND,
      statusCode: 404,
    })
  }

  files.delete(key)

  log.info('File deleted', { key, filename: file.filename })

  return c.json({ data: { key, deleted: true } })
})

export { storageRoutes }
