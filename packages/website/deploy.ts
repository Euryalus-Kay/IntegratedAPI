#!/usr/bin/env npx tsx
/**
 * VibeKit Website Deploy Script
 *
 * Deploys the website using VibeKit's own deploy + hosting system.
 * Creates a real deployment, publishes files, and starts a live HTTP server.
 *
 * Usage:
 *   npx tsx deploy.ts              # Deploy and serve on http://localhost:3748
 *   npx tsx deploy.ts --port 8080  # Deploy on custom port
 */

import { createDeployManager } from '../sdk/src/deploy/index.js'
import { startHostingServer, createTunnel } from '../sdk/src/deploy/host.js'
import { createLogger } from '../sdk/src/utils/logger.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const log = createLogger('vibekit:website-deploy')

async function main() {
  const dataDir = path.join(__dirname, '.vibekit')
  const deploy = createDeployManager(dataDir)

  // Parse CLI args
  const args = process.argv.slice(2)
  const portIdx = args.indexOf('--port')
  const port = portIdx >= 0 ? parseInt(args[portIdx + 1], 10) : 3748

  console.log('')
  console.log('  \x1b[36m▲ VibeKit Deploy\x1b[0m')
  console.log('')

  // Get git info
  let commitHash = '', commitMessage = '', branch = ''
  try {
    commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }).trim()
    commitMessage = execSync('git log -1 --pretty=%s', { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }).trim()
    branch = execSync('git branch --show-current', { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }).trim()
  } catch { /* git not available */ }

  // ── Build ──────────────────────────────────────────────────
  console.log('  \x1b[90m┌\x1b[0m Building...')
  const buildStart = Date.now()

  const distDir = path.join(__dirname, 'dist')
  if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true })
  const srcDir = path.join(__dirname, 'src')
  fs.cpSync(srcDir, distDir, { recursive: true })

  const buildDuration = Date.now() - buildStart
  console.log(`  \x1b[90m├\x1b[0m Built in ${buildDuration}ms`)

  // ── Create Deployment ──────────────────────────────────────
  const deployment = deploy.create({
    environment: 'production',
    commitHash,
    commitMessage,
    branch,
    metadata: {
      type: 'static-site',
      framework: 'vanilla-html',
      package: '@vibekit/website',
    }
  })

  deploy.addLog(deployment.id, { level: 'info', message: 'Building website...', phase: 'build' })
  deploy.updateStatus(deployment.id, 'building', { buildDuration })
  deploy.addLog(deployment.id, { level: 'info', message: `Built in ${buildDuration}ms`, phase: 'build' })

  // ── Publish (copy files to deployment dir) ─────────────────
  console.log('  \x1b[90m├\x1b[0m Publishing...')
  deploy.updateStatus(deployment.id, 'deploying')
  deploy.addLog(deployment.id, { level: 'info', message: 'Publishing files...', phase: 'deploy' })

  const publishStart = Date.now()
  const result = deploy.publish(deployment.id, distDir, { port })
  const deployDuration = Date.now() - publishStart

  deploy.addLog(deployment.id, {
    level: 'info',
    message: `Published ${result.fileCount} files (${(result.totalSize / 1024).toFixed(1)} KB)`,
    phase: 'deploy',
  })
  deploy.updateStatus(deployment.id, 'ready', { deployDuration, url: result.url })
  deploy.addLog(deployment.id, { level: 'info', message: 'Deployment ready!', phase: 'promote' })

  console.log(`  \x1b[90m├\x1b[0m ${result.fileCount} files (${(result.totalSize / 1024).toFixed(1)} KB)`)

  // ── Start Hosting Server ───────────────────────────────────
  console.log('  \x1b[90m├\x1b[0m Starting server...')
  const server = await startHostingServer({ port, dataDir })

  console.log('  \x1b[90m└\x1b[0m')
  console.log('')
  console.log(`  \x1b[32m✓ Ready!\x1b[0m Deployed to \x1b[4m${server.url}\x1b[0m`)
  console.log('')
  console.log(`  \x1b[90m  Deployment:  ${deployment.id.slice(0, 8)}\x1b[0m`)
  console.log(`  \x1b[90m  Branch:      ${branch || 'unknown'}\x1b[0m`)
  console.log(`  \x1b[90m  Commit:      ${commitHash || 'unknown'}\x1b[0m`)
  console.log(`  \x1b[90m  Environment: production\x1b[0m`)
  console.log('')
  console.log(`  \x1b[90m  Local URL:   ${server.url}\x1b[0m`)
  console.log(`  \x1b[90m  Site URL:    ${server.url}/sites/${deployment.id}/\x1b[0m`)
  console.log(`  \x1b[90m  API:         ${server.url}/api/deployments\x1b[0m`)

  // Try to create a public tunnel
  console.log('')
  console.log('  \x1b[90mCreating public tunnel...\x1b[0m')
  const tunnel = await createTunnel(port)
  if (tunnel) {
    console.log(`  \x1b[32m✓ Public URL:\x1b[0m \x1b[4m${tunnel.url}\x1b[0m`)
    console.log(`  \x1b[90m  Provider: ${tunnel.provider}\x1b[0m`)

    // Update deployment with public URL
    deploy.updateStatus(deployment.id, 'ready', { url: tunnel.url })

    process.on('exit', () => tunnel.stop())
  } else {
    console.log('  \x1b[33m⚠ No tunnel available.\x1b[0m Install cloudflared for public URLs:')
    console.log('    brew install cloudflared')
  }

  console.log('')
  console.log('  \x1b[90mPress Ctrl+C to stop the server\x1b[0m')
  console.log('')

  // Keep process alive
  process.on('SIGINT', () => {
    console.log('\n  \x1b[33mShutting down...\x1b[0m')
    server.stop()
    process.exit(0)
  })

  process.on('SIGTERM', () => {
    server.stop()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error('\n  \x1b[31m✗ Deploy failed:\x1b[0m', err.message || err)
  process.exit(1)
})
