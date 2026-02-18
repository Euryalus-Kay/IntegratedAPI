import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { getConfig } from '../config/index.js'
import type { StorageAdapter, UploadOptions, FileInfo, ListFilesOptions, ListFilesResult } from './types.js'
import { VibeKitError } from '../utils/errors.js'

function parseSizeToBytes(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i)
  if (!match) return Infinity
  const [, num, unit] = match
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }
  return parseFloat(num) * (multipliers[unit.toUpperCase()] || 1)
}

export function createLocalStorageAdapter(): StorageAdapter {
  const config = getConfig()
  const baseDir = config.storagePath
  const metaDir = path.join(config.dataDir, 'storage-meta')

  fs.mkdirSync(baseDir, { recursive: true })
  fs.mkdirSync(metaDir, { recursive: true })

  function getFilePath(filePath: string): string {
    return path.join(baseDir, filePath)
  }

  function getMetaPath(filePath: string): string {
    return path.join(metaDir, filePath.replace(/\//g, '__') + '.json')
  }

  const adapter: StorageAdapter = {
    async upload(data: Buffer | Uint8Array, options: UploadOptions): Promise<FileInfo> {
      if (options.maxSize) {
        const maxBytes = parseSizeToBytes(options.maxSize)
        if (data.length > maxBytes) {
          throw new VibeKitError(
            `File size ${data.length} exceeds maximum ${options.maxSize}`,
            'STORAGE_FILE_TOO_LARGE',
            413
          )
        }
      }

      const folder = options.folder || ''
      const filePath = folder ? `${folder}/${options.filename}` : options.filename
      const fullPath = getFilePath(filePath)

      fs.mkdirSync(path.dirname(fullPath), { recursive: true })
      fs.writeFileSync(fullPath, data)

      const info: FileInfo = {
        id: crypto.randomUUID(),
        path: filePath,
        url: `http://localhost:${config.port}/storage/${filePath}`,
        filename: options.filename,
        contentType: options.contentType || 'application/octet-stream',
        size: data.length,
        folder,
        bucket: options.bucket || 'default',
        public: options.public !== false,
        metadata: options.metadata || {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }

      fs.writeFileSync(getMetaPath(filePath), JSON.stringify(info, null, 2))

      return info
    },

    async delete(filePath: string): Promise<void> {
      const fullPath = getFilePath(filePath)
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath)
      }
      const metaPath = getMetaPath(filePath)
      if (fs.existsSync(metaPath)) {
        fs.unlinkSync(metaPath)
      }
    },

    async deleteMany(paths: string[]): Promise<void> {
      for (const p of paths) {
        await adapter.delete(p)
      }
    },

    async getInfo(filePath: string): Promise<FileInfo | null> {
      const metaPath = getMetaPath(filePath)
      if (!fs.existsSync(metaPath)) return null
      return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    },

    getUrl(filePath: string): string {
      return `http://localhost:${config.port}/storage/${filePath}`
    },

    async list(options: ListFilesOptions = {}): Promise<ListFilesResult> {
      const searchDir = options.folder ? path.join(baseDir, options.folder) : baseDir
      if (!fs.existsSync(searchDir)) return { files: [], cursor: null, hasMore: false }

      const allFiles: FileInfo[] = []
      const entries = fs.readdirSync(searchDir, { withFileTypes: true, recursive: true })

      for (const entry of entries) {
        if (entry.isFile()) {
          const relativePath = path.relative(baseDir, path.join(entry.parentPath || searchDir, entry.name))
          const meta = await adapter.getInfo(relativePath)
          if (meta) allFiles.push(meta)
        }
      }

      const limit = options.limit || 100
      const startIdx = options.cursor ? parseInt(options.cursor, 10) : 0
      const sliced = allFiles.slice(startIdx, startIdx + limit)

      return {
        files: sliced,
        cursor: startIdx + limit < allFiles.length ? String(startIdx + limit) : null,
        hasMore: startIdx + limit < allFiles.length,
      }
    },

    async exists(filePath: string): Promise<boolean> {
      return fs.existsSync(getFilePath(filePath))
    },
  }

  return adapter
}
