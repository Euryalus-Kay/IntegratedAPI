import type { Command } from 'commander'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { getConfig, setConfig, db, auth, storage, realtime } from 'vibekit'
import {
  banner,
  box,
  badge,
  table,
  bold,
  dim,
  green,
  red,
  yellow,
  cyan,
  formatDuration,
  formatBytes,
  errorBox,
} from '../utils/format.js'
import { checkPortAvailable, formatError } from '../utils/diagnostics.js'

interface RequestLogEntry {
  method: string
  path: string
  status: number
  duration: number
  timestamp: Date
}

const requestLog: RequestLogEntry[] = []
const MAX_LOG_ENTRIES = 200
const startTime = Date.now()

function logRequest(entry: RequestLogEntry): void {
  requestLog.unshift(entry)
  if (requestLog.length > MAX_LOG_ENTRIES) {
    requestLog.length = MAX_LOG_ENTRIES
  }

  const statusColor =
    entry.status < 300 ? green :
    entry.status < 400 ? cyan :
    entry.status < 500 ? yellow : red

  const methodPadded = entry.method.padEnd(7)
  const pathPadded = entry.path.length > 50 ? entry.path.slice(0, 47) + '...' : entry.path
  const durationStr = formatDuration(entry.duration)

  console.log(
    `  ${dim(new Date().toLocaleTimeString())} ${bold(methodPadded)} ${pathPadded.padEnd(52)} ${statusColor(String(entry.status))} ${dim(durationStr)}`
  )
}

function setCorsHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
  res.setHeader('Access-Control-Max-Age', '86400')
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json')
  res.writeHead(status)
  res.end(JSON.stringify(data, null, 2))
}

function parseJsonBody(body: string): { ok: true; data: any } | { ok: false; error: string } {
  if (!body.trim()) return { ok: true, data: {} }
  try {
    return { ok: true, data: JSON.parse(body) }
  } catch (e: any) {
    return { ok: false, error: `Invalid JSON in request body: ${e.message}` }
  }
}

async function buildDashboardHtml(config: any): Promise<string> {
  let tablesHtml = ''
  let authCodesHtml = ''
  let storageHtml = ''
  let wsClientCount = 0

  // Database tables
  try {
    const tablesResult = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    for (const row of tablesResult.rows) {
      const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
      const count = countResult?.count ?? 0
      tablesHtml += `<tr><td>${row.name}</td><td>${count}</td></tr>`
    }
  } catch {
    tablesHtml = '<tr><td colspan="2">Database not initialized</td></tr>'
  }

  // Recent auth codes
  try {
    const codes = await db.query<{ email: string; created_at: string; expires_at: string; used: number }>(
      "SELECT email, created_at, expires_at, used FROM vibekit_auth_codes ORDER BY created_at DESC LIMIT 10"
    )
    for (const code of codes.rows) {
      const statusBadge = code.used ? '<span class="badge badge-used">USED</span>' : '<span class="badge badge-active">ACTIVE</span>'
      authCodesHtml += `<tr><td>${code.email}</td><td>${code.created_at}</td><td>${code.expires_at}</td><td>${statusBadge}</td></tr>`
    }
  } catch {
    authCodesHtml = '<tr><td colspan="4">Auth tables not initialized</td></tr>'
  }

  // Storage files
  try {
    const storagePath = config.storagePath
    if (existsSync(storagePath)) {
      const files = readdirSync(storagePath, { recursive: true, withFileTypes: false }) as string[]
      for (const file of files.slice(0, 20)) {
        const filePath = join(storagePath, String(file))
        try {
          const stat = statSync(filePath)
          if (stat.isFile()) {
            storageHtml += `<tr><td>${file}</td><td>${formatBytes(stat.size)}</td><td>${stat.mtime.toLocaleString()}</td></tr>`
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    storageHtml = '<tr><td colspan="3">Storage not initialized</td></tr>'
  }

  // WebSocket clients
  try {
    wsClientCount = realtime.getClientCount()
  } catch {
    // realtime not initialized
  }

  // Request log
  const recentRequests = requestLog.slice(0, 30)
  let requestsHtml = ''
  for (const entry of recentRequests) {
    const statusClass = entry.status < 300 ? 'status-ok' : entry.status < 400 ? 'status-redirect' : entry.status < 500 ? 'status-warn' : 'status-error'
    requestsHtml += `<tr class="${statusClass}"><td>${entry.method}</td><td>${entry.path}</td><td>${entry.status}</td><td>${formatDuration(entry.duration)}</td><td>${entry.timestamp.toLocaleTimeString()}</td></tr>`
  }

  const uptime = formatDuration(Date.now() - startTime)
  const memUsage = process.memoryUsage()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VibeKit Dev Dashboard</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
      background: #0d1117;
      color: #c9d1d9;
      padding: 24px;
      line-height: 1.6;
    }
    h1 { color: #58a6ff; font-size: 24px; margin-bottom: 4px; }
    h2 { color: #8b949e; font-size: 16px; margin: 24px 0 12px; border-bottom: 1px solid #21262d; padding-bottom: 8px; }
    .subtitle { color: #8b949e; font-size: 13px; margin-bottom: 20px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .stat-card {
      background: #161b22;
      border: 1px solid #21262d;
      border-radius: 8px;
      padding: 16px;
    }
    .stat-card .label { color: #8b949e; font-size: 12px; text-transform: uppercase; }
    .stat-card .value { color: #f0f6fc; font-size: 22px; font-weight: bold; margin-top: 4px; }
    .stat-card .value.ok { color: #3fb950; }
    .stat-card .value.warn { color: #d29922; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #21262d; font-size: 13px; }
    th { color: #8b949e; font-weight: 600; background: #161b22; }
    td { color: #c9d1d9; }
    tr:hover td { background: #161b22; }
    .status-ok td:nth-child(3) { color: #3fb950; }
    .status-redirect td:nth-child(3) { color: #58a6ff; }
    .status-warn td:nth-child(3) { color: #d29922; }
    .status-error td:nth-child(3) { color: #f85149; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 600;
    }
    .badge-active { background: #0d4429; color: #3fb950; }
    .badge-used { background: #3d1d00; color: #d29922; }
    .section { background: #161b22; border: 1px solid #21262d; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
    .auto-refresh { color: #484f58; font-size: 11px; text-align: right; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>VibeKit Dev Dashboard</h1>
  <p class="subtitle">${config.name} &mdash; http://localhost:${config.port} &mdash; uptime ${uptime}</p>

  <div class="grid">
    <div class="stat-card">
      <div class="label">Uptime</div>
      <div class="value ok">${uptime}</div>
    </div>
    <div class="stat-card">
      <div class="label">Memory (RSS)</div>
      <div class="value">${formatBytes(memUsage.rss)}</div>
    </div>
    <div class="stat-card">
      <div class="label">Heap Used</div>
      <div class="value">${formatBytes(memUsage.heapUsed)}</div>
    </div>
    <div class="stat-card">
      <div class="label">WebSocket Clients</div>
      <div class="value">${wsClientCount}</div>
    </div>
    <div class="stat-card">
      <div class="label">Requests Logged</div>
      <div class="value">${requestLog.length}</div>
    </div>
  </div>

  <h2>Database Tables</h2>
  <div class="section">
    <table>
      <thead><tr><th>Table</th><th>Rows</th></tr></thead>
      <tbody>${tablesHtml || '<tr><td colspan="2">No tables</td></tr>'}</tbody>
    </table>
  </div>

  <h2>Recent Auth Codes</h2>
  <div class="section">
    <table>
      <thead><tr><th>Email</th><th>Created</th><th>Expires</th><th>Status</th></tr></thead>
      <tbody>${authCodesHtml || '<tr><td colspan="4">No auth codes</td></tr>'}</tbody>
    </table>
  </div>

  <h2>Recent Requests</h2>
  <div class="section">
    <table>
      <thead><tr><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>Time</th></tr></thead>
      <tbody>${requestsHtml || '<tr><td colspan="5">No requests yet</td></tr>'}</tbody>
    </table>
  </div>

  <h2>Storage Files</h2>
  <div class="section">
    <table>
      <thead><tr><th>File</th><th>Size</th><th>Modified</th></tr></thead>
      <tbody>${storageHtml || '<tr><td colspan="3">No files</td></tr>'}</tbody>
    </table>
  </div>

  <p class="auto-refresh">Auto-refreshes every 5 seconds</p>
  <script>setTimeout(() => location.reload(), 5000);</script>
</body>
</html>`
}

export function registerDevCommand(program: Command): void {
  program
    .command('dev')
    .description('Start the local development server')
    .option('--port <port>', 'Port number', '3456')
    .action(async (options: { port: string }) => {
      const requestedPort = parseInt(options.port, 10)
      let port = requestedPort

      // Port conflict detection
      const isAvailable = await checkPortAvailable(port)
      if (!isAvailable) {
        console.log(yellow(`\n  Port ${port} is already in use.`))
        // Find next available port
        for (let p = port + 1; p <= port + 20; p++) {
          if (await checkPortAvailable(p)) {
            port = p
            console.log(green(`  Using port ${port} instead.\n`))
            break
          }
        }
        if (port === requestedPort) {
          console.log(red(`  Could not find an available port in range ${requestedPort}-${requestedPort + 20}.`))
          process.exit(1)
        }
      }

      setConfig({ port })
      const config = getConfig()

      // Print startup banner
      console.log(banner())

      const modules = config.modules
      const dbEnabled = !!modules.db
      const authEnabled = typeof modules.auth === 'object' ? modules.auth.enabled : !!modules.auth
      const storageEnabled = typeof modules.storage === 'object' ? modules.storage.enabled : !!modules.storage
      const emailEnabled = typeof modules.email === 'object' ? modules.email.enabled : !!modules.email
      const realtimeEnabled = !!modules.realtime

      const moduleStatus = (enabled: boolean, name: string) =>
        enabled ? `${green('●')} ${name}` : `${dim('○')} ${dim(name)}`

      const startupLines = [
        `${bold('App')}         http://localhost:${port}`,
        `${bold('Auth API')}    http://localhost:${port}/api/auth`,
        `${bold('Storage')}     http://localhost:${port}/storage`,
        `${bold('Realtime')}    ws://localhost:${port}/realtime`,
        `${bold('Dashboard')}   http://localhost:${port}/__vibekit/`,
        `${bold('Database')}    .vibekit/local.db ${dim('(SQLite)')}`,
        '',
        `${bold('Modules')}     ${moduleStatus(dbEnabled, 'db')}  ${moduleStatus(authEnabled, 'auth')}  ${moduleStatus(storageEnabled, 'storage')}  ${moduleStatus(emailEnabled, 'email')}  ${moduleStatus(realtimeEnabled, 'realtime')}`,
      ]

      console.log(box(startupLines, { title: `${config.name} Dev Server`, color: 'cyan' }))
      console.log('')

      // Initialize DB
      try {
        await db.sync()
        console.log(`  ${badge('OK', 'green')} Database synced`)
      } catch (e: any) {
        console.log(`  ${badge('WARN', 'yellow')} Database sync: ${e.message}`)
      }

      console.log(`  ${badge('OK', 'green')} Server starting on port ${port}`)
      console.log('')
      console.log(dim('  ─── Request Log ─────────────────────────────────────────────────────────────'))
      console.log('')

      // Create HTTP server
      const server = createServer(async (req, res) => {
        const requestStart = Date.now()
        const url = new URL(req.url || '/', `http://localhost:${port}`)

        setCorsHeaders(res)

        // Handle CORS preflight
        if (req.method === 'OPTIONS') {
          res.writeHead(204)
          res.end()
          logRequest({ method: 'OPTIONS', path: url.pathname, status: 204, duration: Date.now() - requestStart, timestamp: new Date() })
          return
        }

        try {
          // Health endpoint
          if (url.pathname === '/api/health') {
            const memUsage = process.memoryUsage()
            let dbHealthy = false
            try {
              await db.query('SELECT 1')
              dbHealthy = true
            } catch { /* db not available */ }

            jsonResponse(res, 200, {
              status: 'ok',
              uptime: Date.now() - startTime,
              memory: {
                rss: memUsage.rss,
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
              },
              modules: {
                db: { enabled: dbEnabled, healthy: dbHealthy },
                auth: { enabled: authEnabled },
                storage: { enabled: storageEnabled },
                email: { enabled: emailEnabled },
                realtime: { enabled: realtimeEnabled, clients: realtime.getClientCount() },
              },
              timestamp: new Date().toISOString(),
            })
            logRequest({ method: req.method || 'GET', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })
            return
          }

          // Auth API routes
          if (url.pathname.startsWith('/api/auth/')) {
            const route = url.pathname.replace('/api/auth/', '')
            res.setHeader('Content-Type', 'application/json')

            if (req.method === 'POST' && route === 'send-code') {
              const body = await readBody(req)
              const parsed = parseJsonBody(body)
              if (!parsed.ok) {
                jsonResponse(res, 400, { error: parsed.error })
                logRequest({ method: 'POST', path: url.pathname, status: 400, duration: Date.now() - requestStart, timestamp: new Date() })
                return
              }
              try {
                const { email } = parsed.data
                const result = await auth.sendCode(email)
                jsonResponse(res, 200, result)
                logRequest({ method: 'POST', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })
              } catch (e: any) {
                const status = e.statusCode || 500
                jsonResponse(res, status, { error: e.message })
                logRequest({ method: 'POST', path: url.pathname, status, duration: Date.now() - requestStart, timestamp: new Date() })
              }
              return
            }

            if (req.method === 'POST' && route === 'verify') {
              const body = await readBody(req)
              const parsed = parseJsonBody(body)
              if (!parsed.ok) {
                jsonResponse(res, 400, { error: parsed.error })
                logRequest({ method: 'POST', path: url.pathname, status: 400, duration: Date.now() - requestStart, timestamp: new Date() })
                return
              }
              try {
                const { email, code } = parsed.data
                const result = await auth.verifyCode(email, code)
                jsonResponse(res, 200, { user: result.user, token: result.token, expiresAt: result.expiresAt.toISOString() })
                logRequest({ method: 'POST', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })
              } catch (e: any) {
                const status = e.statusCode || 500
                jsonResponse(res, status, { error: e.message })
                logRequest({ method: 'POST', path: url.pathname, status, duration: Date.now() - requestStart, timestamp: new Date() })
              }
              return
            }

            if (req.method === 'GET' && route === 'me') {
              try {
                const user = await auth.getUser(req)
                if (!user) {
                  jsonResponse(res, 401, { user: null })
                  logRequest({ method: 'GET', path: url.pathname, status: 401, duration: Date.now() - requestStart, timestamp: new Date() })
                } else {
                  jsonResponse(res, 200, { user })
                  logRequest({ method: 'GET', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })
                }
              } catch {
                jsonResponse(res, 401, { user: null })
                logRequest({ method: 'GET', path: url.pathname, status: 401, duration: Date.now() - requestStart, timestamp: new Date() })
              }
              return
            }

            if (req.method === 'POST' && route === 'logout') {
              try {
                await auth.logout(req)
                jsonResponse(res, 200, { success: true })
                logRequest({ method: 'POST', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })
              } catch (e: any) {
                jsonResponse(res, 500, { error: e.message })
                logRequest({ method: 'POST', path: url.pathname, status: 500, duration: Date.now() - requestStart, timestamp: new Date() })
              }
              return
            }

            jsonResponse(res, 404, { error: 'Not found' })
            logRequest({ method: req.method || 'GET', path: url.pathname, status: 404, duration: Date.now() - requestStart, timestamp: new Date() })
            return
          }

          // Storage serving
          if (url.pathname.startsWith('/storage/')) {
            const filePath = url.pathname.replace('/storage/', '')
            const fullPath = join(config.storagePath, filePath)
            if (existsSync(fullPath)) {
              const data = readFileSync(fullPath)
              res.writeHead(200)
              res.end(data)
              logRequest({ method: req.method || 'GET', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })
            } else {
              res.writeHead(404)
              res.end('File not found')
              logRequest({ method: req.method || 'GET', path: url.pathname, status: 404, duration: Date.now() - requestStart, timestamp: new Date() })
            }
            return
          }

          // Dev dashboard
          if (url.pathname === '/__vibekit/' || url.pathname === '/__vibekit') {
            res.setHeader('Content-Type', 'text/html')
            const html = await buildDashboardHtml(config)
            res.writeHead(200)
            res.end(html)
            logRequest({ method: req.method || 'GET', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })
            return
          }

          // Default response
          res.setHeader('Content-Type', 'text/html')
          res.writeHead(200)
          res.end(`<!DOCTYPE html>
<html><head><title>VibeKit</title></head>
<body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #0d1117; color: #c9d1d9;">
  <div style="text-align: center;">
    <h1 style="color: #58a6ff;">VibeKit Dev Server</h1>
    <p>Your app is running. Build something!</p>
    <p style="margin-top: 16px;"><a href="/__vibekit/" style="color: #58a6ff;">Open Dev Dashboard</a></p>
  </div>
</body></html>`)
          logRequest({ method: req.method || 'GET', path: url.pathname, status: 200, duration: Date.now() - requestStart, timestamp: new Date() })

        } catch (e: any) {
          // Unhandled error in request handler
          const formatted = formatError(e)
          console.log(`  ${badge('ERR', 'red')} ${formatted.title}: ${formatted.message}`)
          if (!res.headersSent) {
            jsonResponse(res, 500, { error: 'Internal server error', message: formatted.message })
          }
          logRequest({ method: req.method || 'GET', path: url.pathname, status: 500, duration: Date.now() - requestStart, timestamp: new Date() })
        }
      })

      // Handle unhandled promise rejections
      process.on('unhandledRejection', (reason: unknown) => {
        const formatted = formatError(reason)
        console.log('')
        console.log(`  ${badge('UNHANDLED', 'red')} ${formatted.title}: ${formatted.message}`)
        if (formatted.suggestion) {
          console.log(`  ${dim(formatted.suggestion)}`)
        }
        console.log('')
      })

      // Attach WebSocket for realtime
      const realtimeServer = realtime._getServer()
      realtimeServer.attach(server)

      server.listen(port, () => {
        console.log('')
      })

      // Graceful shutdown
      const shutdown = async (signal: string) => {
        console.log('')
        console.log('')
        console.log(dim(`  Received ${signal}. Shutting down...`))

        const uptime = formatDuration(Date.now() - startTime)
        const totalRequests = requestLog.length
        const memUsage = process.memoryUsage()

        try {
          await db.close()
          console.log(`  ${badge('OK', 'green')} Database connection closed`)
        } catch {
          // already closed
        }

        server.close(() => {
          console.log(`  ${badge('OK', 'green')} HTTP server stopped`)
          console.log('')
          console.log(dim('  ─── Session Summary ────────────────────────────────────────────────────────'))
          console.log('')
          console.log(`  Uptime:           ${uptime}`)
          console.log(`  Total requests:   ${totalRequests}`)
          console.log(`  Peak memory:      ${formatBytes(memUsage.rss)}`)
          console.log('')
          process.exit(0)
        })

        // Force close after 5 seconds
        setTimeout(() => {
          console.log(yellow('  Forcing shutdown...'))
          process.exit(1)
        }, 5000)
      }

      process.on('SIGINT', () => shutdown('SIGINT'))
      process.on('SIGTERM', () => shutdown('SIGTERM'))
    })
}
