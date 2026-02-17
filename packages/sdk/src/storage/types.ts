export interface UploadOptions {
  filename: string
  contentType?: string
  folder?: string
  public?: boolean
  maxSize?: string
  metadata?: Record<string, string>
}

export interface FileInfo {
  id: string
  path: string
  url: string
  filename: string
  contentType: string
  size: number
  folder: string
  public: boolean
  metadata: Record<string, string>
  createdAt: string
  updatedAt: string
}

export interface ListFilesOptions {
  folder?: string
  limit?: number
  cursor?: string
  prefix?: string
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

export interface StorageAdapter {
  upload(data: Buffer | Uint8Array, options: UploadOptions): Promise<FileInfo>
  delete(path: string): Promise<void>
  deleteMany(paths: string[]): Promise<void>
  getInfo(path: string): Promise<FileInfo | null>
  getUrl(path: string): string
  list(options?: ListFilesOptions): Promise<ListFilesResult>
  exists(path: string): Promise<boolean>
}
