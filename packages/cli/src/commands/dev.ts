import type { Command } from 'commander'
import { createServer } from 'node:http'
import { getConfig, setConfig } from 'vibekit'
import { db, auth, storage, realtime } from 'vibekit'

export function registerDevCommand(program: Command): void {
  program
    .command('dev')
    .description('Start the local development server')
    .option('--port <port>', 'Port number', '3456')
    .action(async (options: { port: string }) => {
      const port = parseInt(options.port, 10)
      setConfig({ port })
      const config = getConfig()

      console.log('')
      console.log('  ┌─────────────────────────────────────────────┐')
      console.log('  │                                             │')
      console.log('  │   VibeKit Dev Server                        │')
      console.log('  │                                             │')
      console.log(`  │   App:       http://localhost:${port}           │`)
      console.log(`  │   Auth API:  http://localhost:${port}/api/auth  │`)
      console.log(`  │   Storage:   http://localhost:${port}/storage   │`)
      console.log(`  │   Realtime:  ws://localhost:${port}/realtime    │`)
      console.log(`  │   Database:  .vibekit/local.db (SQLite)      │`)
      console.log('  │                                             │')

      const modules = config.modules
      const dbEnabled = !!modules.db
      const authEnabled = typeof modules.auth === 'object' ? modules.auth.enabled : !!modules.auth
      const storageEnabled = typeof modules.storage === 'object' ? modules.storage.enabled : !!modules.storage
      const emailEnabled = typeof modules.email === 'object' ? modules.email.enabled : !!modules.email

      console.log(`  │   Modules: db ${dbEnabled ? '✓' : '✗'}  auth ${authEnabled ? '✓' : '✗'}  storage ${storageEnabled ? '✓' : '✗'}  email ${emailEnabled ? '✓' : '✗'} │`)
      console.log('  │                                             │')
      console.log('  └─────────────────────────────────────────────┘')
      console.log('')

      // Initialize DB
      try {
        await db.sync()
        console.log('  Database synced.')
      } catch (e: any) {
        console.log(`  Database sync warning: ${e.message}`)
      }

      // Create a basic HTTP server
      const server = createServer(async (req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${port}`)

        // Auth API routes
        if (url.pathname.startsWith('/api/auth/')) {
          const route = url.pathname.replace('/api/auth/', '')
          res.setHeader('Content-Type', 'application/json')

          if (req.method === 'POST' && route === 'send-code') {
            let body = ''
            req.on('data', chunk => body += chunk)
            req.on('end', async () => {
              try {
                const { email } = JSON.parse(body)
                const result = await auth.sendCode(email)
                res.writeHead(200)
                res.end(JSON.stringify(result))
              } catch (e: any) {
                res.writeHead(e.statusCode || 500)
                res.end(JSON.stringify({ error: e.message }))
              }
            })
            return
          }

          if (req.method === 'POST' && route === 'verify') {
            let body = ''
            req.on('data', chunk => body += chunk)
            req.on('end', async () => {
              try {
                const { email, code } = JSON.parse(body)
                const result = await auth.verifyCode(email, code)
                res.writeHead(200)
                res.end(JSON.stringify({ user: result.user, token: result.token, expiresAt: result.expiresAt.toISOString() }))
              } catch (e: any) {
                res.writeHead(e.statusCode || 500)
                res.end(JSON.stringify({ error: e.message }))
              }
            })
            return
          }

          if (req.method === 'GET' && route === 'me') {
            try {
              const user = await auth.getUser(req)
              if (!user) {
                res.writeHead(401)
                res.end(JSON.stringify({ user: null }))
              } else {
                res.writeHead(200)
                res.end(JSON.stringify({ user }))
              }
            } catch {
              res.writeHead(401)
              res.end(JSON.stringify({ user: null }))
            }
            return
          }

          if (req.method === 'POST' && route === 'logout') {
            try {
              await auth.logout(req)
              res.writeHead(200)
              res.end(JSON.stringify({ success: true }))
            } catch (e: any) {
              res.writeHead(500)
              res.end(JSON.stringify({ error: e.message }))
            }
            return
          }

          res.writeHead(404)
          res.end(JSON.stringify({ error: 'Not found' }))
          return
        }

        // Storage serving
        if (url.pathname.startsWith('/storage/')) {
          const filePath = url.pathname.replace('/storage/', '')
          const fs = await import('node:fs')
          const path = await import('node:path')
          const fullPath = path.join(config.storagePath, filePath)
          if (fs.existsSync(fullPath)) {
            const data = fs.readFileSync(fullPath)
            res.writeHead(200)
            res.end(data)
          } else {
            res.writeHead(404)
            res.end('File not found')
          }
          return
        }

        // Dev tools dashboard
        if (url.pathname === '/__vibekit/' || url.pathname === '/__vibekit') {
          res.setHeader('Content-Type', 'text/html')
          res.writeHead(200)
          res.end(`
            <!DOCTYPE html>
            <html><head><title>VibeKit Dev Tools</title></head>
            <body style="font-family: monospace; padding: 20px;">
              <h1>VibeKit Dev Tools</h1>
              <p>Database: .vibekit/local.db</p>
              <p>Storage: .vibekit/storage/</p>
              <p>Auth API: /api/auth/*</p>
            </body></html>
          `)
          return
        }

        // Default response
        res.setHeader('Content-Type', 'text/html')
        res.writeHead(200)
        res.end(`
          <!DOCTYPE html>
          <html><head><title>VibeKit</title></head>
          <body style="font-family: -apple-system, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh;">
            <div style="text-align: center;">
              <h1>VibeKit Dev Server</h1>
              <p>Your app is running. Build something!</p>
              <p><a href="/__vibekit/">Dev Tools</a></p>
            </div>
          </body></html>
        `)
      })

      // Attach WebSocket for realtime
      const realtimeServer = realtime._getServer()
      realtimeServer.attach(server)

      server.listen(port, () => {
        console.log(`  Server listening on http://localhost:${port}`)
        console.log('  Press Ctrl+C to stop.')
        console.log('')
      })
    })
}
