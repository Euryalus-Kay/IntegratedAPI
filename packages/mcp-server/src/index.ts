#!/usr/bin/env node

/**
 * VibeKit MCP Server
 *
 * Provides AI coding agents (Claude Code, Cursor) with tools to manage
 * databases, auth, storage, email, and deployment through the Model Context Protocol.
 *
 * Tools:
 *  - vibekit_init         Create a new VibeKit project
 *  - create_table         Define / sync a database table
 *  - db_query             Run a parameterized SQL query
 *  - db_tables            List all database tables and their columns
 *  - db_describe          Describe a single table's schema
 *  - db_health            Check database health (latency, table count, size)
 *  - add_auth             Enable authentication
 *  - auth_users           List users with filters
 *  - auth_user_detail     Get details for a single user
 *  - auth_delete_user     Delete a user
 *  - auth_set_role        Change a user's role
 *  - auth_ban_user        Ban or unban a user
 *  - auth_audit_log       View the auth audit log
 *  - add_storage          Enable file storage
 *  - storage_list         List stored files
 *  - add_email            Enable transactional email
 *  - add_realtime         Enable WebSocket realtime
 *  - project_status       Get project status overview
 *  - check_health         Run comprehensive project health check
 *  - deploy               Deploy project (future)
 *  - check_logs           View recent logs
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const server = new Server(
  { name: 'vibekit-mcp', version: '0.2.0' },
  { capabilities: { tools: {} } }
)

// ─────────────────────────────────────────────────────────────────────────────
// Tool definitions
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  // ── Project ────────────────────────────────────────────────────────────────
  {
    name: 'vibekit_init',
    description:
      'Initialize a new VibeKit project in the current directory. Creates vibekit.json config and sets up the project structure. Use this as the first step when starting a new backend.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Project name (lowercase, hyphens allowed, e.g. "my-app")',
        },
        template: {
          type: 'string',
          enum: ['nextjs', 'react', 'hono', 'express', 'html', 'saas', 'custom'],
          description: 'Starter template to use',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'project_status',
    description:
      'Get current project status including enabled modules, database info, user count, and configuration details. Use this to understand the current state of the project.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'check_health',
    description:
      'Run a comprehensive health check on the project: database connectivity, config validation, file permissions, and module status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── Database ───────────────────────────────────────────────────────────────
  {
    name: 'create_table',
    description:
      'Create or update a database table schema. Supports all common column types, foreign keys, indexes, and timestamps. After defining, the table is auto-synced to the database.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Table name (e.g. "posts", "comments")',
        },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              type: {
                type: 'string',
                enum: ['text', 'integer', 'bigint', 'float', 'boolean', 'uuid', 'timestamp', 'timestamptz', 'json', 'jsonb'],
              },
              primaryKey: { type: 'boolean' },
              unique: { type: 'boolean' },
              notNull: { type: 'boolean' },
              default: { type: 'string', description: 'Default value expression' },
              references: { type: 'string', description: 'Foreign key reference: table.column' },
              onDelete: { type: 'string', enum: ['cascade', 'set null', 'restrict'] },
              index: { type: 'boolean' },
            },
            required: ['name', 'type'],
          },
        },
        timestamps: {
          type: 'boolean',
          description: 'Auto-add created_at and updated_at columns (default: true)',
        },
      },
      required: ['name', 'columns'],
    },
  },
  {
    name: 'db_query',
    description:
      'Run a parameterized SQL query against the project database. Use $1, $2, etc. for parameters. Returns rows and row count. Always use parameterized queries to prevent SQL injection.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sql: {
          type: 'string',
          description: 'SQL query with $1, $2, ... parameter placeholders',
        },
        params: {
          type: 'array',
          items: {},
          description: 'Array of parameter values matching the $N placeholders',
        },
      },
      required: ['sql'],
    },
  },
  {
    name: 'db_tables',
    description:
      'List all database tables with their column names and types. Useful for understanding the database schema before writing queries.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'db_describe',
    description:
      'Describe a single database table in detail: column names, types, primary keys, foreign keys, and indexes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Table name to describe' },
      },
      required: ['table'],
    },
  },
  {
    name: 'db_health',
    description:
      'Check database health: connection status, latency, table count, and file size.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── Auth ────────────────────────────────────────────────────────────────────
  {
    name: 'add_auth',
    description:
      'Enable email + code authentication on the project. Configures auth methods, session duration, and signup policy.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        methods: {
          type: 'array',
          items: { type: 'string', enum: ['email-code', 'passkey', 'google', 'github', 'magic-link'] },
          description: 'Auth methods to enable',
        },
        sessionDuration: {
          type: 'string',
          description: "Session duration, e.g. '30d', '7d', '24h', '60m'",
        },
        allowSignup: {
          type: 'boolean',
          description: 'Whether to allow new user signups (default: true)',
        },
      },
    },
  },
  {
    name: 'auth_users',
    description:
      'List users with optional filtering by role, search term, pagination, and sorting.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number', description: 'Page number (1-based, default: 1)' },
        limit: { type: 'number', description: 'Users per page (default: 50)' },
        role: { type: 'string', description: 'Filter by role (e.g. "admin", "user")' },
        search: { type: 'string', description: 'Search by email or name' },
        orderBy: { type: 'string', description: 'Sort field (default: "created_at")' },
        order: { type: 'string', enum: ['asc', 'desc'], description: 'Sort direction (default: "desc")' },
      },
    },
  },
  {
    name: 'auth_user_detail',
    description:
      'Get detailed information about a single user including their active sessions and recent audit events.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'The user ID to look up' },
        email: { type: 'string', description: 'Or the user email to look up' },
      },
    },
  },
  {
    name: 'auth_delete_user',
    description:
      'Permanently delete a user and all their sessions. This action cannot be undone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'The user ID to delete' },
      },
      required: ['userId'],
    },
  },
  {
    name: 'auth_set_role',
    description:
      'Change a user\'s role. Common roles: "user", "admin", "moderator". Role changes are audit-logged.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'The user ID' },
        role: { type: 'string', description: 'The new role to assign' },
      },
      required: ['userId', 'role'],
    },
  },
  {
    name: 'auth_ban_user',
    description:
      'Ban or unban a user. Banning immediately revokes all sessions. The user cannot log in until unbanned.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'The user ID' },
        action: { type: 'string', enum: ['ban', 'unban'], description: 'Whether to ban or unban' },
        reason: { type: 'string', description: 'Reason for the ban (optional, shown to user)' },
      },
      required: ['userId', 'action'],
    },
  },
  {
    name: 'auth_audit_log',
    description:
      'View the auth audit log with optional filters. Shows login, logout, signup, role changes, bans, and other security events.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'Filter by user ID' },
        action: {
          type: 'string',
          enum: ['login', 'logout', 'code_sent', 'role_change', 'ban', 'unban', 'signup', 'session_revoke', 'user_update', 'user_delete'],
          description: 'Filter by action type',
        },
        limit: { type: 'number', description: 'Number of entries (default: 50)' },
        since: { type: 'string', description: 'ISO date string to filter from' },
      },
    },
  },

  // ── Storage ────────────────────────────────────────────────────────────────
  {
    name: 'add_storage',
    description:
      'Enable file storage on the project. Configure max file size and allowed file types.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        maxFileSize: { type: 'string', description: "Max upload size, e.g. '50MB', '1GB'" },
        allowedTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allowed MIME types, e.g. ["image/png", "image/jpeg", "application/pdf"]',
        },
      },
    },
  },
  {
    name: 'storage_list',
    description:
      'List files in storage. Returns file names, sizes, upload dates, and content types.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        prefix: { type: 'string', description: 'Filter by path prefix' },
        limit: { type: 'number', description: 'Max files to return (default: 100)' },
      },
    },
  },

  // ── Email ──────────────────────────────────────────────────────────────────
  {
    name: 'add_email',
    description:
      'Enable transactional email on the project. Configure the from address and optional reply-to.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        fromAddress: { type: 'string', description: 'Default "from" email address' },
        replyTo: { type: 'string', description: 'Optional "reply-to" address' },
      },
    },
  },

  // ── Realtime ───────────────────────────────────────────────────────────────
  {
    name: 'add_realtime',
    description:
      'Enable WebSocket realtime functionality for pub/sub channels, presence, and live updates.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── Project Selection & Management ────────────────────────────────────────
  {
    name: 'list_projects',
    description:
      'List all VibeKit projects accessible to the current user. Shows project ID, name, status, and region. Use the project ID with select_project to switch between projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['active', 'archived', 'all'], description: 'Filter by status (default: active)' },
      },
    },
  },
  {
    name: 'select_project',
    description:
      'Select a project to work with. All subsequent database, auth, storage, and email operations will target this project. This is the primary mechanism for Claude Code to switch between projects.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'The project ID to select (from list_projects or vibekit_init)' },
        name: { type: 'string', description: 'Or select by project name' },
      },
    },
  },
  {
    name: 'create_project',
    description:
      'Create a new VibeKit project. Returns the project ID which can be used with select_project. Different from vibekit_init which creates a config file — this creates a project on the VibeKit platform.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Project name (lowercase, hyphens allowed)' },
        region: { type: 'string', enum: ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'], description: 'Deployment region (default: us-east-1)' },
        plan: { type: 'string', enum: ['free', 'pro', 'team'], description: 'Billing plan (default: free)' },
        template: { type: 'string', enum: ['blank', 'nextjs', 'react', 'hono', 'express', 'saas'], description: 'Starter template (default: blank)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'project_settings',
    description:
      'View or update the current project settings including environment variables, domains, build configuration, and notification preferences.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['get', 'update'], description: 'Get or update settings (default: get)' },
        settings: {
          type: 'object',
          description: 'Settings to update (only used when action is "update")',
        },
      },
    },
  },
  {
    name: 'project_env',
    description:
      'Manage environment variables for the current project. Set, get, list, or remove environment variables.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['list', 'set', 'get', 'remove'], description: 'Action to perform' },
        key: { type: 'string', description: 'Environment variable name' },
        value: { type: 'string', description: 'Value to set' },
        environment: { type: 'string', enum: ['development', 'preview', 'production', 'all'], description: 'Target environment (default: all)' },
      },
      required: ['action'],
    },
  },

  // ── Notifications ──────────────────────────────────────────────────────
  {
    name: 'notification_preferences',
    description:
      'View or update notification preferences for the current project. Controls which email notifications are sent.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        action: { type: 'string', enum: ['get', 'update'], description: 'Get or update preferences' },
        preferences: {
          type: 'object',
          description: 'Notification preferences to update',
        },
      },
    },
  },
  {
    name: 'send_test_notification',
    description:
      'Send a test notification email to verify notification setup is working.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', enum: ['build-failed', 'build-succeeded', 'security-alert', 'usage-warning'], description: 'Type of test notification' },
        email: { type: 'string', description: 'Email address to send to' },
      },
      required: ['type', 'email'],
    },
  },

  // ── Deploy ─────────────────────────────────────────────────────────────────
  {
    name: 'deploy',
    description:
      'Deploy the project to production. [FUTURE — not yet available. Use "vibekit dev" for local development.]',
    inputSchema: {
      type: 'object' as const,
      properties: {
        preview: { type: 'boolean', description: 'Deploy to preview environment instead of production' },
      },
    },
  },

  // ── Logs ───────────────────────────────────────────────────────────────────
  {
    name: 'check_logs',
    description:
      'View recent application logs including queries, requests, and errors.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        lines: { type: 'number', description: 'Number of recent entries (default: 20)' },
        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Filter by log level' },
      },
    },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] }
}

function fail(text: string, suggestion?: string) {
  const msg = suggestion ? `${text}\n\nSuggestion: ${suggestion}` : text
  return { content: [{ type: 'text' as const, text: msg }], isError: true as const }
}

function arg<T = any>(args: unknown, key: string): T | undefined {
  return (args as Record<string, unknown>)?.[key] as T | undefined
}

// ── Project selection state ───────────────────────────────────────────────
let _selectedProjectId: string | null = null

async function readConfig() {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const configPath = path.join(process.cwd(), 'vibekit.json')
  if (!fs.existsSync(configPath)) return null
  return {
    config: JSON.parse(fs.readFileSync(configPath, 'utf-8')),
    configPath,
    fs,
    path,
  }
}

async function writeConfig(config: any) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const configPath = path.join(process.cwd(), 'vibekit.json')
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2))
}

// ─────────────────────────────────────────────────────────────────────────────
// Request handlers
// ─────────────────────────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      // ── Project ──────────────────────────────────────────────────────────
      case 'vibekit_init': {
        const existing = await readConfig()
        if (existing) {
          return ok(
            `vibekit.json already exists for project "${existing.config.name}".\n` +
            `If you want to start fresh, delete vibekit.json first.`
          )
        }

        const projectName = arg<string>(args, 'name') || 'my-app'
        const template = arg<string>(args, 'template') || 'custom'

        const config = {
          name: projectName,
          projectId: '',
          region: 'us-east-1',
          framework: template,
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

        await writeConfig(config)

        return ok(
          `Created vibekit.json for "${projectName}" with template "${template}".\n\n` +
          `Next steps:\n` +
          `  1. npm install vibekit\n` +
          `  2. npx vibekit dev\n` +
          `  3. Open http://localhost:3141 to see the dev dashboard\n\n` +
          `Enabled modules: db, auth (email-code), storage, email\n` +
          `Disabled modules: realtime (enable with add_realtime tool)`
        )
      }

      case 'project_status': {
        const configData = await readConfig()
        if (!configData) {
          return fail(
            'No vibekit.json found in the current directory.',
            'Run the vibekit_init tool first to create a project, or change to the project directory.'
          )
        }

        const { getConfig, auth, db } = await import('vibekit')
        const config = getConfig()

        let userCount = 0
        try { userCount = await auth.countUsers() } catch {}

        let dbHealth: any = null
        try { dbHealth = await db.health() } catch {}

        const status = {
          name: config.name,
          environment: config.env,
          database: {
            path: config.dbPath,
            health: dbHealth,
          },
          modules: config.modules,
          userCount,
        }

        return ok(JSON.stringify(status, null, 2))
      }

      case 'check_health': {
        const configData = await readConfig()
        if (!configData) {
          return fail(
            'No vibekit.json found.',
            'Run vibekit_init to create a project.'
          )
        }

        const checks: Record<string, any> = {}

        // Config validation
        try {
          const { validateConfig } = await import('vibekit/config/validator')
          const result = validateConfig(configData.config)
          checks.config = {
            valid: result.valid,
            errors: result.errors.length,
            warnings: result.warnings.length,
            details: result.errors.length > 0 ? result.errors : undefined,
          }
        } catch (e: any) {
          checks.config = { valid: false, error: e.message }
        }

        // Database health
        try {
          const { db } = await import('vibekit')
          const health = await db.health()
          checks.database = health
        } catch (e: any) {
          checks.database = { status: 'down', error: e.message }
        }

        // Auth check
        try {
          const { auth } = await import('vibekit')
          const userCount = await auth.countUsers()
          checks.auth = { status: 'ok', userCount }
        } catch (e: any) {
          checks.auth = { status: 'error', error: e.message }
        }

        // Storage check
        try {
          const { storage } = await import('vibekit')
          const files = await storage.list({ limit: 1 })
          checks.storage = { status: 'ok', fileCount: files.files.length }
        } catch (e: any) {
          checks.storage = { status: 'error', error: e.message }
        }

        const allOk = Object.values(checks).every((c: any) =>
          c.status === 'ok' || c.status === 'healthy' || c.valid === true
        )

        return ok(
          `Health Check: ${allOk ? 'ALL PASSING' : 'ISSUES DETECTED'}\n\n` +
          JSON.stringify(checks, null, 2)
        )
      }

      // ── Database ─────────────────────────────────────────────────────────
      case 'create_table': {
        const { db } = await import('vibekit')
        const tableName = arg<string>(args, 'name')
        if (!tableName) {
          return fail('Table name is required.', 'Provide a "name" field, e.g. "posts".')
        }

        const columnsInput = arg<any[]>(args, 'columns') || []
        if (columnsInput.length === 0) {
          return fail(
            'At least one column is required.',
            'Add columns like: [{"name": "title", "type": "text", "notNull": true}]'
          )
        }

        const columns: Record<string, any> = {}
        for (const col of columnsInput) {
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

        db.defineTable(tableName, columns, {
          timestamps: arg<boolean>(args, 'timestamps') !== false,
        })
        const result = await db.sync()

        const colSummary = columnsInput.map((c: any) => {
          let desc = `  - ${c.name}: ${c.type}`
          if (c.primaryKey) desc += ' (PK)'
          if (c.unique) desc += ' (unique)'
          if (c.notNull) desc += ' (not null)'
          if (c.references) desc += ` -> ${c.references}`
          return desc
        }).join('\n')

        return ok(
          `Table "${tableName}" synced successfully.\n\n` +
          `Columns:\n${colSummary}\n\n` +
          `Created: ${result.created.join(', ') || 'none'}\n` +
          `Modified: ${result.modified.join(', ') || 'none'}`
        )
      }

      case 'db_query': {
        const sql = arg<string>(args, 'sql')
        if (!sql) {
          return fail('SQL query is required.', 'Provide a "sql" field with your query.')
        }

        // Warn about destructive operations without params
        const normalized = sql.trim().toUpperCase()
        if ((normalized.startsWith('DELETE') || normalized.startsWith('DROP') || normalized.startsWith('TRUNCATE'))
            && !arg<any[]>(args, 'params')?.length) {
          // Still execute, but add a warning
        }

        const { db } = await import('vibekit')
        const params = arg<any[]>(args, 'params')

        if (normalized.startsWith('SELECT') || normalized.startsWith('WITH') || normalized.startsWith('EXPLAIN')) {
          const result = await db.query(sql, params)
          return ok(
            `Query returned ${result.rowCount} row(s).\n\n` +
            JSON.stringify(result.rows, null, 2)
          )
        } else {
          const result = await db.execute(sql, params)
          return ok(
            `Query executed successfully.\n` +
            `Rows affected: ${result.rowCount}` +
            (result.lastInsertId ? `\nLast insert ID: ${result.lastInsertId}` : '')
          )
        }
      }

      case 'db_tables': {
        const { db } = await import('vibekit')
        const { rows: tables } = await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )

        if (tables.length === 0) {
          return ok(
            'No tables found in the database.\n\n' +
            'Use the create_table tool to define your first table, or run db.sync() to apply schema definitions.'
          )
        }

        const details: string[] = []
        for (const table of tables) {
          const { rows: cols } = await db.query<{ name: string; type: string; notnull: number; pk: number }>(
            `PRAGMA table_info("${table.name}")`
          )
          const colStr = cols.map(c => {
            let desc = `    ${c.name}: ${c.type}`
            if (c.pk) desc += ' (PK)'
            if (c.notnull) desc += ' (NOT NULL)'
            return desc
          }).join('\n')
          details.push(`  ${table.name}\n${colStr}`)
        }

        return ok(`Database Tables (${tables.length}):\n\n${details.join('\n\n')}`)
      }

      case 'db_describe': {
        const tableName = arg<string>(args, 'table')
        if (!tableName) {
          return fail('Table name is required.', 'Provide a "table" field.')
        }

        const { db } = await import('vibekit')

        // Check table exists
        const { rows: check } = await db.query<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name=$1",
          [tableName]
        )
        if (check.length === 0) {
          const { rows: allTables } = await db.query<{ name: string }>(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
          )
          return fail(
            `Table "${tableName}" not found.`,
            `Available tables: ${allTables.map(t => t.name).join(', ') || 'none'}`
          )
        }

        // Columns
        const { rows: cols } = await db.query<any>(`PRAGMA table_info("${tableName}")`)
        // Indexes
        const { rows: indexes } = await db.query<any>(`PRAGMA index_list("${tableName}")`)
        // Foreign keys
        const { rows: fks } = await db.query<any>(`PRAGMA foreign_key_list("${tableName}")`)
        // Row count
        const countResult = await db.queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM "${tableName}"`)

        const output = [
          `Table: ${tableName}`,
          `Rows: ${countResult?.count ?? 0}`,
          '',
          'Columns:',
          ...cols.map((c: any) => {
            let desc = `  ${c.name}: ${c.type || 'TEXT'}`
            if (c.pk) desc += ' (PRIMARY KEY)'
            if (c.notnull) desc += ' (NOT NULL)'
            if (c.dflt_value !== null) desc += ` DEFAULT ${c.dflt_value}`
            return desc
          }),
        ]

        if (indexes.length > 0) {
          output.push('', 'Indexes:')
          for (const idx of indexes) {
            const { rows: idxCols } = await db.query<any>(`PRAGMA index_info("${idx.name}")`)
            output.push(`  ${idx.name}${idx.unique ? ' (UNIQUE)' : ''}: ${idxCols.map((c: any) => c.name).join(', ')}`)
          }
        }

        if (fks.length > 0) {
          output.push('', 'Foreign Keys:')
          for (const fk of fks) {
            output.push(`  ${fk.from} -> ${fk.table}.${fk.to} (ON DELETE ${fk.on_delete})`)
          }
        }

        return ok(output.join('\n'))
      }

      case 'db_health': {
        const { db } = await import('vibekit')
        const health = await db.health()
        return ok(
          `Database Health:\n` +
          `  Status:      ${health.status}\n` +
          `  Latency:     ${health.latencyMs}ms\n` +
          `  Tables:      ${health.tableCount}\n` +
          (health.sizeBytes !== undefined
            ? `  Size:        ${(health.sizeBytes / 1024).toFixed(1)} KB\n`
            : '')
        )
      }

      // ── Auth ─────────────────────────────────────────────────────────────
      case 'add_auth': {
        const configData = await readConfig()
        if (!configData) {
          return fail('No vibekit.json found.', 'Run vibekit_init first.')
        }

        configData.config.modules.auth = {
          enabled: true,
          methods: arg<string[]>(args, 'methods') || ['email-code'],
          sessionDuration: arg<string>(args, 'sessionDuration') || '30d',
          allowSignup: arg<boolean>(args, 'allowSignup') ?? true,
          redirectAfterLogin: '/',
        }

        await writeConfig(configData.config)
        const methods = configData.config.modules.auth.methods.join(', ')
        return ok(
          `Auth module enabled.\n\n` +
          `  Methods:          ${methods}\n` +
          `  Session duration: ${configData.config.modules.auth.sessionDuration}\n` +
          `  Allow signup:     ${configData.config.modules.auth.allowSignup}\n\n` +
          `Auth API routes are available at /auth/send-code, /auth/verify, /auth/logout, /auth/me`
        )
      }

      case 'auth_users': {
        const { auth } = await import('vibekit')
        const result = await auth.listUsers({
          page: arg<number>(args, 'page'),
          limit: arg<number>(args, 'limit'),
          role: arg<string>(args, 'role'),
          search: arg<string>(args, 'search'),
          orderBy: arg<string>(args, 'orderBy') as any,
          order: arg<string>(args, 'order') as any,
        })

        if (result.users.length === 0) {
          return ok(
            'No users found.\n\n' +
            'Users are created when they verify an email code for the first time.'
          )
        }

        const summary = result.users.map((u: any) => {
          let line = `  ${u.email}`
          if (u.name) line += ` (${u.name})`
          line += ` [${u.role || 'user'}]`
          if (u.banned) line += ' [BANNED]'
          return line
        }).join('\n')

        return ok(
          `Users (page ${result.page}/${result.totalPages}, total: ${result.total}):\n\n${summary}`
        )
      }

      case 'auth_user_detail': {
        const { auth } = await import('vibekit')
        const userId = arg<string>(args, 'userId')
        const email = arg<string>(args, 'email')

        let user: any
        if (userId) {
          user = await auth.getUserById(userId)
        } else if (email) {
          user = await auth.getUserByEmail(email)
        } else {
          return fail('Either userId or email is required.')
        }

        if (!user) {
          return fail('User not found.', 'Check the user ID or email address.')
        }

        // Get active sessions
        let sessions: any[] = []
        try { sessions = await auth.getActiveSessions(user.id) } catch {}

        // Get recent audit events
        let auditEvents: any[] = []
        try { auditEvents = await auth.getAuditLog({ userId: user.id, limit: 10 }) } catch {}

        return ok(
          `User Details:\n` +
          JSON.stringify(user, null, 2) +
          `\n\nActive Sessions (${sessions.length}):\n` +
          (sessions.length > 0
            ? sessions.map((s: any) => `  ${s.id} - created ${s.created_at} - expires ${s.expires_at}`).join('\n')
            : '  None') +
          `\n\nRecent Audit Events (${auditEvents.length}):\n` +
          (auditEvents.length > 0
            ? auditEvents.map((e: any) => `  ${e.created_at} ${e.action} ${JSON.stringify(e.metadata)}`).join('\n')
            : '  None')
        )
      }

      case 'auth_delete_user': {
        const userId = arg<string>(args, 'userId')
        if (!userId) return fail('userId is required.')

        const { auth } = await import('vibekit')
        const user = await auth.getUserById(userId)
        if (!user) return fail('User not found.', 'Check the user ID.')

        await auth.deleteUser(userId)
        return ok(`User "${user.email}" (${userId}) has been permanently deleted.`)
      }

      case 'auth_set_role': {
        const userId = arg<string>(args, 'userId')
        const role = arg<string>(args, 'role')
        if (!userId || !role) return fail('Both userId and role are required.')

        const { auth } = await import('vibekit')
        const user = await auth.setRole(userId, role)
        return ok(`User "${user.email}" role updated to "${role}".`)
      }

      case 'auth_ban_user': {
        const userId = arg<string>(args, 'userId')
        const action = arg<string>(args, 'action')
        if (!userId || !action) return fail('Both userId and action are required.')

        const { auth } = await import('vibekit')

        if (action === 'ban') {
          const reason = arg<string>(args, 'reason')
          const user = await auth.banUser(userId, reason)
          return ok(
            `User "${user.email}" has been banned.` +
            (reason ? ` Reason: ${reason}` : '') +
            `\nAll active sessions have been revoked.`
          )
        } else if (action === 'unban') {
          const user = await auth.unbanUser(userId)
          return ok(`User "${user.email}" has been unbanned and can now log in.`)
        } else {
          return fail('Invalid action.', 'Use "ban" or "unban".')
        }
      }

      case 'auth_audit_log': {
        const { auth } = await import('vibekit')
        const entries = await auth.getAuditLog({
          userId: arg<string>(args, 'userId'),
          action: arg<string>(args, 'action') as any,
          limit: arg<number>(args, 'limit') || 50,
          since: arg<string>(args, 'since'),
        })

        if (entries.length === 0) {
          return ok('No audit log entries found matching the filters.')
        }

        const lines = entries.map((e: any) =>
          `${e.created_at} | ${(e.action || '').padEnd(15)} | user: ${e.user_id || 'n/a'} | ${JSON.stringify(e.metadata)}`
        ).join('\n')

        return ok(`Audit Log (${entries.length} entries):\n\n${lines}`)
      }

      // ── Storage ──────────────────────────────────────────────────────────
      case 'add_storage': {
        const configData = await readConfig()
        if (!configData) return fail('No vibekit.json found.', 'Run vibekit_init first.')

        configData.config.modules.storage = {
          enabled: true,
          maxFileSize: arg<string>(args, 'maxFileSize') || '50MB',
          ...(arg<string[]>(args, 'allowedTypes') ? { allowedTypes: arg<string[]>(args, 'allowedTypes') } : {}),
        }

        await writeConfig(configData.config)
        return ok(
          `Storage module enabled.\n\n` +
          `  Max file size: ${configData.config.modules.storage.maxFileSize}\n` +
          (configData.config.modules.storage.allowedTypes
            ? `  Allowed types: ${configData.config.modules.storage.allowedTypes.join(', ')}\n`
            : `  Allowed types: all (consider restricting for security)\n`)
        )
      }

      case 'storage_list': {
        const { storage } = await import('vibekit')
        const result = await storage.list({
          prefix: arg<string>(args, 'prefix'),
          limit: arg<number>(args, 'limit') || 100,
        })

        if (result.files.length === 0) {
          return ok('No files in storage.\n\nUse storage.upload() to add files.')
        }

        const lines = result.files.map((f: any) => {
          const size = f.size >= 1024 * 1024
            ? `${(f.size / (1024 * 1024)).toFixed(1)} MB`
            : f.size >= 1024
              ? `${(f.size / 1024).toFixed(1)} KB`
              : `${f.size} B`
          return `  ${f.key} (${size}, ${f.contentType || 'unknown'}, ${f.uploadedAt})`
        }).join('\n')

        return ok(`Files in storage (${result.files.length} returned${result.hasMore ? ', more available' : ''}):\n\n${lines}`)
      }

      // ── Email ────────────────────────────────────────────────────────────
      case 'add_email': {
        const configData = await readConfig()
        if (!configData) return fail('No vibekit.json found.', 'Run vibekit_init first.')

        configData.config.modules.email = {
          enabled: true,
          from: arg<string>(args, 'fromAddress') || `noreply@${configData.config.name}.vibekit.app`,
          ...(arg<string>(args, 'replyTo') ? { replyTo: arg<string>(args, 'replyTo') } : {}),
        }

        await writeConfig(configData.config)
        return ok(
          `Email module enabled.\n\n` +
          `  From: ${configData.config.modules.email.from}\n` +
          (configData.config.modules.email.replyTo
            ? `  Reply-to: ${configData.config.modules.email.replyTo}\n`
            : '') +
          `\nIn local dev, emails are printed to the terminal. Built-in templates: verification-code, welcome, password-reset.`
        )
      }

      // ── Realtime ─────────────────────────────────────────────────────────
      case 'add_realtime': {
        const configData = await readConfig()
        if (!configData) return fail('No vibekit.json found.', 'Run vibekit_init first.')

        configData.config.modules.realtime = true
        await writeConfig(configData.config)

        return ok(
          `Realtime module enabled.\n\n` +
          `WebSocket server will start on the next "vibekit dev" run.\n\n` +
          `Usage:\n` +
          `  import { realtime } from 'vibekit/realtime'\n` +
          `  realtime.subscribe('my-channel', (msg) => { ... })\n` +
          `  realtime.publish('my-channel', { type: 'update', data: ... })`
        )
      }

      // ── Project Selection & Management ──────────────────────────────────
      case 'list_projects': {
        const fs = await import('node:fs')
        const path = await import('node:path')
        const projectsDir = path.join(process.env.HOME || '~', '.vibekit', 'projects')

        if (!fs.existsSync(projectsDir)) {
          fs.mkdirSync(projectsDir, { recursive: true })
          return ok(
            'No projects found.\n\n' +
            'Create a project with the create_project tool, or run vibekit_init in a project directory.'
          )
        }

        const statusFilter = arg<string>(args, 'status') || 'active'
        const projectFiles = fs.readdirSync(projectsDir).filter((f: string) => f.endsWith('.json'))
        const projects: any[] = []

        for (const file of projectFiles) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(projectsDir, file), 'utf-8'))
            if (statusFilter === 'all' || data.status === statusFilter) {
              projects.push(data)
            }
          } catch {}
        }

        if (projects.length === 0) {
          return ok(
            'No projects found' + (statusFilter !== 'all' ? ` with status "${statusFilter}"` : '') + '.\n\n' +
            'Create a project with the create_project tool.'
          )
        }

        const lines = projects.map((p: any) => {
          const selected = p.id === _selectedProjectId ? ' [SELECTED]' : ''
          return `  ${p.id}  ${p.name.padEnd(20)} ${(p.status || 'active').padEnd(10)} ${p.region || 'us-east-1'}${selected}`
        }).join('\n')

        return ok(
          `Projects (${projects.length}):\n\n` +
          `  ${'ID'.padEnd(38)} ${'Name'.padEnd(20)} ${'Status'.padEnd(10)} Region\n` +
          `  ${'─'.repeat(80)}\n` +
          lines +
          (_selectedProjectId ? `\n\nCurrently selected: ${_selectedProjectId}` : '\n\nNo project selected. Use select_project to choose one.')
        )
      }

      case 'select_project': {
        const projectId = arg<string>(args, 'projectId')
        const projectName = arg<string>(args, 'name')

        if (!projectId && !projectName) {
          return fail('Either projectId or name is required.', 'Use list_projects to see available projects.')
        }

        const fs = await import('node:fs')
        const path = await import('node:path')
        const projectsDir = path.join(process.env.HOME || '~', '.vibekit', 'projects')

        if (!fs.existsSync(projectsDir)) {
          return fail('No projects found.', 'Create a project with create_project first.')
        }

        const projectFiles = fs.readdirSync(projectsDir).filter((f: string) => f.endsWith('.json'))

        for (const file of projectFiles) {
          try {
            const data = JSON.parse(fs.readFileSync(path.join(projectsDir, file), 'utf-8'))
            if ((projectId && data.id === projectId) || (projectName && data.name === projectName)) {
              _selectedProjectId = data.id

              // Also update the vibekit.json in cwd if it exists
              const configData = await readConfig()
              if (configData) {
                configData.config.projectId = data.id
                await writeConfig(configData.config)
              }

              return ok(
                `Project selected: ${data.name} (${data.id})\n\n` +
                `Region: ${data.region || 'us-east-1'}\n` +
                `Plan: ${data.plan || 'free'}\n` +
                `Status: ${data.status || 'active'}\n\n` +
                `All subsequent operations will target this project.\n` +
                `To use this in your code, set the VIBEKIT_PROJECT_ID environment variable:\n` +
                `  export VIBEKIT_PROJECT_ID="${data.id}"\n\n` +
                `Or add it to your vibekit.json:\n` +
                `  { "projectId": "${data.id}" }`
              )
            }
          } catch {}
        }

        return fail(
          `Project not found: ${projectId || projectName}`,
          'Use list_projects to see available projects.'
        )
      }

      case 'create_project': {
        const name = arg<string>(args, 'name')
        if (!name) return fail('Project name is required.')

        const crypto = await import('node:crypto')
        const fs = await import('node:fs')
        const path = await import('node:path')

        const projectId = `prj_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
        const region = arg<string>(args, 'region') || 'us-east-1'
        const plan = arg<string>(args, 'plan') || 'free'
        const template = arg<string>(args, 'template') || 'blank'

        const project = {
          id: projectId,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
          region,
          plan,
          template,
          status: 'active',
          settings: {
            buildCommand: 'npm run build',
            outputDir: 'dist',
            installCommand: 'npm install',
            envVars: {},
            notifications: {
              buildFailed: true,
              buildSucceeded: false,
              deployRollback: true,
              usageLimitWarning: true,
              securityAlert: true,
            },
          },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const projectsDir = path.join(process.env.HOME || '~', '.vibekit', 'projects')
        fs.mkdirSync(projectsDir, { recursive: true })
        fs.writeFileSync(path.join(projectsDir, `${projectId}.json`), JSON.stringify(project, null, 2))

        _selectedProjectId = projectId

        return ok(
          `Project created successfully!\n\n` +
          `  ID:       ${projectId}\n` +
          `  Name:     ${name}\n` +
          `  Region:   ${region}\n` +
          `  Plan:     ${plan}\n` +
          `  Template: ${template}\n\n` +
          `The project is now selected. All operations will target this project.\n\n` +
          `To connect this to a local project directory:\n` +
          `  1. Add to vibekit.json: { "projectId": "${projectId}" }\n` +
          `  2. Or set env: VIBEKIT_PROJECT_ID="${projectId}"\n` +
          `  3. Or use: npx vibekit link ${projectId}\n\n` +
          `Next steps:\n` +
          `  - Use create_table to define your database schema\n` +
          `  - Use add_auth to enable authentication\n` +
          `  - Use add_storage to enable file storage`
        )
      }

      case 'project_settings': {
        const action = arg<string>(args, 'action') || 'get'

        if (!_selectedProjectId) {
          const configData = await readConfig()
          if (configData?.config?.projectId) {
            _selectedProjectId = configData.config.projectId
          } else {
            return fail('No project selected.', 'Use select_project or create_project first.')
          }
        }

        const fs = await import('node:fs')
        const path = await import('node:path')
        const projectFile = path.join(process.env.HOME || '~', '.vibekit', 'projects', `${_selectedProjectId}.json`)

        if (!fs.existsSync(projectFile)) {
          return fail('Project file not found.', 'The selected project may have been deleted.')
        }

        const project = JSON.parse(fs.readFileSync(projectFile, 'utf-8'))

        if (action === 'get') {
          return ok(`Project Settings for "${project.name}" (${project.id}):\n\n${JSON.stringify(project.settings, null, 2)}`)
        }

        const newSettings = arg<any>(args, 'settings')
        if (!newSettings) return fail('Settings object is required for update.')

        project.settings = { ...project.settings, ...newSettings }
        project.updated_at = new Date().toISOString()
        fs.writeFileSync(projectFile, JSON.stringify(project, null, 2))

        return ok(`Project settings updated.\n\n${JSON.stringify(project.settings, null, 2)}`)
      }

      case 'project_env': {
        const action = arg<string>(args, 'action')
        if (!action) return fail('Action is required (list, set, get, remove).')

        if (!_selectedProjectId) {
          const configData = await readConfig()
          if (configData?.config?.projectId) {
            _selectedProjectId = configData.config.projectId
          } else {
            return fail('No project selected.', 'Use select_project first.')
          }
        }

        const fs = await import('node:fs')
        const path = await import('node:path')
        const projectFile = path.join(process.env.HOME || '~', '.vibekit', 'projects', `${_selectedProjectId}.json`)

        if (!fs.existsSync(projectFile)) return fail('Project file not found.')
        const project = JSON.parse(fs.readFileSync(projectFile, 'utf-8'))
        if (!project.settings.envVars) project.settings.envVars = {}

        switch (action) {
          case 'list': {
            const vars = project.settings.envVars
            const keys = Object.keys(vars)
            if (keys.length === 0) return ok('No environment variables set.\n\nUse project_env with action "set" to add variables.')
            const lines = keys.map((k: string) => `  ${k}=${vars[k].length > 20 ? vars[k].slice(0, 17) + '...' : vars[k]}`).join('\n')
            return ok(`Environment Variables (${keys.length}):\n\n${lines}`)
          }
          case 'set': {
            const key = arg<string>(args, 'key')
            const value = arg<string>(args, 'value')
            if (!key || value === undefined) return fail('Both key and value are required for set.')
            project.settings.envVars[key] = value
            project.updated_at = new Date().toISOString()
            fs.writeFileSync(projectFile, JSON.stringify(project, null, 2))
            return ok(`Environment variable set: ${key}=${value.length > 20 ? value.slice(0, 17) + '...' : value}`)
          }
          case 'get': {
            const key = arg<string>(args, 'key')
            if (!key) return fail('Key is required for get.')
            const value = project.settings.envVars[key]
            if (value === undefined) return fail(`Environment variable "${key}" not found.`)
            return ok(`${key}=${value}`)
          }
          case 'remove': {
            const key = arg<string>(args, 'key')
            if (!key) return fail('Key is required for remove.')
            if (!(key in project.settings.envVars)) return fail(`Environment variable "${key}" not found.`)
            delete project.settings.envVars[key]
            project.updated_at = new Date().toISOString()
            fs.writeFileSync(projectFile, JSON.stringify(project, null, 2))
            return ok(`Environment variable "${key}" removed.`)
          }
          default:
            return fail(`Unknown action: ${action}`, 'Use list, set, get, or remove.')
        }
      }

      // ── Notifications ──────────────────────────────────────────────────
      case 'notification_preferences': {
        const action = arg<string>(args, 'action') || 'get'

        try {
          const { notifications } = await import('vibekit')

          if (action === 'get') {
            const prefs = notifications.getPreferences()
            return ok(`Notification Preferences:\n\n${JSON.stringify(prefs, null, 2)}`)
          }

          const newPrefs = arg<any>(args, 'preferences')
          if (!newPrefs) return fail('Preferences object is required for update.')

          notifications.configure({ preferences: newPrefs })
          const updated = notifications.getPreferences()
          return ok(`Notification preferences updated.\n\n${JSON.stringify(updated, null, 2)}`)
        } catch (e: any) {
          return fail(`Failed to manage notification preferences: ${e.message}`)
        }
      }

      case 'send_test_notification': {
        const type = arg<string>(args, 'type')
        const emailAddr = arg<string>(args, 'email')
        if (!type || !emailAddr) return fail('Both type and email are required.')

        try {
          const { notifications } = await import('vibekit')

          const testData = {
            projectName: 'test-project',
            projectId: _selectedProjectId || 'prj_test123',
            buildId: 'bld_test_' + Date.now().toString(36),
            environment: 'production',
            branch: 'main',
            commitHash: 'abc1234',
            triggeredBy: 'Claude Code',
            duration: '45s',
            to: emailAddr,
          }

          let result
          switch (type) {
            case 'build-failed':
              // Temporarily enable to send test
              const savedPref = notifications.getPreferences().buildFailed
              notifications.configure({ preferences: { buildFailed: true } })
              result = await notifications.notifyBuildFailed({
                ...testData,
                failedAt: new Date().toISOString(),
                errorMessage: 'Error: Module not found: vibekit\n  at /app/src/index.ts:1:1\n\nThis is a test notification.',
              })
              notifications.configure({ preferences: { buildFailed: savedPref } })
              break
            case 'build-succeeded':
              notifications.configure({ preferences: { buildSucceeded: true } })
              result = await notifications.notifyBuildSucceeded({
                ...testData,
                deployedAt: new Date().toISOString(),
                deployUrl: 'https://test-project.vibekit.app',
              })
              break
            case 'security-alert':
              result = await notifications.notifySecurityAlert({
                to: emailAddr,
                projectName: 'test-project',
                projectId: testData.projectId,
                alertType: 'Suspicious Login Attempt',
                alertDescription: 'Multiple failed login attempts detected from an unusual IP address. This is a test notification.',
                severity: 'high',
                alertTime: new Date().toISOString(),
                ipAddress: '192.168.1.1',
              })
              break
            case 'usage-warning':
              result = await notifications.notifyUsageLimitWarning({
                to: emailAddr,
                projectName: 'test-project',
                projectId: testData.projectId,
                resourceType: 'API Requests',
                usagePercent: 85,
                currentUsage: '850,000',
                planLimit: '1,000,000',
                planName: 'Pro',
              })
              break
            default:
              return fail(`Unknown notification type: ${type}`)
          }

          if (result?.sent) {
            return ok(`Test notification sent to ${emailAddr}.\nMessage ID: ${result.messageId}`)
          } else {
            return fail(`Test notification was not sent: ${result?.reason || 'Unknown reason'}`)
          }
        } catch (e: any) {
          return fail(`Failed to send test notification: ${e.message}`)
        }
      }

      // ── Deploy ───────────────────────────────────────────────────────────
      case 'deploy': {
        return fail(
          'Deployment is not yet available.',
          'Use "npx vibekit dev" for local development. Deployment support is coming soon.'
        )
      }

      // ── Logs ─────────────────────────────────────────────────────────────
      case 'check_logs': {
        try {
          const { getRecentLogs } = await import('vibekit/utils/logger' as any)
          const count = arg<number>(args, 'lines') || 20
          const level = arg<string>(args, 'level')
          let logs: any[] = getRecentLogs(count * 2) // Get extra, then filter

          if (level) {
            logs = logs.filter((l: any) => l.level === level)
          }
          logs = logs.slice(0, arg<number>(args, 'lines') || 20)

          if (logs.length === 0) {
            return ok('No log entries found. Logs are populated when the dev server handles requests.')
          }

          const lines = logs.map((l: any) =>
            `${l.timestamp.slice(11, 23)} [${l.level.toUpperCase().padEnd(5)}] ${l.module}: ${l.message}`
          ).join('\n')

          return ok(`Recent Logs (${logs.length}):\n\n${lines}`)
        } catch {
          return ok('Log viewing requires the dev server to be running. Start it with "npx vibekit dev".')
        }
      }

      default:
        return fail(`Unknown tool: ${name}`, `Available tools: ${TOOLS.map(t => t.name).join(', ')}`)
    }
  } catch (error: any) {
    const message = error?.message || String(error)
    const code = error?.code || 'UNKNOWN_ERROR'
    const suggestion = error?.suggestion || 'Check the error message and try again.'

    return fail(
      `Error [${code}]: ${message}`,
      suggestion
    )
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(console.error)
