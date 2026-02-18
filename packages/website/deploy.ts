#!/usr/bin/env npx tsx
/**
 * VibeKit Website Deploy Script
 *
 * Deploys the website using VibeKit's own deploy system as a self-test.
 * This demonstrates how createDeployManager works for static site deployment.
 */

import { createDeployManager } from '../sdk/src/deploy/index.js'
import { createLogger } from '../sdk/src/utils/logger.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const log = createLogger('vibekit:website-deploy')

async function main() {
  const deploy = createDeployManager(path.join(__dirname, '.vibekit'))

  log.info('Starting VibeKit website deployment...')

  // Get git info
  let commitHash = '', commitMessage = '', branch = ''
  try {
    commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }).trim()
    commitMessage = execSync('git log -1 --pretty=%s', { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }).trim()
    branch = execSync('git branch --show-current', { encoding: 'utf8', cwd: path.join(__dirname, '..', '..') }).trim()
  } catch { /* git not available */ }

  // Create deployment
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

  log.info(`Created deployment ${deployment.id}`)

  // Build phase
  deploy.addLog(deployment.id, { level: 'info', message: 'Building website...', phase: 'build' })
  deploy.updateStatus(deployment.id, 'building')

  try {
    // Run build
    const distDir = path.join(__dirname, 'dist')
    if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true })

    const srcDir = path.join(__dirname, 'src')
    fs.cpSync(srcDir, distDir, { recursive: true })

    // Count files
    const files = fs.readdirSync(distDir)
    deploy.addLog(deployment.id, { level: 'info', message: `Built ${files.length} files`, phase: 'build' })

    // Calculate total size
    let totalSize = 0
    for (const file of files) {
      const stat = fs.statSync(path.join(distDir, file))
      totalSize += stat.size
    }
    deploy.addLog(deployment.id, { level: 'info', message: `Total size: ${(totalSize / 1024).toFixed(1)} KB`, phase: 'build' })

  } catch (err) {
    deploy.updateStatus(deployment.id, 'failed')
    deploy.addLog(deployment.id, { level: 'error', message: `Build failed: ${err}`, phase: 'build' })
    log.error('Build failed', { error: String(err) })
    process.exit(1)
  }

  // Deploy phase
  deploy.addLog(deployment.id, { level: 'info', message: 'Deploying...', phase: 'deploy' })
  deploy.updateStatus(deployment.id, 'deploying')

  try {
    // In a real deployment, this would upload to S3/R2/CDN
    // For now, we verify the build output exists and is valid
    const distDir = path.join(__dirname, 'dist')
    const indexExists = fs.existsSync(path.join(distDir, 'index.html'))
    const docsExists = fs.existsSync(path.join(distDir, 'docs.html'))

    if (!indexExists) throw new Error('index.html not found in build output')
    if (!docsExists) throw new Error('docs.html not found in build output')

    deploy.addLog(deployment.id, { level: 'info', message: 'Verified: index.html ✓', phase: 'deploy' })
    deploy.addLog(deployment.id, { level: 'info', message: 'Verified: docs.html ✓', phase: 'deploy' })

    // Mark as ready
    deploy.updateStatus(deployment.id, 'ready')
    deploy.addLog(deployment.id, { level: 'info', message: 'Deployment successful!', phase: 'promote' })

  } catch (err) {
    deploy.updateStatus(deployment.id, 'failed')
    deploy.addLog(deployment.id, { level: 'error', message: `Deploy failed: ${err}`, phase: 'deploy' })
    log.error('Deploy failed', { error: String(err) })
    process.exit(1)
  }

  // Print results
  const status = deploy.get(deployment.id)
  const logs = deploy.getLogs(deployment.id)
  const list = deploy.list({ environment: 'production', limit: 5 })

  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║  VibeKit Website Deployment Complete             ║')
  console.log('╠══════════════════════════════════════════════════╣')
  console.log(`║  ID:          ${deployment.id.slice(0, 36)}  ║`)
  console.log(`║  Status:      ${status?.status.padEnd(36)}║`)
  console.log(`║  Environment: ${'production'.padEnd(36)}║`)
  console.log(`║  Branch:      ${(branch || 'unknown').padEnd(36)}║`)
  console.log(`║  Commit:      ${(commitHash || 'unknown').padEnd(36)}║`)
  console.log('╠══════════════════════════════════════════════════╣')
  console.log('║  Build Logs:                                     ║')
  for (const log of logs) {
    const icon = log.level === 'error' ? '✗' : log.level === 'warn' ? '!' : '✓'
    console.log(`║  ${icon} ${log.message.slice(0, 46).padEnd(47)}║`)
  }
  console.log('╠══════════════════════════════════════════════════╣')
  console.log(`║  Total deployments: ${String(list.total).padEnd(30)}║`)
  console.log('╚══════════════════════════════════════════════════╝')
  console.log(`\nServe locally: npx serve dist`)
}

main().catch(console.error)
