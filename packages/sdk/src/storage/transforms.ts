import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Storage — Image Transformation Pipeline
// Provides image metadata detection, transform URL generation, caching,
// and a plugin interface for sharp-based processing when available.
// Replaces: Supabase Image Transforms, Cloudinary, Imgix
// ──────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export type ImageResizeMode = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'
export type ImageOutputFormat = 'webp' | 'png' | 'jpeg' | 'avif' | 'gif'
export type WatermarkPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'center-left' | 'center' | 'center-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export interface TransformOptions {
  /** Target width in pixels */
  width?: number
  /** Target height in pixels */
  height?: number
  /** Resize strategy */
  resize?: ImageResizeMode
  /** Output format */
  format?: ImageOutputFormat
  /** Quality 1-100 */
  quality?: number
  /** Rotation in degrees */
  rotate?: number
  /** Flip vertically */
  flip?: boolean
  /** Flip horizontally */
  flop?: boolean
  /** Blur radius (0 = none) */
  blur?: number
  /** Sharpen amount (0 = none) */
  sharpen?: number
  /** Convert to grayscale */
  grayscale?: boolean
  /** Color tint as hex string (e.g. '#FF0000') */
  tint?: string
  /** Crop region */
  crop?: { x: number; y: number; width: number; height: number }
  /** Watermark overlay */
  watermark?: {
    text?: string
    image?: string
    position: WatermarkPosition
    opacity: number
  }
}

export interface ImageInfo {
  width: number
  height: number
  format: string
  size: number
  hasAlpha: boolean
  channels: number
}

export interface TransformResult {
  data: Buffer
  info: ImageInfo
  format: string
  cacheKey: string
}

export interface TransformUrlResult {
  url: string
  queryParams: Record<string, string>
  cacheKey: string
}

export interface BatchResult {
  results: Array<{ input: string | Buffer; result?: TransformResult; error?: string }>
  totalProcessed: number
  totalErrors: number
}

export interface ImageTransformerConfig {
  /** Base URL for generating transform URLs */
  baseUrl?: string
  /** Cache directory for transformed images */
  cacheDir?: string
  /** Maximum cache size in bytes (default: 500MB) */
  maxCacheSize?: number
  /** Default quality if not specified in options */
  defaultQuality?: number
  /** Default output format if not specified */
  defaultFormat?: ImageOutputFormat
  /** Sharp module instance, if available */
  sharpInstance?: SharpPlugin
}

/** Plugin interface for sharp (or compatible) image processor */
export interface SharpPlugin {
  (input: Buffer | string): SharpPipeline
}

export interface SharpPipeline {
  resize(width?: number, height?: number, options?: { fit?: string }): SharpPipeline
  rotate(angle?: number): SharpPipeline
  flip(): SharpPipeline
  flop(): SharpPipeline
  blur(sigma?: number): SharpPipeline
  sharpen(sigma?: number): SharpPipeline
  grayscale(): SharpPipeline
  tint(rgb: { r: number; g: number; b: number }): SharpPipeline
  extract(region: { left: number; top: number; width: number; height: number }): SharpPipeline
  toFormat(format: string, options?: { quality?: number }): SharpPipeline
  composite(overlays: Array<{ input: Buffer | string; gravity?: string; blend?: string }>): SharpPipeline
  metadata(): Promise<{ width?: number; height?: number; format?: string; channels?: number; hasAlpha?: boolean; size?: number }>
  toBuffer(): Promise<Buffer>
}

// ── Image Header Parsing (no sharp needed) ───────────────────────────────────

interface ParsedImageHeader {
  width: number
  height: number
  format: string
  hasAlpha: boolean
  channels: number
}

function parsePngHeader(buf: Buffer): ParsedImageHeader | null {
  // PNG: 8-byte signature, then IHDR chunk at offset 8
  if (buf.length < 24) return null
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4E || buf[3] !== 0x47) return null
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  const colorType = buf[25]
  const hasAlpha = colorType === 4 || colorType === 6
  const channels = colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1
  return { width, height, format: 'png', hasAlpha, channels }
}

function parseJpegHeader(buf: Buffer): ParsedImageHeader | null {
  if (buf.length < 2 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null
  let offset = 2
  while (offset < buf.length - 1) {
    if (buf[offset] !== 0xFF) break
    const marker = buf[offset + 1]
    // SOF markers: 0xC0-0xCF except 0xC4, 0xC8, 0xCC
    if (
      marker >= 0xC0 && marker <= 0xCF &&
      marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    ) {
      if (offset + 9 > buf.length) break
      const height = buf.readUInt16BE(offset + 5)
      const width = buf.readUInt16BE(offset + 7)
      const components = buf[offset + 9]
      return { width, height, format: 'jpeg', hasAlpha: false, channels: components || 3 }
    }
    if (offset + 3 >= buf.length) break
    const segmentLength = buf.readUInt16BE(offset + 2)
    offset += 2 + segmentLength
  }
  return null
}

function parseGifHeader(buf: Buffer): ParsedImageHeader | null {
  if (buf.length < 10) return null
  const sig = buf.subarray(0, 3).toString('ascii')
  if (sig !== 'GIF') return null
  const width = buf.readUInt16LE(6)
  const height = buf.readUInt16LE(8)
  return { width, height, format: 'gif', hasAlpha: true, channels: 4 }
}

function parseWebpHeader(buf: Buffer): ParsedImageHeader | null {
  if (buf.length < 30) return null
  const riff = buf.subarray(0, 4).toString('ascii')
  const webp = buf.subarray(8, 12).toString('ascii')
  if (riff !== 'RIFF' || webp !== 'WEBP') return null
  const chunk = buf.subarray(12, 16).toString('ascii')
  if (chunk === 'VP8 ' && buf.length >= 30) {
    // Lossy WebP
    const width = buf.readUInt16LE(26) & 0x3FFF
    const height = buf.readUInt16LE(28) & 0x3FFF
    return { width, height, format: 'webp', hasAlpha: false, channels: 3 }
  }
  if (chunk === 'VP8L' && buf.length >= 25) {
    // Lossless WebP
    const bits = buf.readUInt32LE(21)
    const width = (bits & 0x3FFF) + 1
    const height = ((bits >> 14) & 0x3FFF) + 1
    return { width, height, format: 'webp', hasAlpha: true, channels: 4 }
  }
  if (chunk === 'VP8X' && buf.length >= 30) {
    // Extended WebP
    const width = ((buf[24] | (buf[25] << 8) | (buf[26] << 16)) & 0xFFFFFF) + 1
    const height = ((buf[27] | (buf[28] << 8) | (buf[29] << 16)) & 0xFFFFFF) + 1
    const hasAlpha = (buf[20] & 0x10) !== 0
    return { width, height, format: 'webp', hasAlpha, channels: hasAlpha ? 4 : 3 }
  }
  return { width: 0, height: 0, format: 'webp', hasAlpha: false, channels: 3 }
}

function parseBmpHeader(buf: Buffer): ParsedImageHeader | null {
  if (buf.length < 26 || buf[0] !== 0x42 || buf[1] !== 0x4D) return null
  const width = buf.readInt32LE(18)
  const height = Math.abs(buf.readInt32LE(22))
  return { width, height, format: 'bmp', hasAlpha: false, channels: 3 }
}

function parseImageHeaders(buf: Buffer): ParsedImageHeader | null {
  return (
    parsePngHeader(buf) ||
    parseJpegHeader(buf) ||
    parseGifHeader(buf) ||
    parseWebpHeader(buf) ||
    parseBmpHeader(buf)
  )
}

// ── Cache Helpers ────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

function getCachePath(cacheDir: string, cacheKey: string, format: string): string {
  return path.join(cacheDir, `${cacheKey}.${format}`)
}

function getDirectorySize(dir: string): number {
  if (!fs.existsSync(dir)) return 0
  let total = 0
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isFile()) {
      total += fs.statSync(fullPath).size
    } else if (entry.isDirectory()) {
      total += getDirectorySize(fullPath)
    }
  }
  return total
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) || 0
  const g = parseInt(clean.substring(2, 4), 16) || 0
  const b = parseInt(clean.substring(4, 6), 16) || 0
  return { r, g, b }
}

// ── Factory ──────────────────────────────────────────────────────────────────

export function createImageTransformer(config?: ImageTransformerConfig) {
  const baseUrl = config?.baseUrl || 'http://localhost:3000'
  const cacheDir = config?.cacheDir || path.join(process.cwd(), '.vibekit', '_image_cache')
  const maxCacheSize = config?.maxCacheSize || 500 * 1024 * 1024
  const defaultQuality = config?.defaultQuality || 80
  const defaultFormat = config?.defaultFormat || 'webp'
  const sharp = config?.sharpInstance || null

  ensureDir(cacheDir)

  /** Generate a deterministic cache key from transform options */
  function getCacheKey(options: TransformOptions): string {
    const normalized: Record<string, unknown> = {}
    const keys = Object.keys(options).sort()
    for (const key of keys) {
      const val = (options as Record<string, unknown>)[key]
      if (val !== undefined && val !== null && val !== false && val !== 0) {
        normalized[key] = val
      }
    }
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex')
      .substring(0, 16)
    return hash
  }

  /** Compute a full cache key including the input identifier */
  function computeFullCacheKey(inputIdentifier: string, options: TransformOptions): string {
    const optionsHash = getCacheKey(options)
    const inputHash = crypto.createHash('sha256')
      .update(inputIdentifier)
      .digest('hex')
      .substring(0, 16)
    return `${inputHash}_${optionsHash}`
  }

  /** Get image metadata (width, height, format, size) from a buffer */
  async function getInfo(input: Buffer): Promise<ImageInfo> {
    if (sharp) {
      const pipeline = sharp(input)
      const meta = await pipeline.metadata()
      return {
        width: meta.width || 0,
        height: meta.height || 0,
        format: meta.format || 'unknown',
        size: input.length,
        hasAlpha: meta.hasAlpha || false,
        channels: meta.channels || 3,
      }
    }

    const parsed = parseImageHeaders(input)
    if (!parsed) {
      return {
        width: 0,
        height: 0,
        format: 'unknown',
        size: input.length,
        hasAlpha: false,
        channels: 3,
      }
    }

    return {
      width: parsed.width,
      height: parsed.height,
      format: parsed.format,
      size: input.length,
      hasAlpha: parsed.hasAlpha,
      channels: parsed.channels,
    }
  }

  /** Apply transforms to an image buffer using sharp (if available) */
  async function transform(input: Buffer, options: TransformOptions): Promise<TransformResult> {
    const inputId = crypto.createHash('md5').update(input).digest('hex')
    const fullKey = computeFullCacheKey(inputId, options)
    const outputFormat = options.format || defaultFormat
    const cachedPath = getCachePath(cacheDir, fullKey, outputFormat)

    // Check cache first
    if (fs.existsSync(cachedPath)) {
      const cached = fs.readFileSync(cachedPath)
      const info = await getInfo(cached)
      return { data: cached, info, format: outputFormat, cacheKey: fullKey }
    }

    if (!sharp) {
      // Without sharp, return original buffer with metadata and cache it
      const info = await getInfo(input)
      ensureDir(cacheDir)
      fs.writeFileSync(cachedPath, input)
      return { data: input, info, format: info.format, cacheKey: fullKey }
    }

    // Apply transforms via sharp pipeline
    let pipeline = sharp(input)

    if (options.rotate !== undefined && options.rotate !== 0) {
      pipeline = pipeline.rotate(options.rotate)
    }

    if (options.flip) {
      pipeline = pipeline.flip()
    }

    if (options.flop) {
      pipeline = pipeline.flop()
    }

    if (options.crop) {
      pipeline = pipeline.extract({
        left: options.crop.x,
        top: options.crop.y,
        width: options.crop.width,
        height: options.crop.height,
      })
    }

    if (options.width || options.height) {
      pipeline = pipeline.resize(options.width, options.height, {
        fit: options.resize || 'cover',
      })
    }

    if (options.blur && options.blur > 0) {
      pipeline = pipeline.blur(options.blur)
    }

    if (options.sharpen && options.sharpen > 0) {
      pipeline = pipeline.sharpen(options.sharpen)
    }

    if (options.grayscale) {
      pipeline = pipeline.grayscale()
    }

    if (options.tint) {
      pipeline = pipeline.tint(hexToRgb(options.tint))
    }

    if (options.watermark?.image) {
      const gravity = positionToGravity(options.watermark.position)
      pipeline = pipeline.composite([{
        input: options.watermark.image,
        gravity,
        blend: 'over',
      }])
    }

    const quality = options.quality || defaultQuality
    pipeline = pipeline.toFormat(outputFormat, { quality })

    const outputBuffer = await pipeline.toBuffer()
    const info = await getInfo(outputBuffer)

    // Cache result
    ensureDir(cacheDir)
    fs.writeFileSync(cachedPath, outputBuffer)

    return { data: outputBuffer, info, format: outputFormat, cacheKey: fullKey }
  }

  /** Transform a file on disk, writing the result to an output path */
  async function transformFile(
    inputPath: string,
    outputPath: string,
    options: TransformOptions
  ): Promise<TransformResult> {
    const inputBuffer = fs.readFileSync(inputPath)
    const result = await transform(inputBuffer, options)
    const outDir = path.dirname(outputPath)
    ensureDir(outDir)
    fs.writeFileSync(outputPath, result.data)
    return result
  }

  /** Generate a transform URL with query parameters for server-side processing */
  function transformUrl(url: string, options: TransformOptions): TransformUrlResult {
    const params: Record<string, string> = {}

    if (options.width) params.w = String(options.width)
    if (options.height) params.h = String(options.height)
    if (options.resize) params.fit = options.resize
    if (options.format) params.fm = options.format
    if (options.quality) params.q = String(options.quality)
    if (options.rotate) params.rot = String(options.rotate)
    if (options.flip) params.flip = 'v'
    if (options.flop) params.flop = 'h'
    if (options.blur) params.blur = String(options.blur)
    if (options.sharpen) params.sharp = String(options.sharpen)
    if (options.grayscale) params.gray = '1'
    if (options.tint) params.tint = options.tint.replace('#', '')
    if (options.crop) {
      params.cx = String(options.crop.x)
      params.cy = String(options.crop.y)
      params.cw = String(options.crop.width)
      params.ch = String(options.crop.height)
    }
    if (options.watermark?.text) params.wm_text = options.watermark.text
    if (options.watermark?.position) params.wm_pos = options.watermark.position
    if (options.watermark?.opacity !== undefined) params.wm_op = String(options.watermark.opacity)

    const queryString = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')

    const separator = url.includes('?') ? '&' : '?'
    const fullUrl = `${baseUrl}/storage/v1/render/image${separator}url=${encodeURIComponent(url)}&${queryString}`
    const cacheKey = getCacheKey(options)

    return { url: fullUrl, queryParams: params, cacheKey }
  }

  /** Quick thumbnail generation at a given square size */
  async function thumbnail(input: Buffer, size: number): Promise<TransformResult> {
    return transform(input, {
      width: size,
      height: size,
      resize: 'cover',
      format: defaultFormat,
      quality: defaultQuality,
    })
  }

  /** Optimize an image by reducing quality and optionally converting format */
  async function optimize(input: Buffer, options?: {
    quality?: number
    format?: ImageOutputFormat
    maxWidth?: number
    maxHeight?: number
  }): Promise<TransformResult> {
    const opts: TransformOptions = {
      quality: options?.quality || 75,
      format: options?.format || 'webp',
    }

    if (options?.maxWidth || options?.maxHeight) {
      const info = await getInfo(input)
      if (options?.maxWidth && info.width > options.maxWidth) {
        opts.width = options.maxWidth
        opts.resize = 'inside'
      }
      if (options?.maxHeight && info.height > options.maxHeight) {
        opts.height = options.maxHeight
        opts.resize = 'inside'
      }
    }

    return transform(input, opts)
  }

  /** Transform multiple images with the same options */
  async function batch(
    inputs: Array<{ data: Buffer; id: string }>,
    options: TransformOptions
  ): Promise<BatchResult> {
    const results: BatchResult['results'] = []
    let totalProcessed = 0
    let totalErrors = 0

    for (const input of inputs) {
      try {
        const result = await transform(input.data, options)
        results.push({ input: input.id, result })
        totalProcessed++
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        results.push({ input: input.id, error: message })
        totalErrors++
      }
    }

    return { results, totalProcessed, totalErrors }
  }

  /** Clear the entire transform cache */
  function clearCache(): { filesRemoved: number; bytesFreed: number } {
    if (!fs.existsSync(cacheDir)) return { filesRemoved: 0, bytesFreed: 0 }

    const entries = fs.readdirSync(cacheDir)
    let filesRemoved = 0
    let bytesFreed = 0

    for (const entry of entries) {
      const fullPath = path.join(cacheDir, entry)
      const stat = fs.statSync(fullPath)
      if (stat.isFile()) {
        bytesFreed += stat.size
        fs.unlinkSync(fullPath)
        filesRemoved++
      }
    }

    return { filesRemoved, bytesFreed }
  }

  return {
    transform,
    transformFile,
    transformUrl,
    getInfo,
    thumbnail,
    optimize,
    batch,
    getCacheKey,
    clearCache,
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function positionToGravity(position: WatermarkPosition): string {
  const map: Record<WatermarkPosition, string> = {
    'top-left': 'northwest',
    'top-center': 'north',
    'top-right': 'northeast',
    'center-left': 'west',
    'center': 'centre',
    'center-right': 'east',
    'bottom-left': 'southwest',
    'bottom-center': 'south',
    'bottom-right': 'southeast',
  }
  return map[position] || 'southeast'
}
