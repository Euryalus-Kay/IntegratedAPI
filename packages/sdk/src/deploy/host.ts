import { Hono } from 'hono'
import fs from 'node:fs'
import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { createDeployManager } from './index.js'

// ── MIME Types (inline to avoid circular deps) ──────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html', '.htm': 'text/html',
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain', '.md': 'text/markdown', '.csv': 'text/csv',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.avif': 'image/avif', '.bmp': 'image/bmp',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.pdf': 'application/pdf', '.zip': 'application/zip',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.otf': 'font/otf', '.eot': 'application/vnd.ms-fontobject',
  '.wasm': 'application/wasm', '.map': 'application/json',
  '.yaml': 'text/yaml', '.yml': 'text/yaml',
}

function getMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

// ── Hosting App ─────────────────────────────────────────────────────────────

export interface HostingServerOptions {
  /** Port to listen on (default: 3748) */
  port?: number
  /** VibeKit data directory (default: .vibekit) */
  dataDir?: string
  /** Hostname to bind to (default: 0.0.0.0) */
  hostname?: string
}

/**
 * Create a Hono app that serves deployed static sites.
 * Can be used standalone or mounted in another Hono app.
 */
export function createHostingApp(dataDir?: string) {
  const dir = dataDir || path.join(process.cwd(), '.vibekit')
  const deploy = createDeployManager(dir)
  const app = new Hono()

  // ── API: List deployments ─────────────────────────────────
  app.get('/api/deployments', (c) => {
    const result = deploy.list({ limit: 50 })
    return c.json(result)
  })

  // ── API: Get deployment info ──────────────────────────────
  app.get('/api/deployments/:id', (c) => {
    const id = c.req.param('id')
    const deployment = deploy.get(id)
    if (!deployment) return c.json({ error: 'Not found' }, 404)
    return c.json(deployment)
  })

  // ── Serve files for a specific deployment ─────────────────
  app.get('/sites/:id/*', (c) => {
    const id = c.req.param('id')
    const deployment = deploy.get(id)
    if (!deployment) return c.json({ error: 'Deployment not found' }, 404)

    const deployDir = deploy.getDeployDir(id)
    if (!fs.existsSync(deployDir)) return c.json({ error: 'Deployment files not found' }, 404)

    // Get the file path from the URL (everything after /sites/:id/)
    const url = new URL(c.req.url)
    const prefix = `/sites/${id}/`
    let filePath = url.pathname.slice(prefix.length) || 'index.html'

    // Security: prevent path traversal
    const resolved = path.resolve(deployDir, filePath)
    if (!resolved.startsWith(deployDir)) {
      return c.json({ error: 'Forbidden' }, 403)
    }

    // Try exact file, then with .html, then index.html in directory
    let fullPath = resolved
    if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
      // Try as directory with index.html
      const indexPath = path.join(fullPath, 'index.html')
      if (fs.existsSync(indexPath)) {
        fullPath = indexPath
      } else {
        // Try appending .html
        const htmlPath = fullPath + '.html'
        if (fs.existsSync(htmlPath)) {
          fullPath = htmlPath
        } else {
          // SPA fallback: serve root index.html for non-file paths
          const rootIndex = path.join(deployDir, 'index.html')
          if (fs.existsSync(rootIndex) && !path.extname(filePath)) {
            fullPath = rootIndex
          } else {
            return c.notFound()
          }
        }
      }
    }

    const content = fs.readFileSync(fullPath)
    const mime = getMime(fullPath)

    return new Response(content, {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(content.length),
        'Cache-Control': mime.startsWith('text/html')
          ? 'no-cache'
          : 'public, max-age=31536000, immutable',
        'X-Deployment-Id': id,
      },
    })
  })

  // ── Root: Serve active production deployment ──────────────
  app.get('/*', (c) => {
    const active = deploy.getActive('production')
    if (!active) {
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head><title>VibeKit Hosting</title>
        <style>body{font-family:system-ui;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
        .c{text-align:center}h1{font-size:3em;margin:0}p{color:#888;margin:1em 0}a{color:#00a3ff}</style></head>
        <body><div class="c">
          <h1>VibeKit</h1>
          <p>No active deployment. Deploy your site first.</p>
          <p><code>vibekit deploy ./dist</code></p>
        </div></body></html>
      `)
    }

    // Redirect to the active deployment's site
    const url = new URL(c.req.url)
    const filePath = url.pathname === '/' ? '' : url.pathname.slice(1)
    const redirectUrl = `/sites/${active.id}/${filePath}`
    return c.redirect(redirectUrl, 302)
  })

  return app
}

/**
 * Start the static site hosting server.
 * Returns a handle to stop the server.
 */
export interface TunnelResult {
  url: string
  provider: 'cloudflared' | 'ssh' | 'none'
  stop: () => void
}

/**
 * Try to create a public tunnel to the local hosting server.
 * Attempts cloudflared first (free, no account needed), falls back to ssh tunnel.
 * Returns null if no tunnel method is available.
 */
export async function createTunnel(port: number): Promise<TunnelResult | null> {
  // Try cloudflared first (Cloudflare's free tunnel, no auth needed)
  try {
    const result = await tryCloudflared(port)
    if (result) return result
  } catch { /* not available */ }

  // Try localhost.run (free SSH-based tunnel)
  try {
    const result = await trySshTunnel(port)
    if (result) return result
  } catch { /* not available */ }

  return null
}

async function tryCloudflared(port: number): Promise<TunnelResult | null> {
  return new Promise((resolve) => {
    let resolved = false
    const proc: ChildProcess = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        resolve(null)
      }
    }, 15000)

    const handleOutput = (data: Buffer) => {
      const text = data.toString()
      // cloudflared prints the tunnel URL to stderr
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)
      if (match && !resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve({
          url: match[0],
          provider: 'cloudflared',
          stop: () => proc.kill(),
        })
      }
    }

    proc.stdout?.on('data', handleOutput)
    proc.stderr?.on('data', handleOutput)

    proc.on('error', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(null)
      }
    })

    proc.on('exit', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(null)
      }
    })
  })
}

async function trySshTunnel(port: number): Promise<TunnelResult | null> {
  return new Promise((resolve) => {
    let resolved = false
    const proc: ChildProcess = spawn('ssh', [
      '-R', `80:localhost:${port}`,
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ServerAliveInterval=60',
      'nokey@localhost.run',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        resolve(null)
      }
    }, 15000)

    const handleOutput = (data: Buffer) => {
      const text = data.toString()
      const match = text.match(/https:\/\/[a-z0-9]+\.lhr\.life/)
      if (match && !resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve({
          url: match[0],
          provider: 'ssh',
          stop: () => proc.kill(),
        })
      }
    }

    proc.stdout?.on('data', handleOutput)
    proc.stderr?.on('data', handleOutput)

    proc.on('error', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(null)
      }
    })

    proc.on('exit', () => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve(null)
      }
    })
  })
}

export async function startHostingServer(options?: HostingServerOptions): Promise<{
  url: string
  port: number
  stop: () => void
}> {
  const port = options?.port || 3748
  const hostname = options?.hostname || '0.0.0.0'
  const dataDir = options?.dataDir

  const app = createHostingApp(dataDir)

  // Dynamic import to avoid bundling issues when @hono/node-server isn't available
  const { serve } = await import('@hono/node-server')

  return new Promise((resolve) => {
    const server = serve({
      fetch: app.fetch,
      port,
      hostname,
    }, () => {
      const url = `http://localhost:${port}`
      resolve({
        url,
        port,
        stop: () => {
          server.close()
        },
      })
    })
  })
}
