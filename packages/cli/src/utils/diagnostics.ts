import { existsSync, statSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'
import net from 'node:net'
import { VibeKitError } from 'vibekit'
import { formatBytes } from './format.js'

// ─── Health Check ────────────────────────────────────────────────────────────

export interface HealthCheckResult {
  name: string
  status: 'ok' | 'warn' | 'fail'
  message: string
}

export async function runHealthCheck(): Promise<HealthCheckResult[]> {
  const results: HealthCheckResult[] = []

  // Node version
  const nodeVersion = process.version
  const major = parseInt(nodeVersion.slice(1), 10)
  if (major >= 18) {
    results.push({ name: 'Node.js', status: 'ok', message: `${nodeVersion}` })
  } else {
    results.push({ name: 'Node.js', status: 'fail', message: `${nodeVersion} (requires >= 18)` })
  }

  // Package manager
  let packageManager = 'none'
  try {
    execSync('pnpm --version', { stdio: 'pipe' })
    packageManager = 'pnpm'
  } catch {
    try {
      execSync('npm --version', { stdio: 'pipe' })
      packageManager = 'npm'
    } catch {
      // no package manager found
    }
  }
  if (packageManager !== 'none') {
    results.push({ name: 'Package Manager', status: 'ok', message: packageManager })
  } else {
    results.push({ name: 'Package Manager', status: 'fail', message: 'No pnpm or npm found' })
  }

  // vibekit.json
  const configPath = join(process.cwd(), 'vibekit.json')
  if (existsSync(configPath)) {
    results.push({ name: 'vibekit.json', status: 'ok', message: 'Found' })
  } else {
    results.push({ name: 'vibekit.json', status: 'fail', message: 'Not found in project root' })
  }

  // .vibekit directory
  const dataDir = join(process.cwd(), '.vibekit')
  if (existsSync(dataDir)) {
    results.push({ name: '.vibekit dir', status: 'ok', message: 'Exists' })
  } else {
    results.push({ name: '.vibekit dir', status: 'warn', message: 'Missing (will be created on first run)' })
  }

  // Database connectivity
  const dbPath = join(dataDir, 'local.db')
  if (existsSync(dbPath)) {
    try {
      const stat = statSync(dbPath)
      results.push({ name: 'Database', status: 'ok', message: `SQLite ${formatBytes(stat.size)}` })
    } catch {
      results.push({ name: 'Database', status: 'fail', message: 'Cannot read database file' })
    }
  } else {
    results.push({ name: 'Database', status: 'warn', message: 'No local.db yet (will be created)' })
  }

  // Disk space (best-effort on Linux/macOS)
  try {
    const dfOutput = execSync('df -h . 2>/dev/null', { encoding: 'utf-8' })
    const lines = dfOutput.trim().split('\n')
    if (lines.length >= 2) {
      const parts = lines[1].split(/\s+/)
      const available = parts[3]
      const usePercent = parts[4]
      const usePct = parseInt(usePercent, 10)
      if (usePct > 90) {
        results.push({ name: 'Disk Space', status: 'warn', message: `${available} available (${usePercent} used)` })
      } else {
        results.push({ name: 'Disk Space', status: 'ok', message: `${available} available (${usePercent} used)` })
      }
    }
  } catch {
    // silently skip on unsupported platforms
  }

  return results
}

// ─── Port Check ──────────────────────────────────────────────────────────────

export function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

// ─── Framework Detection ─────────────────────────────────────────────────────

export type DetectedFramework = 'nextjs' | 'vite' | 'remix' | 'express' | 'hono' | 'html' | 'unknown'

export function detectFramework(): DetectedFramework {
  const cwd = process.cwd()

  // Check for Next.js
  if (
    existsSync(join(cwd, 'next.config.js')) ||
    existsSync(join(cwd, 'next.config.mjs')) ||
    existsSync(join(cwd, 'next.config.ts'))
  ) {
    return 'nextjs'
  }

  // Check for Remix
  if (existsSync(join(cwd, 'remix.config.js')) || existsSync(join(cwd, 'remix.config.mjs'))) {
    return 'remix'
  }

  // Check for Vite
  if (
    existsSync(join(cwd, 'vite.config.ts')) ||
    existsSync(join(cwd, 'vite.config.js')) ||
    existsSync(join(cwd, 'vite.config.mjs'))
  ) {
    return 'vite'
  }

  // Check package.json for framework dependencies
  try {
    const pkgPath = join(cwd, 'package.json')
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies }

      if (allDeps['hono']) return 'hono'
      if (allDeps['express']) return 'express'
      if (allDeps['next']) return 'nextjs'
      if (allDeps['@remix-run/node']) return 'remix'
      if (allDeps['vite']) return 'vite'
    }
  } catch {
    // ignore parse errors
  }

  // Check for plain HTML
  if (existsSync(join(cwd, 'index.html'))) {
    return 'html'
  }

  return 'unknown'
}

// ─── Project Summary ─────────────────────────────────────────────────────────

export interface ProjectSummary {
  name: string
  framework: string
  modules: Record<string, boolean>
  userCount: number
  sessionCount: number
  tableCount: number
  totalRows: number
  dbSize: number
  storageFileCount: number
  storageSize: number
}

export async function getProjectSummary(): Promise<ProjectSummary> {
  const { getConfig, db, auth } = await import('vibekit')
  const config = getConfig()
  const modules = config.modules

  const summary: ProjectSummary = {
    name: config.name,
    framework: config.framework || detectFramework(),
    modules: {
      db: typeof modules.db === 'object' ? modules.db.enabled : !!modules.db,
      auth: typeof modules.auth === 'object' ? modules.auth.enabled : !!modules.auth,
      storage: typeof modules.storage === 'object' ? modules.storage.enabled : !!modules.storage,
      email: typeof modules.email === 'object' ? modules.email.enabled : !!modules.email,
      realtime: !!modules.realtime,
    },
    userCount: 0,
    sessionCount: 0,
    tableCount: 0,
    totalRows: 0,
    dbSize: 0,
    storageFileCount: 0,
    storageSize: 0,
  }

  // Database info
  try {
    const dbPath = config.dbPath
    if (existsSync(dbPath)) {
      summary.dbSize = statSync(dbPath).size
    }

    const tables = await db.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    )
    summary.tableCount = tables.rows.length

    for (const row of tables.rows) {
      try {
        const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${row.name}"`)
        summary.totalRows += countResult?.count ?? 0
      } catch {
        // table might be in a bad state
      }
    }
  } catch {
    // db not initialized
  }

  // User count
  try {
    summary.userCount = await auth.countUsers()
    const sessionResult = await db.queryOne<{ count: number }>('SELECT COUNT(*) as count FROM vibekit_sessions')
    summary.sessionCount = sessionResult?.count ?? 0
  } catch {
    // auth tables may not exist
  }

  // Storage info
  try {
    const storagePath = config.storagePath
    if (existsSync(storagePath)) {
      const { fileCount, totalSize } = getDirectoryStats(storagePath)
      summary.storageFileCount = fileCount
      summary.storageSize = totalSize
    }
  } catch {
    // storage dir may not exist
  }

  return summary
}

// ─── Format Error ────────────────────────────────────────────────────────────

export function formatError(error: unknown): { title: string; message: string; suggestion?: string; code?: string } {
  if (error instanceof VibeKitError) {
    const suggestions: Record<string, string> = {
      CONFIG_NOT_FOUND: 'Run "vibekit init" to create a vibekit.json config file.',
      DB_CONNECTION_FAILED: 'Check that the .vibekit directory exists and the database file is not locked.',
      DB_QUERY_ERROR: 'Check your SQL syntax or table/column names.',
      AUTH_UNAUTHORIZED: 'Include a valid Bearer token in the Authorization header.',
      AUTH_CODE_EXPIRED: 'Request a new verification code.',
      AUTH_CODE_INVALID: 'Double-check the code and try again.',
      AUTH_CODE_MAX_ATTEMPTS: 'Request a new verification code. Max attempts reached.',
      STORAGE_FILE_NOT_FOUND: 'Check the file path and ensure it exists in the storage directory.',
      STORAGE_FILE_TOO_LARGE: 'Reduce the file size or increase maxFileSize in vibekit.json.',
    }

    return {
      title: error.name,
      message: error.message,
      code: error.code,
      suggestion: suggestions[error.code],
    }
  }

  if (error instanceof Error) {
    return {
      title: error.name || 'Error',
      message: error.message,
      suggestion: 'Check the stack trace for more details.',
    }
  }

  return {
    title: 'Unknown Error',
    message: String(error),
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDirectoryStats(dirPath: string): { fileCount: number; totalSize: number } {
  let fileCount = 0
  let totalSize = 0

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name)
      if (entry.isFile()) {
        fileCount++
        try {
          totalSize += statSync(fullPath).size
        } catch {
          // skip unreadable files
        }
      } else if (entry.isDirectory()) {
        const sub = getDirectoryStats(fullPath)
        fileCount += sub.fileCount
        totalSize += sub.totalSize
      }
    }
  } catch {
    // directory not readable
  }

  return { fileCount, totalSize }
}
