import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createLocalStorageAdapter } from '../src/storage/local.js'
import type { StorageAdapter, FileInfo } from '../src/storage/types.js'

// ─────────────────────────────────────────────────────────────────────────────
// Mock config before importing storage
// ─────────────────────────────────────────────────────────────────────────────

let tmpDir: string
let storageDir: string
let metaDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibekit-storage-test-'))
  storageDir = path.join(tmpDir, 'storage')
  metaDir = path.join(tmpDir, 'storage-meta')

  vi.doMock('../src/config/index.js', () => ({
    getConfig: () => ({
      storagePath: storageDir,
      dataDir: tmpDir,
      port: 3456,
    }),
    isLocal: () => true,
  }))
})

afterEach(() => {
  vi.restoreAllMocks()
  // Clean up temp files
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch {
    // ignore cleanup errors
  }
})

async function getAdapter(): Promise<StorageAdapter> {
  const { createLocalStorageAdapter: create } = await import('../src/storage/local.js')
  return create()
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - upload', () => {
  it('uploads a file and returns FileInfo', async () => {
    const adapter = await getAdapter()
    const data = Buffer.from('hello world')
    const info = await adapter.upload(data, {
      filename: 'test.txt',
      contentType: 'text/plain',
    })

    expect(info.filename).toBe('test.txt')
    expect(info.contentType).toBe('text/plain')
    expect(info.size).toBe(11)
    expect(info.path).toBe('test.txt')
    expect(info.id).toBeTruthy()
    expect(info.url).toContain('test.txt')
    expect(info.createdAt).toBeTruthy()
    expect(info.updatedAt).toBeTruthy()
  })

  it('uploads to a folder', async () => {
    const adapter = await getAdapter()
    const data = Buffer.from('photo data')
    const info = await adapter.upload(data, {
      filename: 'photo.jpg',
      folder: 'images',
      contentType: 'image/jpeg',
    })

    expect(info.path).toBe('images/photo.jpg')
    expect(info.folder).toBe('images')
    expect(info.url).toContain('images/photo.jpg')
  })

  it('writes the file to disk', async () => {
    const adapter = await getAdapter()
    const content = 'file content here'
    const data = Buffer.from(content)
    await adapter.upload(data, { filename: 'disk.txt' })

    const filePath = path.join(storageDir, 'disk.txt')
    expect(fs.existsSync(filePath)).toBe(true)
    expect(fs.readFileSync(filePath, 'utf-8')).toBe(content)
  })

  it('defaults contentType to application/octet-stream', async () => {
    const adapter = await getAdapter()
    const info = await adapter.upload(Buffer.from('binary'), {
      filename: 'data.bin',
    })
    expect(info.contentType).toBe('application/octet-stream')
  })

  it('defaults public to true', async () => {
    const adapter = await getAdapter()
    const info = await adapter.upload(Buffer.from('data'), {
      filename: 'pub.txt',
    })
    expect(info.public).toBe(true)
  })

  it('respects public=false', async () => {
    const adapter = await getAdapter()
    const info = await adapter.upload(Buffer.from('data'), {
      filename: 'priv.txt',
      public: false,
    })
    expect(info.public).toBe(false)
  })

  it('stores metadata', async () => {
    const adapter = await getAdapter()
    const info = await adapter.upload(Buffer.from('data'), {
      filename: 'meta.txt',
      metadata: { userId: '123', category: 'docs' },
    })
    expect(info.metadata).toEqual({ userId: '123', category: 'docs' })
  })

  it('accepts Uint8Array data', async () => {
    const adapter = await getAdapter()
    const data = new Uint8Array([72, 101, 108, 108, 111])
    const info = await adapter.upload(data, { filename: 'uint8.txt' })
    expect(info.size).toBe(5)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Size validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - size validation', () => {
  it('rejects files exceeding maxSize', async () => {
    const adapter = await getAdapter()
    const data = Buffer.alloc(2 * 1024) // 2KB

    await expect(
      adapter.upload(data, {
        filename: 'big.bin',
        maxSize: '1KB',
      }),
    ).rejects.toThrow(/exceeds maximum/)
  })

  it('allows files within maxSize', async () => {
    const adapter = await getAdapter()
    const data = Buffer.alloc(500) // 500 bytes

    const info = await adapter.upload(data, {
      filename: 'small.bin',
      maxSize: '1KB',
    })
    expect(info.size).toBe(500)
  })

  it('validates maxSize with MB unit', async () => {
    const adapter = await getAdapter()
    const data = Buffer.alloc(100) // 100 bytes, well under 1MB

    const info = await adapter.upload(data, {
      filename: 'tiny.bin',
      maxSize: '1MB',
    })
    expect(info.size).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// File info
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - getInfo', () => {
  it('returns file info for an existing file', async () => {
    const adapter = await getAdapter()
    await adapter.upload(Buffer.from('test'), { filename: 'info.txt' })

    const info = await adapter.getInfo('info.txt')
    expect(info).not.toBeNull()
    expect(info!.filename).toBe('info.txt')
    expect(info!.size).toBe(4)
  })

  it('returns null for a non-existent file', async () => {
    const adapter = await getAdapter()
    const info = await adapter.getInfo('nonexistent.txt')
    expect(info).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// File existence
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - exists', () => {
  it('returns true for an existing file', async () => {
    const adapter = await getAdapter()
    await adapter.upload(Buffer.from('data'), { filename: 'exists.txt' })

    expect(await adapter.exists('exists.txt')).toBe(true)
  })

  it('returns false for a non-existent file', async () => {
    const adapter = await getAdapter()
    expect(await adapter.exists('nope.txt')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Delete
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - delete', () => {
  it('deletes a file and its metadata', async () => {
    const adapter = await getAdapter()
    await adapter.upload(Buffer.from('to delete'), { filename: 'del.txt' })

    expect(await adapter.exists('del.txt')).toBe(true)

    await adapter.delete('del.txt')

    expect(await adapter.exists('del.txt')).toBe(false)
    expect(await adapter.getInfo('del.txt')).toBeNull()
  })

  it('does not throw when deleting a non-existent file', async () => {
    const adapter = await getAdapter()
    await expect(adapter.delete('ghost.txt')).resolves.not.toThrow()
  })

  it('deleteMany removes multiple files', async () => {
    const adapter = await getAdapter()
    await adapter.upload(Buffer.from('a'), { filename: 'a.txt' })
    await adapter.upload(Buffer.from('b'), { filename: 'b.txt' })
    await adapter.upload(Buffer.from('c'), { filename: 'c.txt' })

    await adapter.deleteMany(['a.txt', 'b.txt'])

    expect(await adapter.exists('a.txt')).toBe(false)
    expect(await adapter.exists('b.txt')).toBe(false)
    expect(await adapter.exists('c.txt')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// List
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - list', () => {
  it('lists uploaded files', async () => {
    const adapter = await getAdapter()
    await adapter.upload(Buffer.from('1'), { filename: 'file1.txt' })
    await adapter.upload(Buffer.from('2'), { filename: 'file2.txt' })

    const result = await adapter.list()
    expect(result.files.length).toBeGreaterThanOrEqual(2)
    const filenames = result.files.map(f => f.filename)
    expect(filenames).toContain('file1.txt')
    expect(filenames).toContain('file2.txt')
  })

  it('returns empty list when no files exist', async () => {
    const adapter = await getAdapter()
    const result = await adapter.list()
    expect(result.files).toHaveLength(0)
    expect(result.hasMore).toBe(false)
    expect(result.cursor).toBeNull()
  })

  it('supports pagination with limit', async () => {
    const adapter = await getAdapter()
    for (let i = 0; i < 5; i++) {
      await adapter.upload(Buffer.from(`content-${i}`), { filename: `page-${i}.txt` })
    }

    const result = await adapter.list({ limit: 3 })
    expect(result.files).toHaveLength(3)
    expect(result.hasMore).toBe(true)
    expect(result.cursor).not.toBeNull()
  })

  it('supports pagination with cursor', async () => {
    const adapter = await getAdapter()
    for (let i = 0; i < 5; i++) {
      await adapter.upload(Buffer.from(`content-${i}`), { filename: `cursor-${i}.txt` })
    }

    const page1 = await adapter.list({ limit: 3 })
    expect(page1.files).toHaveLength(3)
    expect(page1.cursor).not.toBeNull()

    const page2 = await adapter.list({ limit: 3, cursor: page1.cursor! })
    expect(page2.files).toHaveLength(2)
    expect(page2.hasMore).toBe(false)
  })

  it('lists files in a specific folder', async () => {
    const adapter = await getAdapter()
    await adapter.upload(Buffer.from('a'), { filename: 'a.txt', folder: 'docs' })
    await adapter.upload(Buffer.from('b'), { filename: 'b.txt', folder: 'images' })

    const result = await adapter.list({ folder: 'docs' })
    expect(result.files).toHaveLength(1)
    expect(result.files[0].filename).toBe('a.txt')
  })

  it('returns empty when folder does not exist', async () => {
    const adapter = await getAdapter()
    const result = await adapter.list({ folder: 'nonexistent' })
    expect(result.files).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// URL generation
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - getUrl', () => {
  it('generates a URL for a file', async () => {
    const adapter = await getAdapter()
    const url = adapter.getUrl('test/file.txt')
    expect(url).toBe('http://localhost:3456/storage/test/file.txt')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Path handling
// ─────────────────────────────────────────────────────────────────────────────

describe('Local Storage - path handling', () => {
  it('handles nested folder paths', async () => {
    const adapter = await getAdapter()
    const info = await adapter.upload(Buffer.from('nested'), {
      filename: 'deep.txt',
      folder: 'a/b/c',
    })
    expect(info.path).toBe('a/b/c/deep.txt')
    expect(await adapter.exists('a/b/c/deep.txt')).toBe(true)
  })

  it('handles filenames with special characters', async () => {
    const adapter = await getAdapter()
    const info = await adapter.upload(Buffer.from('data'), {
      filename: 'my file (1).txt',
    })
    expect(info.filename).toBe('my file (1).txt')
    expect(await adapter.exists('my file (1).txt')).toBe(true)
  })
})
