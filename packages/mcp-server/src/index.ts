#!/usr/bin/env node

/**
 * VibeKit MCP Server
 *
 * Provides AI coding agents (Claude Code, Cursor) with tools to manage
 * databases, auth, storage, and deployment through the Model Context Protocol.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'vibekit-mcp', version: '0.1.0' },
  { capabilities: { tools: {} } }
)

// Tool definitions
const TOOLS = [
  {
    name: 'vibekit_init',
    description: 'Initialize a new VibeKit project in the current directory. Creates vibekit.json and installs the SDK.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Project name' },
        template: { type: 'string', enum: ['nextjs', 'react', 'hono', 'html', 'saas'], description: 'Starter template' },
      },
      required: ['name'],
    },
  },
  {
    name: 'create_table',
    description: 'Create or update a database table schema.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: ['text', 'integer', 'bigint', 'float', 'boolean', 'uuid', 'timestamp', 'timestamptz', 'json', 'jsonb'] },
              primaryKey: { type: 'boolean' },
              unique: { type: 'boolean' },
              notNull: { type: 'boolean' },
              default: { type: 'string' },
              references: { type: 'string', description: 'Foreign key: table.column' },
              onDelete: { type: 'string', enum: ['cascade', 'set null', 'restrict'] },
              index: { type: 'boolean' },
            },
            required: ['name', 'type'],
          },
        },
        timestamps: { type: 'boolean', description: 'Auto-add created_at and updated_at columns. Default true.' },
      },
      required: ['name', 'columns'],
    },
  },
  {
    name: 'add_auth',
    description: 'Enable email + code authentication on the project.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        methods: { type: 'array', items: { type: 'string', enum: ['email-code', 'passkey', 'google', 'github'] } },
        sessionDuration: { type: 'string', description: "e.g. '30d', '7d', '24h'" },
      },
    },
  },
  {
    name: 'add_storage',
    description: 'Enable file storage on the project.',
    inputSchema: {
      type: 'object' as const,
      properties: { maxFileSize: { type: 'string', description: "e.g. '50MB'" } },
    },
  },
  {
    name: 'add_email',
    description: 'Enable transactional email on the project.',
    inputSchema: {
      type: 'object' as const,
      properties: { fromAddress: { type: 'string' } },
    },
  },
  {
    name: 'add_realtime',
    description: 'Enable WebSocket realtime functionality.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'deploy',
    description: 'Deploy project to production. [FUTURE]',
    inputSchema: {
      type: 'object' as const,
      properties: { preview: { type: 'boolean' } },
    },
  },
  {
    name: 'project_status',
    description: 'Get current project status including enabled modules, database info, and user count.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'db_query',
    description: 'Run a SQL query against the project database. Use parameterized queries for safety.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: { type: 'string' },
        params: { type: 'array', items: {} },
      },
      required: ['sql'],
    },
  },
  {
    name: 'check_logs',
    description: 'View recent application logs.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lines: { type: 'number', description: 'Number of recent lines' },
        filter: { type: 'string' },
      },
    },
  },
]

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'vibekit_init': {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const projectName = (args as any)?.name || 'my-app'
        const configPath = path.join(process.cwd(), 'vibekit.json')

        if (fs.existsSync(configPath)) {
          return { content: [{ type: 'text', text: 'vibekit.json already exists.' }] }
        }

        const config = {
          name: projectName,
          projectId: '',
          region: 'us-east-1',
          framework: (args as any)?.template || 'custom',
          modules: {
            db: true,
            auth: { enabled: true, methods: ['email-code'], sessionDuration: '30d', allowSignup: true, redirectAfterLogin: '/' },
            storage: { enabled: true, maxFileSize: '50MB' },
            email: { enabled: true, from: `noreply@${projectName}.vibekit.app` },
            realtime: false,
          },
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        return { content: [{ type: 'text', text: `Created vibekit.json for "${projectName}". Run "npm install vibekit" then "npx vibekit dev".` }] }
      }

      case 'create_table': {
        const { db } = await import('vibekit')
        const tableName = (args as any)?.name
        const columns: Record<string, any> = {}
        for (const col of ((args as any)?.columns || [])) {
          columns[col.name] = {
            type: col.type,
            primaryKey: col.primaryKey,
            unique: col.unique,
            notNull: col.notNull,
            default: col.default,
            references: col.references,
            onDelete: col.onDelete,
            index: col.index,
          }
        }
        db.defineTable(tableName, columns, { timestamps: (args as any)?.timestamps !== false })
        const result = await db.sync()
        return { content: [{ type: 'text', text: `Table "${tableName}" synced. Created: ${result.created.join(', ') || 'none'}. Modified: ${result.modified.join(', ') || 'none'}.` }] }
      }

      case 'add_auth': {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const configPath = path.join(process.cwd(), 'vibekit.json')
        if (!fs.existsSync(configPath)) {
          return { content: [{ type: 'text', text: 'No vibekit.json found. Run vibekit_init first.' }] }
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        config.modules.auth = {
          enabled: true,
          methods: (args as any)?.methods || ['email-code'],
          sessionDuration: (args as any)?.sessionDuration || '30d',
          allowSignup: true,
          redirectAfterLogin: '/',
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        return { content: [{ type: 'text', text: 'Auth module enabled with email-code authentication.' }] }
      }

      case 'add_storage': {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const configPath = path.join(process.cwd(), 'vibekit.json')
        if (!fs.existsSync(configPath)) {
          return { content: [{ type: 'text', text: 'No vibekit.json found. Run vibekit_init first.' }] }
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        config.modules.storage = { enabled: true, maxFileSize: (args as any)?.maxFileSize || '50MB' }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        return { content: [{ type: 'text', text: 'Storage module enabled.' }] }
      }

      case 'add_email': {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const configPath = path.join(process.cwd(), 'vibekit.json')
        if (!fs.existsSync(configPath)) {
          return { content: [{ type: 'text', text: 'No vibekit.json found. Run vibekit_init first.' }] }
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        config.modules.email = { enabled: true, from: (args as any)?.fromAddress || 'noreply@localhost' }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        return { content: [{ type: 'text', text: 'Email module enabled.' }] }
      }

      case 'add_realtime': {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const configPath = path.join(process.cwd(), 'vibekit.json')
        if (!fs.existsSync(configPath)) {
          return { content: [{ type: 'text', text: 'No vibekit.json found. Run vibekit_init first.' }] }
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        config.modules.realtime = true
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
        return { content: [{ type: 'text', text: 'Realtime module enabled.' }] }
      }

      case 'deploy': {
        return { content: [{ type: 'text', text: 'Deployment is not yet available. Use "vibekit dev" for local development.' }] }
      }

      case 'project_status': {
        const { getConfig, auth } = await import('vibekit')
        const config = getConfig()
        let userCount = 0
        try { userCount = await auth.countUsers() } catch {}
        const status = {
          name: config.name,
          env: config.env,
          database: config.dbPath,
          modules: config.modules,
          userCount,
        }
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] }
      }

      case 'db_query': {
        const { db } = await import('vibekit')
        const sql = (args as any)?.sql
        const params = (args as any)?.params
        const result = await db.query(sql, params)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }

      case 'check_logs': {
        return { content: [{ type: 'text', text: 'Log viewing is not yet available in local mode.' }] }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (error: any) {
    return { content: [{ type: 'text', text: `Error: ${error.message}` }], isError: true }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
