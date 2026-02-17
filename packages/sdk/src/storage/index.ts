import { getConfig, isLocal } from '../config/index.js'
import { createLocalStorageAdapter } from './local.js'
import type { StorageAdapter, UploadOptions, FileInfo, ListFilesOptions, ListFilesResult } from './types.js'

let _adapter: StorageAdapter | null = null

function getAdapter(): StorageAdapter {
  if (!_adapter) {
    if (isLocal()) {
      _adapter = createLocalStorageAdapter()
    } else {
      throw new Error('Production storage not yet implemented. Use vibekit dev for local development.')
    }
  }
  return _adapter
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
