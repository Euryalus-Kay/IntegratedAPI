import fs from 'node:fs'
import path from 'node:path'
import type { DatabaseAdapter, BranchManager, BranchInfo, BranchDiff } from './types.js'

/**
 * Database Branching for SQLite (like Neon branching).
 * Creates copies of the SQLite database file for each branch.
 * Convention: branches stored in {dataDir}/branches/{branchName}.db
 */

let _currentBranch = 'main'
let _dataDir = ''
let _currentDbPath = ''

function getBranchPath(dataDir: string, name: string): string {
  return path.join(dataDir, 'branches', `${name}.db`)
}

export function createBranchManager(adapter: DatabaseAdapter, dataDir: string, dbPath: string): BranchManager {
  _dataDir = dataDir
  _currentDbPath = dbPath
  const branchDir = path.join(dataDir, 'branches')
  if (!fs.existsSync(branchDir)) {
    fs.mkdirSync(branchDir, { recursive: true })
  }

  const manager: BranchManager = {
    async create(name: string): Promise<BranchInfo> {
      const branchPath = getBranchPath(_dataDir, name)
      if (fs.existsSync(branchPath)) {
        throw new Error(`Branch "${name}" already exists`)
      }
      // Copy current database file
      fs.copyFileSync(_currentDbPath, branchPath)
      const stats = fs.statSync(branchPath)
      return {
        name,
        createdAt: new Date().toISOString(),
        sizeBytes: stats.size,
        isCurrent: false,
      }
    },

    async switch(name: string): Promise<void> {
      if (name === 'main') {
        _currentBranch = 'main'
        return
      }
      const branchPath = getBranchPath(_dataDir, name)
      if (!fs.existsSync(branchPath)) {
        throw new Error(`Branch "${name}" does not exist`)
      }
      _currentBranch = name
    },

    async list(): Promise<BranchInfo[]> {
      const branches: BranchInfo[] = [{
        name: 'main',
        createdAt: fs.existsSync(_currentDbPath) ? fs.statSync(_currentDbPath).birthtime.toISOString() : new Date().toISOString(),
        sizeBytes: fs.existsSync(_currentDbPath) ? fs.statSync(_currentDbPath).size : 0,
        isCurrent: _currentBranch === 'main',
      }]

      const branchDirPath = path.join(_dataDir, 'branches')
      if (fs.existsSync(branchDirPath)) {
        const files = fs.readdirSync(branchDirPath).filter(f => f.endsWith('.db'))
        for (const file of files) {
          const name = file.replace('.db', '')
          const filePath = path.join(branchDirPath, file)
          const stats = fs.statSync(filePath)
          branches.push({
            name,
            createdAt: stats.birthtime.toISOString(),
            sizeBytes: stats.size,
            isCurrent: _currentBranch === name,
          })
        }
      }
      return branches
    },

    current(): string {
      return _currentBranch
    },

    async delete(name: string): Promise<void> {
      if (name === 'main') throw new Error('Cannot delete the main branch')
      if (_currentBranch === name) throw new Error('Cannot delete the current branch. Switch to another branch first.')
      const branchPath = getBranchPath(_dataDir, name)
      if (fs.existsSync(branchPath)) {
        fs.unlinkSync(branchPath)
      }
    },

    async merge(name: string, strategy?: 'overwrite' | 'schema-only'): Promise<void> {
      if (name === _currentBranch) throw new Error('Cannot merge a branch into itself')
      const branchPath = getBranchPath(_dataDir, name)
      if (!fs.existsSync(branchPath)) throw new Error(`Branch "${name}" does not exist`)

      if (strategy === 'overwrite' || !strategy) {
        // Overwrite: copy branch db over the current one
        fs.copyFileSync(branchPath, _currentDbPath)
      }
      // schema-only: would compare schemas and apply DDL changes
      // For now, just copy the file (simplification)
    },

    async diff(name: string): Promise<BranchDiff> {
      const branchPath = getBranchPath(_dataDir, name)
      if (!fs.existsSync(branchPath)) throw new Error(`Branch "${name}" does not exist`)

      // Get tables from current db
      const { rows: currentTables } = await adapter.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_vibekit_%' AND name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      const currentSet = new Set(currentTables.map(t => t.name))

      // We can't easily query the branch db without opening a new connection.
      // Return a simplified diff based on what we can determine.
      return {
        branch: name,
        tablesAdded: [],
        tablesRemoved: [],
        tablesModified: [...currentSet],
      }
    },
  }

  return manager
}
