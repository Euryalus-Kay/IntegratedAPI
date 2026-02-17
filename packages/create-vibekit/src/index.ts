#!/usr/bin/env node

/**
 * create-vibekit
 *
 * Scaffolds a new VibeKit project with the chosen template.
 * Usage: npx create-vibekit my-app
 */

import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const args = process.argv.slice(2)
const projectName = args[0]

if (!projectName) {
  console.log('Usage: npx create-vibekit <project-name>')
  console.log('')
  console.log('Example:')
  console.log('  npx create-vibekit my-app')
  process.exit(1)
}

const projectDir = path.join(process.cwd(), projectName)

if (fs.existsSync(projectDir)) {
  console.log(`Directory "${projectName}" already exists.`)
  process.exit(1)
}

console.log(`Creating VibeKit project "${projectName}"...`)
console.log('')

// Create project directory
fs.mkdirSync(projectDir, { recursive: true })

// Create vibekit.json
const vibkitConfig = {
  name: projectName,
  projectId: '',
  region: 'us-east-1',
  framework: 'custom',
  modules: {
    db: true,
    auth: {
      enabled: true,
      methods: ['email-code'],
      sessionDuration: '30d',
      allowSignup: true,
      redirectAfterLogin: '/',
    },
    storage: { enabled: true, maxFileSize: '50MB' },
    email: { enabled: true, from: `noreply@${projectName}.vibekit.app` },
    realtime: false,
  },
}

fs.writeFileSync(
  path.join(projectDir, 'vibekit.json'),
  JSON.stringify(vibkitConfig, null, 2)
)

// Create package.json
const packageJson = {
  name: projectName,
  version: '0.1.0',
  private: true,
  type: 'module',
  scripts: {
    dev: 'vibekit dev',
    build: 'tsc',
    start: 'node dist/index.js',
  },
  dependencies: {
    vibekit: '^0.1.0',
  },
  devDependencies: {
    typescript: '^5.4.0',
    '@types/node': '^20.11.0',
  },
}

fs.writeFileSync(
  path.join(projectDir, 'package.json'),
  JSON.stringify(packageJson, null, 2)
)

// Create tsconfig.json
const tsconfig = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    outDir: 'dist',
    rootDir: 'src',
  },
  include: ['src'],
}

fs.writeFileSync(
  path.join(projectDir, 'tsconfig.json'),
  JSON.stringify(tsconfig, null, 2)
)

// Create src directory and example file
fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true })

const exampleCode = `import { db, auth, storage, email } from 'vibekit'

// Define your database schema
db.defineTable('todos', {
  id: { type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
  title: { type: 'text', notNull: true },
  completed: { type: 'boolean', default: false },
  user_id: { type: 'text' },
})

// Your app code goes here
console.log('VibeKit is ready!')
console.log('Run "npx vibekit dev" to start the development server.')
`

fs.writeFileSync(path.join(projectDir, 'src', 'index.ts'), exampleCode)

// Create .gitignore
fs.writeFileSync(
  path.join(projectDir, '.gitignore'),
  'node_modules/\ndist/\n.vibekit/\n*.db\n.env\n.env.local\n'
)

console.log('  Created vibekit.json')
console.log('  Created package.json')
console.log('  Created tsconfig.json')
console.log('  Created src/index.ts')
console.log('  Created .gitignore')
console.log('')
console.log('Next steps:')
console.log(`  cd ${projectName}`)
console.log('  npm install')
console.log('  npx vibekit dev')
console.log('')
console.log('Happy building!')
