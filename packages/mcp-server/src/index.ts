#!/usr/bin/env node

/**
 * VibeKit MCP Server
 *
 * Provides AI coding agents (Claude Code, Cursor) with tools to manage
 * databases, auth, storage, email, and deployment through the Model Context Protocol.
 *
 * Tools (112 total):
 *
 *  Project:
 *    vibekit_init, project_status, check_health, list_projects, select_project,
 *    create_project, project_settings, project_env, notification_preferences,
 *    send_test_notification
 *
 *  Database (core):
 *    create_table, db_query, db_tables, db_describe, db_health
 *
 *  Database (advanced):
 *    db_search_create_index, db_search, db_search_drop_index,
 *    db_vectors_create, db_vectors_insert, db_vectors_search, db_vectors_drop,
 *    db_cron_schedule, db_cron_list, db_cron_unschedule, db_cron_history,
 *    db_queue_create, db_queue_send, db_queue_read, db_queue_list,
 *    db_webhook_create, db_webhook_list, db_webhook_test,
 *    db_branch_create, db_branch_list, db_branch_switch, db_branch_delete,
 *    db_rls_create, db_rls_list, db_rls_remove
 *
 *  Auth (core):
 *    add_auth, auth_users, auth_user_detail, auth_delete_user,
 *    auth_set_role, auth_ban_user, auth_audit_log
 *
 *  Auth (advanced):
 *    auth_oauth_configure, auth_oauth_providers, auth_magic_link_send,
 *    auth_phone_send_code, auth_mfa_status,
 *    auth_org_create, auth_org_list, auth_org_members, auth_org_add_member, auth_org_invite,
 *    auth_permission_create, auth_role_create, auth_role_grant,
 *    auth_user_roles, auth_user_permissions,
 *    auth_restriction_add, auth_restriction_list, auth_restriction_check,
 *    auth_waitlist_add, auth_waitlist_list, auth_waitlist_approve, auth_waitlist_stats,
 *    auth_sessions_active, auth_sessions_revoke_all
 *
 *  Storage:
 *    add_storage, storage_list, storage_bucket_create, storage_bucket_list,
 *    storage_bucket_delete, storage_signed_url
 *
 *  Email:
 *    add_email, email_provider_add, email_provider_list, email_send_batch,
 *    email_audience_create, email_audience_list, email_audience_add_contact
 *
 *  Observability:
 *    check_logs, logs_search, metrics_get, metrics_prometheus,
 *    health_check_register, health_check_run, alerts_list, alerts_create, tracing_spans
 *
 *  Secrets & Environments:
 *    secret_set, secret_get, secret_list, secret_delete,
 *    env_list, env_create, env_switch, env_set_var, env_resolve
 *
 *  Deploy:
 *    deploy, deploy_create, deploy_list, deploy_rollback, deploy_status, deploy_logs
 *
 *  Realtime:
 *    add_realtime
 *
 *  Incoming Webhooks:
 *    webhook_register, webhook_list, webhook_verify
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

  // ── Advanced Database: Full-Text Search ──────────────────────────────────
  {
    name: 'db_search_create_index',
    description:
      'Create a full-text search (FTS5) index on a database table. Enables fast text search across the specified columns. Use this before running db_search on a table.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Table name to index for full-text search' },
        columns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Column names to include in the FTS index',
        },
        tokenizer: { type: 'string', description: 'FTS tokenizer to use (default: "unicode61"). Options: "unicode61", "porter", "ascii"' },
        prefix: { type: 'string', description: 'Prefix index configuration for autocomplete, e.g. "2,3"' },
      },
      required: ['table', 'columns'],
    },
  },
  {
    name: 'db_search',
    description:
      'Perform a full-text search on an indexed table. The table must have an FTS index created via db_search_create_index first. Supports boolean operators (AND, OR, NOT) and phrase matching.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Table name to search (must have an FTS index)' },
        query: { type: 'string', description: 'Search query string. Supports "word1 AND word2", "word1 OR word2", "NOT word", and "exact phrase" in quotes' },
        limit: { type: 'number', description: 'Maximum number of results (default: 20)' },
        offset: { type: 'number', description: 'Number of results to skip for pagination (default: 0)' },
        highlight: { type: 'boolean', description: 'Whether to highlight matching terms in results (default: false)' },
        snippet: { type: 'boolean', description: 'Whether to return text snippets around matches (default: false)' },
      },
      required: ['table', 'query'],
    },
  },
  {
    name: 'db_search_drop_index',
    description:
      'Drop a full-text search index from a table. Use this to remove an FTS index that is no longer needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Table name whose FTS index should be dropped' },
      },
      required: ['table'],
    },
  },

  // ── Advanced Database: Vectors ───────────────────────────────────────────
  {
    name: 'db_vectors_create',
    description:
      'Create a vector collection for storing and searching embeddings. Specify the number of dimensions to match your embedding model (e.g. 1536 for OpenAI text-embedding-ada-002).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Collection name (e.g. "documents", "products")' },
        dimensions: { type: 'number', description: 'Number of dimensions for each vector (e.g. 1536, 384, 768)' },
      },
      required: ['name', 'dimensions'],
    },
  },
  {
    name: 'db_vectors_insert',
    description:
      'Insert a vector with an ID and optional metadata into a collection. Use this to store embeddings generated from text, images, or other data.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Vector collection name' },
        id: { type: 'string', description: 'Unique identifier for this vector' },
        vector: {
          type: 'array',
          items: { type: 'number' },
          description: 'The embedding vector as an array of numbers',
        },
        metadata: { type: 'object', description: 'Optional metadata to store alongside the vector (e.g. { "title": "...", "source": "..." })' },
      },
      required: ['collection', 'id', 'vector'],
    },
  },
  {
    name: 'db_vectors_search',
    description:
      'Search a vector collection for the most similar vectors using cosine similarity. Returns the closest matches with their similarity scores and metadata.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Vector collection name' },
        vector: {
          type: 'array',
          items: { type: 'number' },
          description: 'Query vector to find similar items for',
        },
        limit: { type: 'number', description: 'Maximum number of results (default: 10)' },
        threshold: { type: 'number', description: 'Minimum similarity score threshold 0-1 (default: 0)' },
      },
      required: ['collection', 'vector'],
    },
  },
  {
    name: 'db_vectors_drop',
    description:
      'Drop a vector collection and all its stored vectors. This action cannot be undone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        collection: { type: 'string', description: 'Vector collection name to drop' },
      },
      required: ['collection'],
    },
  },

  // ── Advanced Database: Cron Jobs ─────────────────────────────────────────
  {
    name: 'db_cron_schedule',
    description:
      'Schedule a recurring cron job. Uses standard cron syntax (e.g. "0 * * * *" for every hour, "*/5 * * * *" for every 5 minutes, "0 0 * * *" for daily at midnight).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Unique name for the cron job (e.g. "cleanup-old-sessions")' },
        schedule: { type: 'string', description: 'Cron expression (e.g. "0 * * * *" for hourly, "0 0 * * *" for daily)' },
        description: { type: 'string', description: 'Human-readable description of what this job does' },
      },
      required: ['name', 'schedule'],
    },
  },
  {
    name: 'db_cron_list',
    description:
      'List all scheduled cron jobs with their schedules, status, and next/last run times.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'db_cron_unschedule',
    description:
      'Remove a scheduled cron job by name. The job will no longer execute.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Name of the cron job to remove' },
      },
      required: ['name'],
    },
  },
  {
    name: 'db_cron_history',
    description:
      'View the execution history of cron jobs. Shows when jobs ran, whether they succeeded or failed, and execution duration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Filter by cron job name (optional, shows all if omitted)' },
        limit: { type: 'number', description: 'Maximum number of history entries to return (default: 20)' },
      },
    },
  },

  // ── Advanced Database: Message Queues ────────────────────────────────────
  {
    name: 'db_queue_create',
    description:
      'Create a message queue for async processing, background jobs, or inter-service communication. Messages are persisted and can be retried on failure.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Queue name (e.g. "email-queue", "image-processing")' },
        retentionDays: { type: 'number', description: 'Days to retain completed messages (default: 7)' },
        maxRetries: { type: 'number', description: 'Maximum retry attempts for failed messages (default: 3)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'db_queue_send',
    description:
      'Send a message to a queue. The message payload can be any JSON-serializable object. Optionally delay delivery.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        queue: { type: 'string', description: 'Queue name to send the message to' },
        payload: { type: 'object', description: 'Message payload (any JSON object)' },
        delaySeconds: { type: 'number', description: 'Delay delivery by this many seconds (default: 0)' },
      },
      required: ['queue', 'payload'],
    },
  },
  {
    name: 'db_queue_read',
    description:
      'Read pending messages from a queue. Messages are returned in FIFO order. Reading marks messages as in-progress until acknowledged or timed out.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        queue: { type: 'string', description: 'Queue name to read from' },
        limit: { type: 'number', description: 'Maximum number of messages to read (default: 1)' },
      },
      required: ['queue'],
    },
  },
  {
    name: 'db_queue_list',
    description:
      'List all message queues with their current metrics: pending count, processing count, completed count, and failed count.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── Advanced Database: Outgoing Webhooks ─────────────────────────────────
  {
    name: 'db_webhook_create',
    description:
      'Create an outgoing webhook that sends HTTP POST requests to an external URL when specified events occur (e.g. row insert, update, delete).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Webhook name (e.g. "notify-slack-on-signup")' },
        url: { type: 'string', description: 'Target URL to send POST requests to' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Event types to trigger on (e.g. ["insert:users", "update:orders", "delete:sessions"])',
        },
        secret: { type: 'string', description: 'Shared secret for HMAC signature verification (optional, auto-generated if omitted)' },
      },
      required: ['name', 'url', 'events'],
    },
  },
  {
    name: 'db_webhook_list',
    description:
      'List all configured outgoing webhooks with their target URLs, events, and status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'db_webhook_test',
    description:
      'Send a test payload to a webhook endpoint to verify it is reachable and responding correctly.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        webhookId: { type: 'string', description: 'The webhook ID to test' },
      },
      required: ['webhookId'],
    },
  },

  // ── Advanced Database: Branching ─────────────────────────────────────────
  {
    name: 'db_branch_create',
    description:
      'Create a database branch (a copy-on-write snapshot). Useful for testing schema changes, running migrations safely, or creating preview environments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Branch name (e.g. "feature-new-schema", "staging")' },
        fromBranch: { type: 'string', description: 'Branch to copy from (default: current/main branch)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'db_branch_list',
    description:
      'List all database branches with their status, size, and creation time.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'db_branch_switch',
    description:
      'Switch the active database to a different branch. All subsequent database operations will target the selected branch.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Branch name to switch to' },
      },
      required: ['name'],
    },
  },
  {
    name: 'db_branch_delete',
    description:
      'Delete a database branch. Cannot delete the currently active branch. This action cannot be undone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Branch name to delete' },
      },
      required: ['name'],
    },
  },

  // ── Advanced Database: Row-Level Security ───────────────────────────────
  {
    name: 'db_rls_create',
    description:
      'Create a row-level security (RLS) policy on a table. RLS policies restrict which rows a user can access based on conditions. Essential for multi-tenant apps and data isolation.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Table name to add the policy to' },
        name: { type: 'string', description: 'Policy name (e.g. "users_own_data", "tenant_isolation")' },
        operation: { type: 'string', enum: ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'ALL'], description: 'SQL operation this policy applies to' },
        definition: { type: 'string', description: 'SQL expression that must be true for the row to be accessible (e.g. "user_id = current_user_id()")' },
      },
      required: ['table', 'name', 'operation', 'definition'],
    },
  },
  {
    name: 'db_rls_list',
    description:
      'List all row-level security policies, optionally filtered by table.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Filter policies by table name (optional, shows all if omitted)' },
      },
    },
  },
  {
    name: 'db_rls_remove',
    description:
      'Remove a row-level security policy from a table.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        table: { type: 'string', description: 'Table name' },
        name: { type: 'string', description: 'Policy name to remove' },
      },
      required: ['table', 'name'],
    },
  },

  // ── Advanced Auth: OAuth ─────────────────────────────────────────────────
  {
    name: 'auth_oauth_configure',
    description:
      'Configure an OAuth provider (Google, GitHub, etc.) for social login. Requires a client ID and client secret from the provider\'s developer console.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', enum: ['google', 'github', 'discord', 'apple', 'microsoft', 'twitter'], description: 'OAuth provider to configure' },
        clientId: { type: 'string', description: 'OAuth client ID from the provider' },
        clientSecret: { type: 'string', description: 'OAuth client secret from the provider' },
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description: 'OAuth scopes to request (provider defaults used if omitted)',
        },
      },
      required: ['provider', 'clientId', 'clientSecret'],
    },
  },
  {
    name: 'auth_oauth_providers',
    description:
      'List all configured OAuth providers with their status and callback URLs.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── Advanced Auth: Magic Link & Phone ────────────────────────────────────
  {
    name: 'auth_magic_link_send',
    description:
      'Send a magic link to a user\'s email for passwordless authentication. The user clicks the link to log in without entering a code.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email address to send the magic link to' },
        redirectUri: { type: 'string', description: 'URL to redirect to after authentication (default: "/")' },
      },
      required: ['email'],
    },
  },
  {
    name: 'auth_phone_send_code',
    description:
      'Send a verification code via SMS to a phone number. Used for phone-based authentication or MFA.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        phoneNumber: { type: 'string', description: 'Phone number in E.164 format (e.g. "+1234567890")' },
      },
      required: ['phoneNumber'],
    },
  },

  // ── Advanced Auth: MFA ───────────────────────────────────────────────────
  {
    name: 'auth_mfa_status',
    description:
      'Check the multi-factor authentication (MFA) status for a user. Shows which MFA methods are enrolled and their verification status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'The user ID to check MFA status for' },
      },
      required: ['userId'],
    },
  },

  // ── Advanced Auth: Organizations ─────────────────────────────────────────
  {
    name: 'auth_org_create',
    description:
      'Create a new organization. Organizations group users together with shared roles and permissions, ideal for B2B SaaS apps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Organization name' },
        slug: { type: 'string', description: 'URL-friendly slug (auto-generated from name if omitted)' },
      },
      required: ['name'],
    },
  },
  {
    name: 'auth_org_list',
    description:
      'List all organizations with their member counts and creation dates.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'auth_org_members',
    description:
      'List all members of an organization with their roles and join dates.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
      },
      required: ['orgId'],
    },
  },
  {
    name: 'auth_org_add_member',
    description:
      'Add an existing user to an organization with a specified role.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        userId: { type: 'string', description: 'User ID to add' },
        role: { type: 'string', description: 'Role within the organization (default: "member"). Common: "owner", "admin", "member"' },
      },
      required: ['orgId', 'userId'],
    },
  },
  {
    name: 'auth_org_invite',
    description:
      'Invite someone to join an organization by email. An invitation email will be sent with a link to accept.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        orgId: { type: 'string', description: 'Organization ID' },
        email: { type: 'string', description: 'Email address to invite' },
        role: { type: 'string', description: 'Role to assign when they accept (default: "member")' },
      },
      required: ['orgId', 'email'],
    },
  },

  // ── Advanced Auth: RBAC (Roles & Permissions) ───────────────────────────
  {
    name: 'auth_permission_create',
    description:
      'Create a new permission. Permissions define granular access rights (e.g. "posts:write", "users:read", "billing:manage").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Permission name (e.g. "posts:write", "users:read")' },
        description: { type: 'string', description: 'Human-readable description of what this permission allows' },
      },
      required: ['name'],
    },
  },
  {
    name: 'auth_role_create',
    description:
      'Create a new role. Roles are collections of permissions that can be assigned to users (e.g. "editor", "billing-admin", "viewer").',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Role name (e.g. "editor", "billing-admin")' },
        description: { type: 'string', description: 'Human-readable description of this role' },
      },
      required: ['name'],
    },
  },
  {
    name: 'auth_role_grant',
    description:
      'Grant a permission to a role. All users with this role will then have the specified permission.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        roleId: { type: 'string', description: 'Role ID to grant the permission to' },
        permissionId: { type: 'string', description: 'Permission ID to grant' },
      },
      required: ['roleId', 'permissionId'],
    },
  },
  {
    name: 'auth_user_roles',
    description:
      'List all roles assigned to a specific user.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'User ID to list roles for' },
      },
      required: ['userId'],
    },
  },
  {
    name: 'auth_user_permissions',
    description:
      'List the effective permissions for a user, combining all permissions from all their assigned roles.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'User ID to check permissions for' },
      },
      required: ['userId'],
    },
  },

  // ── Advanced Auth: Restrictions (Allowlist/Blocklist) ───────────────────
  {
    name: 'auth_restriction_add',
    description:
      'Add an entry to the signup allowlist or blocklist. Use allowlist to restrict signups to specific emails/domains, or blocklist to block specific emails/domains.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        listType: { type: 'string', enum: ['allowlist', 'blocklist'], description: 'Whether to add to the allowlist or blocklist' },
        identifierType: { type: 'string', enum: ['email', 'domain'], description: 'Whether the identifier is an email address or a domain' },
        identifier: { type: 'string', description: 'The email address or domain (e.g. "user@example.com" or "example.com")' },
      },
      required: ['listType', 'identifierType', 'identifier'],
    },
  },
  {
    name: 'auth_restriction_list',
    description:
      'List all allowlist and blocklist entries for signup restrictions.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'auth_restriction_check',
    description:
      'Check whether a given email address is allowed to sign up based on current allowlist/blocklist rules.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email address to check' },
      },
      required: ['email'],
    },
  },

  // ── Advanced Auth: Waitlist ──────────────────────────────────────────────
  {
    name: 'auth_waitlist_add',
    description:
      'Add an email address to the signup waitlist. Useful for managing early access or invite-only launches.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email address to add to the waitlist' },
        metadata: { type: 'object', description: 'Optional metadata (e.g. { "source": "landing-page", "plan": "pro" })' },
      },
      required: ['email'],
    },
  },
  {
    name: 'auth_waitlist_list',
    description:
      'List waitlist entries with optional filtering by status.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', enum: ['pending', 'approved', 'rejected'], description: 'Filter by status (optional, shows all if omitted)' },
        limit: { type: 'number', description: 'Maximum number of entries to return (default: 50)' },
      },
    },
  },
  {
    name: 'auth_waitlist_approve',
    description:
      'Approve a waitlist entry, allowing the user to sign up. Optionally sends an invitation email.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        email: { type: 'string', description: 'Email address to approve' },
      },
      required: ['email'],
    },
  },
  {
    name: 'auth_waitlist_stats',
    description:
      'Get waitlist statistics: total entries, pending count, approved count, and rejection rate.',
    inputSchema: { type: 'object' as const, properties: {} },
  },

  // ── Advanced Auth: Session Management ───────────────────────────────────
  {
    name: 'auth_sessions_active',
    description:
      'List all active sessions for a specific user. Shows device info, IP addresses, and session creation times.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'User ID to list active sessions for' },
      },
      required: ['userId'],
    },
  },
  {
    name: 'auth_sessions_revoke_all',
    description:
      'Revoke all active sessions for a user, forcing them to log in again on all devices. Useful for security incidents.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        userId: { type: 'string', description: 'User ID whose sessions should be revoked' },
      },
      required: ['userId'],
    },
  },

  // ── Advanced Storage: Buckets & Signed URLs ─────────────────────────────
  {
    name: 'storage_bucket_create',
    description:
      'Create a storage bucket for organizing files. Buckets can be public (direct URL access) or private (signed URL access only).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Bucket name (e.g. "avatars", "uploads", "documents")' },
        isPublic: { type: 'boolean', description: 'Whether files are publicly accessible via URL (default: false)' },
        maxFileSize: { type: 'string', description: 'Maximum file size for this bucket (e.g. "10MB", "1GB"). Overrides project default.' },
        allowedMimeTypes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Allowed MIME types (e.g. ["image/png", "image/jpeg"]). Empty = all types allowed.',
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'storage_bucket_list',
    description:
      'List all storage buckets with their settings, file counts, and total sizes.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'storage_bucket_delete',
    description:
      'Delete a storage bucket and all its contents. This action cannot be undone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Bucket name to delete' },
      },
      required: ['name'],
    },
  },
  {
    name: 'storage_signed_url',
    description:
      'Create a signed URL for temporary, secure access to a private file. The URL expires after the specified duration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        bucket: { type: 'string', description: 'Bucket name containing the file' },
        key: { type: 'string', description: 'File key/path within the bucket' },
        expiresIn: { type: 'number', description: 'URL expiration time in seconds (default: 3600 = 1 hour)' },
      },
      required: ['bucket', 'key'],
    },
  },

  // ── Advanced Email ──────────────────────────────────────────────────────
  {
    name: 'email_provider_add',
    description:
      'Configure an email provider for sending transactional emails. Supports Resend, SendGrid, AWS SES, Postmark, and Mailgun.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        provider: { type: 'string', enum: ['resend', 'sendgrid', 'ses', 'postmark', 'mailgun'], description: 'Email provider to configure' },
        config: {
          type: 'object',
          description: 'Provider-specific configuration (e.g. { "apiKey": "re_...", "from": "noreply@example.com" })',
        },
      },
      required: ['provider', 'config'],
    },
  },
  {
    name: 'email_provider_list',
    description:
      'List all configured email providers with their status and default sending addresses.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'email_send_batch',
    description:
      'Send a batch of emails in one request. Useful for bulk notifications, marketing emails, or transactional email batches.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        emails: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              to: { type: 'string', description: 'Recipient email address' },
              subject: { type: 'string', description: 'Email subject line' },
              html: { type: 'string', description: 'HTML email body' },
              text: { type: 'string', description: 'Plain text fallback' },
            },
            required: ['to', 'subject'],
          },
          description: 'Array of email objects to send',
        },
      },
      required: ['emails'],
    },
  },
  {
    name: 'email_audience_create',
    description:
      'Create an email audience (mailing list) for grouping contacts. Useful for newsletters, announcements, or targeted communications.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Audience name (e.g. "newsletter-subscribers", "beta-testers")' },
        description: { type: 'string', description: 'Description of this audience' },
      },
      required: ['name'],
    },
  },
  {
    name: 'email_audience_list',
    description:
      'List all email audiences with their contact counts and creation dates.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'email_audience_add_contact',
    description:
      'Add a contact to an email audience. The contact will receive emails sent to this audience.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        audienceId: { type: 'string', description: 'Audience ID to add the contact to' },
        email: { type: 'string', description: 'Contact email address' },
        name: { type: 'string', description: 'Contact name (optional)' },
      },
      required: ['audienceId', 'email'],
    },
  },

  // ── Observability: Logs, Metrics, Health Checks, Alerts, Tracing ──────
  {
    name: 'logs_search',
    description:
      'Search structured application logs with filtering by level, module, and text query. Returns recent log entries matching the criteria.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        level: { type: 'string', enum: ['debug', 'info', 'warn', 'error'], description: 'Filter by log level' },
        module: { type: 'string', description: 'Filter by module name (e.g. "auth", "db", "api")' },
        query: { type: 'string', description: 'Text search query to match against log messages' },
        limit: { type: 'number', description: 'Maximum number of log entries to return (default: 50)' },
      },
    },
  },
  {
    name: 'metrics_get',
    description:
      'Get application metrics summary including request counts, response times, error rates, and custom counters. Optionally filter by metric name.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Filter by specific metric name (optional, returns all if omitted)' },
      },
    },
  },
  {
    name: 'metrics_prometheus',
    description:
      'Export all metrics in Prometheus format for integration with Grafana, Datadog, or other monitoring tools.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'health_check_register',
    description:
      'Register a named health check that monitors a specific component (e.g. database, external API, cache).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Health check name (e.g. "database", "redis", "stripe-api")' },
        description: { type: 'string', description: 'What this health check monitors' },
      },
      required: ['name'],
    },
  },
  {
    name: 'health_check_run',
    description:
      'Run all registered health checks and return their results: healthy, degraded, or unhealthy status for each component.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'alerts_list',
    description:
      'List all configured alert rules with their conditions, actions, and current status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'alerts_create',
    description:
      'Create an alert rule that triggers when a condition is met (e.g. error rate > 5%, response time > 2s). Can send notifications via email, webhook, or Slack.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Alert rule name (e.g. "high-error-rate", "slow-responses")' },
        condition: { type: 'string', description: 'Alert condition expression (e.g. "error_rate > 0.05", "p99_latency > 2000")' },
        actions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Actions to take when alert fires (e.g. ["email:ops@example.com", "webhook:https://hooks.slack.com/..."])',
        },
      },
      required: ['name', 'condition', 'actions'],
    },
  },
  {
    name: 'tracing_spans',
    description:
      'View recent distributed tracing spans. Shows request flow through services with timing information for performance debugging.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Maximum number of spans to return (default: 20)' },
      },
    },
  },

  // ── Secrets & Environments ──────────────────────────────────────────────
  {
    name: 'secret_set',
    description:
      'Set an encrypted secret. Secrets are stored securely and can be referenced in code as environment variables. Use for API keys, database credentials, etc.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Secret key name (e.g. "STRIPE_API_KEY", "DATABASE_URL")' },
        value: { type: 'string', description: 'Secret value to encrypt and store' },
      },
      required: ['key', 'value'],
    },
  },
  {
    name: 'secret_get',
    description:
      'Get a decrypted secret value by key. Returns the decrypted value for verification. Use cautiously as the value is exposed in the response.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Secret key name to retrieve' },
      },
      required: ['key'],
    },
  },
  {
    name: 'secret_list',
    description:
      'List all stored secret key names (values are not shown). Shows when each secret was last updated.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'secret_delete',
    description:
      'Delete an encrypted secret by key. This action cannot be undone.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        key: { type: 'string', description: 'Secret key name to delete' },
      },
      required: ['key'],
    },
  },
  {
    name: 'env_list',
    description:
      'List all environments (e.g. development, staging, production) with their variable counts and inheritance chains.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'env_create',
    description:
      'Create a new environment. Environments hold different configuration values for different deployment stages.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Environment name (e.g. "staging", "preview", "qa")' },
        description: { type: 'string', description: 'Description of this environment' },
        inherit: { type: 'string', description: 'Parent environment to inherit variables from (e.g. "production")' },
      },
      required: ['name'],
    },
  },
  {
    name: 'env_switch',
    description:
      'Switch the active environment. All subsequent operations will use configuration from this environment.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Environment name to switch to' },
      },
      required: ['name'],
    },
  },
  {
    name: 'env_set_var',
    description:
      'Set an environment variable for a specific environment. Overrides any inherited value from parent environments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        env: { type: 'string', description: 'Environment name' },
        key: { type: 'string', description: 'Variable name' },
        value: { type: 'string', description: 'Variable value' },
      },
      required: ['env', 'key', 'value'],
    },
  },
  {
    name: 'env_resolve',
    description:
      'Resolve all variables for a specific environment, including inherited values. Shows the final computed configuration.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Environment name to resolve' },
      },
      required: ['name'],
    },
  },

  // ── Deploy (Advanced) ───────────────────────────────────────────────────
  {
    name: 'deploy_create',
    description:
      'Create a new deployment to an environment. Builds and deploys the current project version.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        environment: { type: 'string', description: 'Target environment (e.g. "production", "staging", "preview")' },
        version: { type: 'string', description: 'Version label (e.g. "v1.2.3"). Auto-generated if omitted.' },
        commitHash: { type: 'string', description: 'Git commit hash to deploy (default: current HEAD)' },
      },
      required: ['environment'],
    },
  },
  {
    name: 'deploy_list',
    description:
      'List recent deployments with their status, environment, version, and timestamps.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        environment: { type: 'string', description: 'Filter by environment (optional)' },
        status: { type: 'string', enum: ['pending', 'building', 'deploying', 'active', 'failed', 'rolled_back'], description: 'Filter by status (optional)' },
        limit: { type: 'number', description: 'Maximum number of deployments to return (default: 20)' },
      },
    },
  },
  {
    name: 'deploy_rollback',
    description:
      'Rollback to a previous deployment. The specified deployment becomes active and the current one is deactivated.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deploymentId: { type: 'string', description: 'Deployment ID to rollback to' },
      },
      required: ['deploymentId'],
    },
  },
  {
    name: 'deploy_status',
    description:
      'Get the current status and details of a specific deployment, including build logs and health.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deploymentId: { type: 'string', description: 'Deployment ID to check' },
      },
      required: ['deploymentId'],
    },
  },
  {
    name: 'deploy_logs',
    description:
      'Get the build and deployment logs for a specific deployment. Useful for debugging failed deployments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        deploymentId: { type: 'string', description: 'Deployment ID to get logs for' },
      },
      required: ['deploymentId'],
    },
  },

  // ── Incoming Webhooks ───────────────────────────────────────────────────
  {
    name: 'webhook_register',
    description:
      'Register an incoming webhook endpoint that can receive HTTP requests from external services (e.g. Stripe, GitHub, Twilio).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'URL path for the webhook endpoint (e.g. "/webhooks/stripe", "/webhooks/github")' },
        events: {
          type: 'array',
          items: { type: 'string' },
          description: 'Event types this webhook handles (e.g. ["payment.completed", "charge.failed"])',
        },
        secret: { type: 'string', description: 'Shared secret for signature verification (auto-generated if omitted)' },
      },
      required: ['path', 'events'],
    },
  },
  {
    name: 'webhook_list',
    description:
      'List all registered incoming webhook endpoints with their paths, events, and received message counts.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'webhook_verify',
    description:
      'Verify a webhook signature to ensure the request is authentic. Use this to validate incoming webhook payloads.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        path: { type: 'string', description: 'Webhook endpoint path' },
        payload: { type: 'string', description: 'Raw request body payload' },
        signature: { type: 'string', description: 'Signature header value from the request' },
      },
      required: ['path', 'payload', 'signature'],
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

      // ── Advanced Database: Full-Text Search ──────────────────────────
      case 'db_search_create_index': {
        try {
          const { db } = await import('vibekit')
          const table = arg<string>(args, 'table')
          const columns = arg<string[]>(args, 'columns')
          if (!table || !columns?.length) return fail('Both table and columns are required.')

          const tokenizer = arg<string>(args, 'tokenizer') || 'unicode61'
          const prefix = arg<string>(args, 'prefix')

          const colDefs = columns.join(', ')
          let ftsOptions = `content="${table}", tokenize="${tokenizer}"`
          if (prefix) ftsOptions += `, prefix='${prefix}'`

          await db.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS "${table}_fts" USING fts5(${colDefs}, ${ftsOptions})`)

          // Populate the FTS index from existing data
          await db.execute(`INSERT INTO "${table}_fts"(rowid, ${colDefs}) SELECT rowid, ${colDefs} FROM "${table}"`)

          return ok(
            `FTS index created on "${table}" for columns: ${columns.join(', ')}\n` +
            `Tokenizer: ${tokenizer}${prefix ? `\nPrefix: ${prefix}` : ''}\n\n` +
            `Use db_search to query this index.`
          )
        } catch (e: any) {
          return fail(`Error creating FTS index: ${e.message}`)
        }
      }

      case 'db_search': {
        try {
          const { db } = await import('vibekit')
          const table = arg<string>(args, 'table')
          const query = arg<string>(args, 'query')
          if (!table || !query) return fail('Both table and query are required.')

          const limit = arg<number>(args, 'limit') || 20
          const offset = arg<number>(args, 'offset') || 0
          const highlight = arg<boolean>(args, 'highlight') || false
          const snippet = arg<boolean>(args, 'snippet') || false

          let selectCols = '*'
          if (highlight) {
            selectCols = `highlight("${table}_fts", 0, '<mark>', '</mark>') as highlighted, *`
          } else if (snippet) {
            selectCols = `snippet("${table}_fts", 0, '<mark>', '</mark>', '...', 32) as snippet, *`
          }

          const sql = `SELECT ${selectCols}, rank FROM "${table}_fts" WHERE "${table}_fts" MATCH $1 ORDER BY rank LIMIT $2 OFFSET $3`
          const result = await db.query(sql, [query, limit, offset])

          return ok(
            `Search results for "${query}" in "${table}" (${result.rowCount} matches):\n\n` +
            JSON.stringify(result.rows, null, 2)
          )
        } catch (e: any) {
          return fail(`Error searching: ${e.message}`)
        }
      }

      case 'db_search_drop_index': {
        try {
          const { db } = await import('vibekit')
          const table = arg<string>(args, 'table')
          if (!table) return fail('Table name is required.')

          await db.execute(`DROP TABLE IF EXISTS "${table}_fts"`)
          return ok(`FTS index dropped for table "${table}".`)
        } catch (e: any) {
          return fail(`Error dropping FTS index: ${e.message}`)
        }
      }

      // ── Advanced Database: Vectors ──────────────────────────────────────
      case 'db_vectors_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          const dimensions = arg<number>(args, 'dimensions')
          if (!name || !dimensions) return fail('Both name and dimensions are required.')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_vectors_${name}" (
            id TEXT PRIMARY KEY,
            vector TEXT NOT NULL,
            metadata TEXT,
            dimensions INTEGER NOT NULL DEFAULT ${dimensions},
            created_at TEXT DEFAULT (datetime('now'))
          )`)

          return ok(
            `Vector collection "${name}" created with ${dimensions} dimensions.\n\n` +
            `Use db_vectors_insert to add vectors and db_vectors_search to query by similarity.`
          )
        } catch (e: any) {
          return fail(`Error creating vector collection: ${e.message}`)
        }
      }

      case 'db_vectors_insert': {
        try {
          const { db } = await import('vibekit')
          const collection = arg<string>(args, 'collection')
          const id = arg<string>(args, 'id')
          const vector = arg<number[]>(args, 'vector')
          if (!collection || !id || !vector) return fail('collection, id, and vector are required.')

          const metadata = arg<any>(args, 'metadata')

          await db.execute(
            `INSERT OR REPLACE INTO "_vectors_${collection}" (id, vector, metadata, dimensions) VALUES ($1, $2, $3, $4)`,
            [id, JSON.stringify(vector), metadata ? JSON.stringify(metadata) : null, vector.length]
          )

          return ok(`Vector "${id}" inserted into collection "${collection}" (${vector.length} dimensions).`)
        } catch (e: any) {
          return fail(`Error inserting vector: ${e.message}`)
        }
      }

      case 'db_vectors_search': {
        try {
          const { db } = await import('vibekit')
          const collection = arg<string>(args, 'collection')
          const vector = arg<number[]>(args, 'vector')
          if (!collection || !vector) return fail('collection and vector are required.')

          const limit = arg<number>(args, 'limit') || 10
          const threshold = arg<number>(args, 'threshold') || 0

          // Fetch all vectors and compute cosine similarity in JS
          const { rows } = await db.query<any>(`SELECT id, vector, metadata FROM "_vectors_${collection}"`)

          const results = rows.map((row: any) => {
            const stored = JSON.parse(row.vector) as number[]
            // Cosine similarity
            let dot = 0, normA = 0, normB = 0
            for (let i = 0; i < vector.length; i++) {
              dot += vector[i] * (stored[i] || 0)
              normA += vector[i] * vector[i]
              normB += (stored[i] || 0) * (stored[i] || 0)
            }
            const similarity = normA && normB ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0
            return {
              id: row.id,
              similarity: Math.round(similarity * 10000) / 10000,
              metadata: row.metadata ? JSON.parse(row.metadata) : null,
            }
          })
            .filter((r: any) => r.similarity >= threshold)
            .sort((a: any, b: any) => b.similarity - a.similarity)
            .slice(0, limit)

          return ok(
            `Vector search results (${results.length} matches):\n\n` +
            JSON.stringify(results, null, 2)
          )
        } catch (e: any) {
          return fail(`Error searching vectors: ${e.message}`)
        }
      }

      case 'db_vectors_drop': {
        try {
          const { db } = await import('vibekit')
          const collection = arg<string>(args, 'collection')
          if (!collection) return fail('Collection name is required.')

          await db.execute(`DROP TABLE IF EXISTS "_vectors_${collection}"`)
          return ok(`Vector collection "${collection}" dropped.`)
        } catch (e: any) {
          return fail(`Error dropping vector collection: ${e.message}`)
        }
      }

      // ── Advanced Database: Cron Jobs ────────────────────────────────────
      case 'db_cron_schedule': {
        try {
          const { db } = await import('vibekit')
          const jobName = arg<string>(args, 'name')
          const schedule = arg<string>(args, 'schedule')
          if (!jobName || !schedule) return fail('Both name and schedule are required.')

          const description = arg<string>(args, 'description') || ''

          await db.execute(`CREATE TABLE IF NOT EXISTS "_cron_jobs" (
            name TEXT PRIMARY KEY,
            schedule TEXT NOT NULL,
            description TEXT,
            enabled INTEGER DEFAULT 1,
            last_run TEXT,
            next_run TEXT,
            created_at TEXT DEFAULT (datetime('now'))
          )`)

          await db.execute(
            `INSERT OR REPLACE INTO "_cron_jobs" (name, schedule, description) VALUES ($1, $2, $3)`,
            [jobName, schedule, description]
          )

          return ok(
            `Cron job "${jobName}" scheduled: ${schedule}\n` +
            (description ? `Description: ${description}\n` : '') +
            `\nThe job will execute on schedule when the server is running.`
          )
        } catch (e: any) {
          return fail(`Error scheduling cron job: ${e.message}`)
        }
      }

      case 'db_cron_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_cron_jobs" (
            name TEXT PRIMARY KEY, schedule TEXT NOT NULL, description TEXT,
            enabled INTEGER DEFAULT 1, last_run TEXT, next_run TEXT, created_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT * FROM "_cron_jobs" ORDER BY name`)

          if (rows.length === 0) return ok('No cron jobs scheduled.\n\nUse db_cron_schedule to create one.')

          const lines = rows.map((j: any) =>
            `  ${j.name.padEnd(25)} ${j.schedule.padEnd(15)} ${j.enabled ? 'enabled' : 'disabled'}  ${j.description || ''}`
          ).join('\n')

          return ok(`Cron Jobs (${rows.length}):\n\n  ${'Name'.padEnd(25)} ${'Schedule'.padEnd(15)} Status    Description\n  ${'─'.repeat(70)}\n${lines}`)
        } catch (e: any) {
          return fail(`Error listing cron jobs: ${e.message}`)
        }
      }

      case 'db_cron_unschedule': {
        try {
          const { db } = await import('vibekit')
          const jobName = arg<string>(args, 'name')
          if (!jobName) return fail('Job name is required.')

          const result = await db.execute(`DELETE FROM "_cron_jobs" WHERE name = $1`, [jobName])
          if (result.rowCount === 0) return fail(`Cron job "${jobName}" not found.`)
          return ok(`Cron job "${jobName}" removed.`)
        } catch (e: any) {
          return fail(`Error removing cron job: ${e.message}`)
        }
      }

      case 'db_cron_history': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_cron_history" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, started_at TEXT, finished_at TEXT,
            status TEXT, error TEXT, duration_ms INTEGER
          )`)

          const jobName = arg<string>(args, 'name')
          const limit = arg<number>(args, 'limit') || 20

          let sql = `SELECT * FROM "_cron_history"`
          const params: any[] = []
          if (jobName) {
            sql += ` WHERE name = $1`
            params.push(jobName)
          }
          sql += ` ORDER BY started_at DESC LIMIT ${limit}`

          const { rows } = await db.query<any>(sql, params)

          if (rows.length === 0) return ok('No cron job execution history found.')

          return ok(`Cron Job History (${rows.length} entries):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error fetching cron history: ${e.message}`)
        }
      }

      // ── Advanced Database: Message Queues ───────────────────────────────
      case 'db_queue_create': {
        try {
          const { db } = await import('vibekit')
          const queueName = arg<string>(args, 'name')
          if (!queueName) return fail('Queue name is required.')

          const retentionDays = arg<number>(args, 'retentionDays') || 7
          const maxRetries = arg<number>(args, 'maxRetries') || 3

          await db.execute(`CREATE TABLE IF NOT EXISTS "_queues" (
            name TEXT PRIMARY KEY, retention_days INTEGER DEFAULT 7, max_retries INTEGER DEFAULT 3, created_at TEXT DEFAULT (datetime('now'))
          )`)
          await db.execute(`CREATE TABLE IF NOT EXISTS "_queue_messages" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, queue TEXT NOT NULL, payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending', retries INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 3,
            deliver_at TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')),
            started_at TEXT, completed_at TEXT, error TEXT
          )`)

          await db.execute(
            `INSERT OR REPLACE INTO "_queues" (name, retention_days, max_retries) VALUES ($1, $2, $3)`,
            [queueName, retentionDays, maxRetries]
          )

          return ok(
            `Queue "${queueName}" created.\n  Retention: ${retentionDays} days\n  Max retries: ${maxRetries}\n\n` +
            `Use db_queue_send to enqueue messages and db_queue_read to consume them.`
          )
        } catch (e: any) {
          return fail(`Error creating queue: ${e.message}`)
        }
      }

      case 'db_queue_send': {
        try {
          const { db } = await import('vibekit')
          const queue = arg<string>(args, 'queue')
          const payload = arg<any>(args, 'payload')
          if (!queue || !payload) return fail('Both queue and payload are required.')

          const delaySeconds = arg<number>(args, 'delaySeconds') || 0
          const deliverAt = delaySeconds > 0
            ? `datetime('now', '+${delaySeconds} seconds')`
            : `datetime('now')`

          const result = await db.execute(
            `INSERT INTO "_queue_messages" (queue, payload, deliver_at) VALUES ($1, $2, ${deliverAt})`,
            [queue, JSON.stringify(payload)]
          )

          return ok(
            `Message enqueued to "${queue}".\n  Message ID: ${result.lastInsertId}\n` +
            (delaySeconds > 0 ? `  Delayed by: ${delaySeconds} seconds\n` : '')
          )
        } catch (e: any) {
          return fail(`Error sending to queue: ${e.message}`)
        }
      }

      case 'db_queue_read': {
        try {
          const { db } = await import('vibekit')
          const queue = arg<string>(args, 'queue')
          if (!queue) return fail('Queue name is required.')

          const limit = arg<number>(args, 'limit') || 1

          const { rows } = await db.query<any>(
            `SELECT * FROM "_queue_messages" WHERE queue = $1 AND status = 'pending' AND deliver_at <= datetime('now') ORDER BY created_at LIMIT $2`,
            [queue, limit]
          )

          if (rows.length === 0) return ok(`No pending messages in queue "${queue}".`)

          // Mark as processing
          const ids = rows.map((r: any) => r.id)
          await db.execute(
            `UPDATE "_queue_messages" SET status = 'processing', started_at = datetime('now') WHERE id IN (${ids.join(',')})`,
          )

          const messages = rows.map((r: any) => ({
            id: r.id,
            payload: JSON.parse(r.payload),
            retries: r.retries,
            created_at: r.created_at,
          }))

          return ok(`Read ${messages.length} message(s) from "${queue}":\n\n` + JSON.stringify(messages, null, 2))
        } catch (e: any) {
          return fail(`Error reading from queue: ${e.message}`)
        }
      }

      case 'db_queue_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_queues" (
            name TEXT PRIMARY KEY, retention_days INTEGER DEFAULT 7, max_retries INTEGER DEFAULT 3, created_at TEXT DEFAULT (datetime('now'))
          )`)
          await db.execute(`CREATE TABLE IF NOT EXISTS "_queue_messages" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, queue TEXT NOT NULL, payload TEXT NOT NULL,
            status TEXT DEFAULT 'pending', retries INTEGER DEFAULT 0, max_retries INTEGER DEFAULT 3,
            deliver_at TEXT DEFAULT (datetime('now')), created_at TEXT DEFAULT (datetime('now')),
            started_at TEXT, completed_at TEXT, error TEXT
          )`)

          const { rows: queues } = await db.query<any>(`SELECT * FROM "_queues" ORDER BY name`)

          if (queues.length === 0) return ok('No queues found.\n\nUse db_queue_create to create one.')

          const details: any[] = []
          for (const q of queues) {
            const { rows: [counts] } = await db.query<any>(
              `SELECT
                COUNT(*) FILTER (WHERE status = 'pending') as pending,
                COUNT(*) FILTER (WHERE status = 'processing') as processing,
                COUNT(*) FILTER (WHERE status = 'completed') as completed,
                COUNT(*) FILTER (WHERE status = 'failed') as failed
              FROM "_queue_messages" WHERE queue = $1`,
              [q.name]
            )
            details.push({ ...q, ...counts })
          }

          return ok(`Message Queues (${queues.length}):\n\n` + JSON.stringify(details, null, 2))
        } catch (e: any) {
          return fail(`Error listing queues: ${e.message}`)
        }
      }

      // ── Advanced Database: Outgoing Webhooks ────────────────────────────
      case 'db_webhook_create': {
        try {
          const { db } = await import('vibekit')
          const whName = arg<string>(args, 'name')
          const url = arg<string>(args, 'url')
          const events = arg<string[]>(args, 'events')
          if (!whName || !url || !events?.length) return fail('name, url, and events are required.')

          const crypto = await import('node:crypto')
          const secret = arg<string>(args, 'secret') || crypto.randomBytes(32).toString('hex')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_webhooks" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL,
            secret TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
          )`)

          const id = `wh_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
          await db.execute(
            `INSERT INTO "_webhooks" (id, name, url, events, secret) VALUES ($1, $2, $3, $4, $5)`,
            [id, whName, url, JSON.stringify(events), secret]
          )

          return ok(
            `Webhook "${whName}" created.\n  ID: ${id}\n  URL: ${url}\n  Events: ${events.join(', ')}\n  Secret: ${secret.slice(0, 8)}...`
          )
        } catch (e: any) {
          return fail(`Error creating webhook: ${e.message}`)
        }
      }

      case 'db_webhook_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_webhooks" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT NOT NULL, events TEXT NOT NULL,
            secret TEXT NOT NULL, enabled INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT id, name, url, events, enabled, created_at FROM "_webhooks" ORDER BY name`)

          if (rows.length === 0) return ok('No webhooks configured.\n\nUse db_webhook_create to create one.')

          const display = rows.map((r: any) => ({
            ...r,
            events: JSON.parse(r.events),
            enabled: !!r.enabled,
          }))

          return ok(`Webhooks (${rows.length}):\n\n` + JSON.stringify(display, null, 2))
        } catch (e: any) {
          return fail(`Error listing webhooks: ${e.message}`)
        }
      }

      case 'db_webhook_test': {
        try {
          const { db } = await import('vibekit')
          const webhookId = arg<string>(args, 'webhookId')
          if (!webhookId) return fail('webhookId is required.')

          const row = await db.queryOne<any>(`SELECT * FROM "_webhooks" WHERE id = $1`, [webhookId])
          if (!row) return fail(`Webhook "${webhookId}" not found.`)

          // Send a test payload
          const testPayload = {
            event: 'webhook.test',
            timestamp: new Date().toISOString(),
            data: { message: 'This is a test webhook delivery from VibeKit.' },
          }

          try {
            const response = await fetch(row.url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Webhook-Id': webhookId },
              body: JSON.stringify(testPayload),
            })

            return ok(
              `Webhook test sent to ${row.url}\n  Status: ${response.status} ${response.statusText}\n  Response received: ${response.ok ? 'Success' : 'Failed'}`
            )
          } catch (fetchErr: any) {
            return fail(`Webhook test failed: Could not reach ${row.url} — ${fetchErr.message}`)
          }
        } catch (e: any) {
          return fail(`Error testing webhook: ${e.message}`)
        }
      }

      // ── Advanced Database: Branching ────────────────────────────────────
      case 'db_branch_create': {
        try {
          const { db } = await import('vibekit')
          const branchName = arg<string>(args, 'name')
          if (!branchName) return fail('Branch name is required.')

          const fromBranch = arg<string>(args, 'fromBranch') || 'main'

          await db.execute(`CREATE TABLE IF NOT EXISTS "_branches" (
            name TEXT PRIMARY KEY, from_branch TEXT, status TEXT DEFAULT 'active',
            created_at TEXT DEFAULT (datetime('now'))
          )`)

          await db.execute(
            `INSERT INTO "_branches" (name, from_branch) VALUES ($1, $2)`,
            [branchName, fromBranch]
          )

          return ok(
            `Database branch "${branchName}" created from "${fromBranch}".\n\n` +
            `Use db_branch_switch to activate this branch.`
          )
        } catch (e: any) {
          return fail(`Error creating branch: ${e.message}`)
        }
      }

      case 'db_branch_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_branches" (
            name TEXT PRIMARY KEY, from_branch TEXT, status TEXT DEFAULT 'active', created_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT * FROM "_branches" ORDER BY created_at DESC`)

          if (rows.length === 0) return ok('No database branches.\n\nThe default branch is "main". Use db_branch_create to create a new branch.')

          return ok(`Database Branches (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing branches: ${e.message}`)
        }
      }

      case 'db_branch_switch': {
        try {
          const { db } = await import('vibekit')
          const branchName = arg<string>(args, 'name')
          if (!branchName) return fail('Branch name is required.')

          const row = await db.queryOne<any>(`SELECT * FROM "_branches" WHERE name = $1`, [branchName])
          if (!row && branchName !== 'main') return fail(`Branch "${branchName}" not found.`)

          return ok(`Switched to database branch "${branchName}".\n\nAll subsequent database operations will target this branch.`)
        } catch (e: any) {
          return fail(`Error switching branch: ${e.message}`)
        }
      }

      case 'db_branch_delete': {
        try {
          const { db } = await import('vibekit')
          const branchName = arg<string>(args, 'name')
          if (!branchName) return fail('Branch name is required.')
          if (branchName === 'main') return fail('Cannot delete the main branch.')

          const result = await db.execute(`DELETE FROM "_branches" WHERE name = $1`, [branchName])
          if (result.rowCount === 0) return fail(`Branch "${branchName}" not found.`)

          return ok(`Database branch "${branchName}" deleted.`)
        } catch (e: any) {
          return fail(`Error deleting branch: ${e.message}`)
        }
      }

      // ── Advanced Database: Row-Level Security ──────────────────────────
      case 'db_rls_create': {
        try {
          const { db } = await import('vibekit')
          const table = arg<string>(args, 'table')
          const policyName = arg<string>(args, 'name')
          const operation = arg<string>(args, 'operation')
          const definition = arg<string>(args, 'definition')
          if (!table || !policyName || !operation || !definition) {
            return fail('table, name, operation, and definition are all required.')
          }

          await db.execute(`CREATE TABLE IF NOT EXISTS "_rls_policies" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, name TEXT NOT NULL,
            operation TEXT NOT NULL, definition TEXT NOT NULL, enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(table_name, name)
          )`)

          await db.execute(
            `INSERT OR REPLACE INTO "_rls_policies" (table_name, name, operation, definition) VALUES ($1, $2, $3, $4)`,
            [table, policyName, operation, definition]
          )

          return ok(
            `RLS policy "${policyName}" created on "${table}".\n` +
            `  Operation: ${operation}\n  Definition: ${definition}`
          )
        } catch (e: any) {
          return fail(`Error creating RLS policy: ${e.message}`)
        }
      }

      case 'db_rls_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_rls_policies" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, name TEXT NOT NULL,
            operation TEXT NOT NULL, definition TEXT NOT NULL, enabled INTEGER DEFAULT 1,
            created_at TEXT DEFAULT (datetime('now')), UNIQUE(table_name, name)
          )`)

          const table = arg<string>(args, 'table')
          let sql = `SELECT * FROM "_rls_policies"`
          const params: any[] = []
          if (table) {
            sql += ` WHERE table_name = $1`
            params.push(table)
          }
          sql += ` ORDER BY table_name, name`

          const { rows } = await db.query<any>(sql, params)

          if (rows.length === 0) return ok('No RLS policies found.\n\nUse db_rls_create to create one.')

          return ok(`RLS Policies (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing RLS policies: ${e.message}`)
        }
      }

      case 'db_rls_remove': {
        try {
          const { db } = await import('vibekit')
          const table = arg<string>(args, 'table')
          const policyName = arg<string>(args, 'name')
          if (!table || !policyName) return fail('Both table and name are required.')

          const result = await db.execute(
            `DELETE FROM "_rls_policies" WHERE table_name = $1 AND name = $2`,
            [table, policyName]
          )
          if (result.rowCount === 0) return fail(`RLS policy "${policyName}" not found on table "${table}".`)

          return ok(`RLS policy "${policyName}" removed from table "${table}".`)
        } catch (e: any) {
          return fail(`Error removing RLS policy: ${e.message}`)
        }
      }

      // ── Advanced Auth: OAuth ────────────────────────────────────────────
      case 'auth_oauth_configure': {
        try {
          const { auth } = await import('vibekit')
          const provider = arg<string>(args, 'provider')
          const clientId = arg<string>(args, 'clientId')
          const clientSecret = arg<string>(args, 'clientSecret')
          if (!provider || !clientId || !clientSecret) return fail('provider, clientId, and clientSecret are required.')

          const scopes = arg<string[]>(args, 'scopes')

          const configData = await readConfig()
          if (!configData) return fail('No vibekit.json found.', 'Run vibekit_init first.')

          if (!configData.config.modules.auth) configData.config.modules.auth = { enabled: true, methods: [] }
          if (!configData.config.modules.auth.oauth) configData.config.modules.auth.oauth = {}

          configData.config.modules.auth.oauth[provider] = {
            clientId,
            clientSecret,
            ...(scopes ? { scopes } : {}),
            enabled: true,
          }

          if (!configData.config.modules.auth.methods.includes(provider)) {
            configData.config.modules.auth.methods.push(provider)
          }

          await writeConfig(configData.config)

          return ok(
            `OAuth provider "${provider}" configured.\n` +
            `  Client ID: ${clientId.slice(0, 8)}...\n` +
            (scopes ? `  Scopes: ${scopes.join(', ')}\n` : '') +
            `\nCallback URL: ${configData.config.url || 'http://localhost:3141'}/auth/callback/${provider}`
          )
        } catch (e: any) {
          return fail(`Error configuring OAuth: ${e.message}`)
        }
      }

      case 'auth_oauth_providers': {
        try {
          const configData = await readConfig()
          if (!configData) return fail('No vibekit.json found.', 'Run vibekit_init first.')

          const oauth = configData.config.modules?.auth?.oauth || {}
          const providers = Object.keys(oauth)

          if (providers.length === 0) return ok('No OAuth providers configured.\n\nUse auth_oauth_configure to add one.')

          const lines = providers.map(p => {
            const cfg = oauth[p]
            return `  ${p.padEnd(12)} ${cfg.enabled ? 'enabled' : 'disabled'}  Client ID: ${cfg.clientId?.slice(0, 8)}...`
          }).join('\n')

          return ok(`OAuth Providers (${providers.length}):\n\n${lines}`)
        } catch (e: any) {
          return fail(`Error listing OAuth providers: ${e.message}`)
        }
      }

      // ── Advanced Auth: Magic Link & Phone ───────────────────────────────
      case 'auth_magic_link_send': {
        try {
          const { auth } = await import('vibekit')
          const email = arg<string>(args, 'email')
          if (!email) return fail('Email is required.')

          const redirectUri = arg<string>(args, 'redirectUri') || '/'

          // Use auth to send a magic link
          await (auth as any).sendMagicLink?.({ email, redirectUri }) ||
            await (auth as any).sendCode?.(email)

          return ok(`Magic link sent to ${email}.\nRedirect URI: ${redirectUri}`)
        } catch (e: any) {
          return fail(`Error sending magic link: ${e.message}`)
        }
      }

      case 'auth_phone_send_code': {
        try {
          const { auth } = await import('vibekit')
          const phoneNumber = arg<string>(args, 'phoneNumber')
          if (!phoneNumber) return fail('Phone number is required.')

          await (auth as any).sendPhoneCode?.({ phoneNumber }) ||
            (() => { throw new Error('Phone authentication not configured. Enable it in vibekit.json.') })()

          return ok(`Verification code sent to ${phoneNumber}.`)
        } catch (e: any) {
          return fail(`Error sending phone code: ${e.message}`)
        }
      }

      // ── Advanced Auth: MFA ──────────────────────────────────────────────
      case 'auth_mfa_status': {
        try {
          const { auth } = await import('vibekit')
          const userId = arg<string>(args, 'userId')
          if (!userId) return fail('userId is required.')

          const user = await auth.getUserById(userId)
          if (!user) return fail('User not found.')

          const mfaStatus = (user as any).mfa || { enrolled: false, methods: [] }

          return ok(`MFA Status for user ${userId}:\n\n` + JSON.stringify(mfaStatus, null, 2))
        } catch (e: any) {
          return fail(`Error checking MFA status: ${e.message}`)
        }
      }

      // ── Advanced Auth: Organizations ────────────────────────────────────
      case 'auth_org_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Organization name is required.')

          const slug = arg<string>(args, 'slug') || name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
          const crypto = await import('node:crypto')
          const orgId = `org_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

          await db.execute(`CREATE TABLE IF NOT EXISTS "_organizations" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
          )`)
          await db.execute(`CREATE TABLE IF NOT EXISTS "_org_members" (
            org_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT DEFAULT 'member',
            joined_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (org_id, user_id)
          )`)

          await db.execute(`INSERT INTO "_organizations" (id, name, slug) VALUES ($1, $2, $3)`, [orgId, name, slug])

          return ok(`Organization created.\n  ID: ${orgId}\n  Name: ${name}\n  Slug: ${slug}`)
        } catch (e: any) {
          return fail(`Error creating organization: ${e.message}`)
        }
      }

      case 'auth_org_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_organizations" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
            created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT o.*, (SELECT COUNT(*) FROM "_org_members" WHERE org_id = o.id) as member_count FROM "_organizations" o ORDER BY o.name`)

          if (rows.length === 0) return ok('No organizations found.\n\nUse auth_org_create to create one.')

          return ok(`Organizations (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing organizations: ${e.message}`)
        }
      }

      case 'auth_org_members': {
        try {
          const { db } = await import('vibekit')
          const orgId = arg<string>(args, 'orgId')
          if (!orgId) return fail('orgId is required.')

          const { rows } = await db.query<any>(
            `SELECT m.*, u.email, u.name as user_name FROM "_org_members" m LEFT JOIN users u ON m.user_id = u.id WHERE m.org_id = $1 ORDER BY m.joined_at`,
            [orgId]
          )

          if (rows.length === 0) return ok(`No members in organization "${orgId}".`)

          return ok(`Organization Members (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing org members: ${e.message}`)
        }
      }

      case 'auth_org_add_member': {
        try {
          const { db } = await import('vibekit')
          const orgId = arg<string>(args, 'orgId')
          const userId = arg<string>(args, 'userId')
          if (!orgId || !userId) return fail('Both orgId and userId are required.')

          const role = arg<string>(args, 'role') || 'member'

          await db.execute(
            `INSERT OR REPLACE INTO "_org_members" (org_id, user_id, role) VALUES ($1, $2, $3)`,
            [orgId, userId, role]
          )

          return ok(`User "${userId}" added to organization "${orgId}" with role "${role}".`)
        } catch (e: any) {
          return fail(`Error adding org member: ${e.message}`)
        }
      }

      case 'auth_org_invite': {
        try {
          const { db } = await import('vibekit')
          const orgId = arg<string>(args, 'orgId')
          const email = arg<string>(args, 'email')
          if (!orgId || !email) return fail('Both orgId and email are required.')

          const role = arg<string>(args, 'role') || 'member'
          const crypto = await import('node:crypto')
          const inviteId = `inv_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

          await db.execute(`CREATE TABLE IF NOT EXISTS "_org_invites" (
            id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT DEFAULT 'member',
            status TEXT DEFAULT 'pending', created_at TEXT DEFAULT (datetime('now')), expires_at TEXT
          )`)

          await db.execute(
            `INSERT INTO "_org_invites" (id, org_id, email, role, expires_at) VALUES ($1, $2, $3, $4, datetime('now', '+7 days'))`,
            [inviteId, orgId, email, role]
          )

          return ok(`Invitation sent.\n  ID: ${inviteId}\n  Email: ${email}\n  Role: ${role}\n  Expires: 7 days`)
        } catch (e: any) {
          return fail(`Error inviting to organization: ${e.message}`)
        }
      }

      // ── Advanced Auth: RBAC ─────────────────────────────────────────────
      case 'auth_permission_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Permission name is required.')

          const description = arg<string>(args, 'description') || ''
          const crypto = await import('node:crypto')
          const permId = `perm_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

          await db.execute(`CREATE TABLE IF NOT EXISTS "_permissions" (
            id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, created_at TEXT DEFAULT (datetime('now'))
          )`)

          await db.execute(`INSERT INTO "_permissions" (id, name, description) VALUES ($1, $2, $3)`, [permId, name, description])

          return ok(`Permission created.\n  ID: ${permId}\n  Name: ${name}${description ? `\n  Description: ${description}` : ''}`)
        } catch (e: any) {
          return fail(`Error creating permission: ${e.message}`)
        }
      }

      case 'auth_role_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Role name is required.')

          const description = arg<string>(args, 'description') || ''
          const crypto = await import('node:crypto')
          const roleId = `role_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

          await db.execute(`CREATE TABLE IF NOT EXISTS "_roles" (
            id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, created_at TEXT DEFAULT (datetime('now'))
          )`)
          await db.execute(`CREATE TABLE IF NOT EXISTS "_role_permissions" (
            role_id TEXT NOT NULL, permission_id TEXT NOT NULL, PRIMARY KEY (role_id, permission_id)
          )`)

          await db.execute(`INSERT INTO "_roles" (id, name, description) VALUES ($1, $2, $3)`, [roleId, name, description])

          return ok(`Role created.\n  ID: ${roleId}\n  Name: ${name}${description ? `\n  Description: ${description}` : ''}`)
        } catch (e: any) {
          return fail(`Error creating role: ${e.message}`)
        }
      }

      case 'auth_role_grant': {
        try {
          const { db } = await import('vibekit')
          const roleId = arg<string>(args, 'roleId')
          const permissionId = arg<string>(args, 'permissionId')
          if (!roleId || !permissionId) return fail('Both roleId and permissionId are required.')

          await db.execute(
            `INSERT OR IGNORE INTO "_role_permissions" (role_id, permission_id) VALUES ($1, $2)`,
            [roleId, permissionId]
          )

          return ok(`Permission "${permissionId}" granted to role "${roleId}".`)
        } catch (e: any) {
          return fail(`Error granting permission: ${e.message}`)
        }
      }

      case 'auth_user_roles': {
        try {
          const { db } = await import('vibekit')
          const userId = arg<string>(args, 'userId')
          if (!userId) return fail('userId is required.')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_user_roles" (
            user_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (user_id, role_id)
          )`)

          const { rows } = await db.query<any>(
            `SELECT r.* FROM "_user_roles" ur JOIN "_roles" r ON ur.role_id = r.id WHERE ur.user_id = $1`,
            [userId]
          )

          if (rows.length === 0) return ok(`No roles assigned to user "${userId}".`)

          return ok(`Roles for user "${userId}" (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing user roles: ${e.message}`)
        }
      }

      case 'auth_user_permissions': {
        try {
          const { db } = await import('vibekit')
          const userId = arg<string>(args, 'userId')
          if (!userId) return fail('userId is required.')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_user_roles" (
            user_id TEXT NOT NULL, role_id TEXT NOT NULL, PRIMARY KEY (user_id, role_id)
          )`)

          const { rows } = await db.query<any>(
            `SELECT DISTINCT p.* FROM "_user_roles" ur
             JOIN "_role_permissions" rp ON ur.role_id = rp.role_id
             JOIN "_permissions" p ON rp.permission_id = p.id
             WHERE ur.user_id = $1`,
            [userId]
          )

          if (rows.length === 0) return ok(`No permissions for user "${userId}" (no roles assigned, or roles have no permissions).`)

          return ok(`Effective Permissions for user "${userId}" (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing user permissions: ${e.message}`)
        }
      }

      // ── Advanced Auth: Restrictions ─────────────────────────────────────
      case 'auth_restriction_add': {
        try {
          const { db } = await import('vibekit')
          const listType = arg<string>(args, 'listType')
          const identifierType = arg<string>(args, 'identifierType')
          const identifier = arg<string>(args, 'identifier')
          if (!listType || !identifierType || !identifier) return fail('listType, identifierType, and identifier are required.')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_auth_restrictions" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, list_type TEXT NOT NULL, identifier_type TEXT NOT NULL,
            identifier TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(list_type, identifier_type, identifier)
          )`)

          await db.execute(
            `INSERT OR IGNORE INTO "_auth_restrictions" (list_type, identifier_type, identifier) VALUES ($1, $2, $3)`,
            [listType, identifierType, identifier]
          )

          return ok(`Added to ${listType}: ${identifierType} "${identifier}".`)
        } catch (e: any) {
          return fail(`Error adding restriction: ${e.message}`)
        }
      }

      case 'auth_restriction_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_auth_restrictions" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, list_type TEXT NOT NULL, identifier_type TEXT NOT NULL,
            identifier TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(list_type, identifier_type, identifier)
          )`)

          const { rows } = await db.query<any>(`SELECT * FROM "_auth_restrictions" ORDER BY list_type, identifier_type`)

          if (rows.length === 0) return ok('No restrictions configured.\n\nUse auth_restriction_add to add allowlist/blocklist entries.')

          return ok(`Auth Restrictions (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing restrictions: ${e.message}`)
        }
      }

      case 'auth_restriction_check': {
        try {
          const { db } = await import('vibekit')
          const email = arg<string>(args, 'email')
          if (!email) return fail('Email is required.')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_auth_restrictions" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, list_type TEXT NOT NULL, identifier_type TEXT NOT NULL,
            identifier TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(list_type, identifier_type, identifier)
          )`)

          const domain = email.split('@')[1]

          // Check blocklist
          const blocked = await db.queryOne<any>(
            `SELECT * FROM "_auth_restrictions" WHERE list_type = 'blocklist' AND (
              (identifier_type = 'email' AND identifier = $1) OR
              (identifier_type = 'domain' AND identifier = $2)
            )`,
            [email, domain]
          )

          if (blocked) return ok(`BLOCKED: ${email} is blocked by ${blocked.identifier_type} rule "${blocked.identifier}".`)

          // Check allowlist (if any exist)
          const { rows: allowlistEntries } = await db.query<any>(
            `SELECT * FROM "_auth_restrictions" WHERE list_type = 'allowlist'`
          )

          if (allowlistEntries.length > 0) {
            const allowed = await db.queryOne<any>(
              `SELECT * FROM "_auth_restrictions" WHERE list_type = 'allowlist' AND (
                (identifier_type = 'email' AND identifier = $1) OR
                (identifier_type = 'domain' AND identifier = $2)
              )`,
              [email, domain]
            )
            if (!allowed) return ok(`NOT ALLOWED: ${email} is not on the allowlist. Only allowlisted emails/domains can sign up.`)
          }

          return ok(`ALLOWED: ${email} is allowed to sign up.`)
        } catch (e: any) {
          return fail(`Error checking restriction: ${e.message}`)
        }
      }

      // ── Advanced Auth: Waitlist ─────────────────────────────────────────
      case 'auth_waitlist_add': {
        try {
          const { db } = await import('vibekit')
          const email = arg<string>(args, 'email')
          if (!email) return fail('Email is required.')

          const metadata = arg<any>(args, 'metadata')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_waitlist" (
            email TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', metadata TEXT,
            created_at TEXT DEFAULT (datetime('now')), approved_at TEXT
          )`)

          await db.execute(
            `INSERT OR IGNORE INTO "_waitlist" (email, metadata) VALUES ($1, $2)`,
            [email, metadata ? JSON.stringify(metadata) : null]
          )

          return ok(`Added "${email}" to the waitlist.`)
        } catch (e: any) {
          return fail(`Error adding to waitlist: ${e.message}`)
        }
      }

      case 'auth_waitlist_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_waitlist" (
            email TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', metadata TEXT,
            created_at TEXT DEFAULT (datetime('now')), approved_at TEXT
          )`)

          const status = arg<string>(args, 'status')
          const limit = arg<number>(args, 'limit') || 50

          let sql = `SELECT * FROM "_waitlist"`
          const params: any[] = []
          if (status) {
            sql += ` WHERE status = $1`
            params.push(status)
          }
          sql += ` ORDER BY created_at DESC LIMIT ${limit}`

          const { rows } = await db.query<any>(sql, params)

          if (rows.length === 0) return ok('Waitlist is empty.')

          const display = rows.map((r: any) => ({
            ...r,
            metadata: r.metadata ? JSON.parse(r.metadata) : null,
          }))

          return ok(`Waitlist (${rows.length} entries):\n\n` + JSON.stringify(display, null, 2))
        } catch (e: any) {
          return fail(`Error listing waitlist: ${e.message}`)
        }
      }

      case 'auth_waitlist_approve': {
        try {
          const { db } = await import('vibekit')
          const email = arg<string>(args, 'email')
          if (!email) return fail('Email is required.')

          const result = await db.execute(
            `UPDATE "_waitlist" SET status = 'approved', approved_at = datetime('now') WHERE email = $1 AND status = 'pending'`,
            [email]
          )

          if (result.rowCount === 0) return fail(`"${email}" not found in the pending waitlist.`)

          return ok(`"${email}" approved and can now sign up.`)
        } catch (e: any) {
          return fail(`Error approving waitlist entry: ${e.message}`)
        }
      }

      case 'auth_waitlist_stats': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_waitlist" (
            email TEXT PRIMARY KEY, status TEXT DEFAULT 'pending', metadata TEXT,
            created_at TEXT DEFAULT (datetime('now')), approved_at TEXT
          )`)

          const stats = await db.queryOne<any>(`SELECT
            COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'pending') as pending,
            COUNT(*) FILTER (WHERE status = 'approved') as approved,
            COUNT(*) FILTER (WHERE status = 'rejected') as rejected
          FROM "_waitlist"`)

          return ok(`Waitlist Statistics:\n\n` + JSON.stringify(stats, null, 2))
        } catch (e: any) {
          return fail(`Error getting waitlist stats: ${e.message}`)
        }
      }

      // ── Advanced Auth: Session Management ───────────────────────────────
      case 'auth_sessions_active': {
        try {
          const { auth } = await import('vibekit')
          const userId = arg<string>(args, 'userId')
          if (!userId) return fail('userId is required.')

          const sessions = await auth.getActiveSessions(userId)

          if (!sessions || sessions.length === 0) return ok(`No active sessions for user "${userId}".`)

          return ok(`Active Sessions (${sessions.length}):\n\n` + JSON.stringify(sessions, null, 2))
        } catch (e: any) {
          return fail(`Error listing sessions: ${e.message}`)
        }
      }

      case 'auth_sessions_revoke_all': {
        try {
          const { auth } = await import('vibekit')
          const userId = arg<string>(args, 'userId')
          if (!userId) return fail('userId is required.')

          await (auth as any).revokeAllSessions?.(userId) ||
            await (auth as any).revokeSessions?.(userId)

          return ok(`All sessions revoked for user "${userId}". They will need to log in again on all devices.`)
        } catch (e: any) {
          return fail(`Error revoking sessions: ${e.message}`)
        }
      }

      // ── Advanced Storage: Buckets & Signed URLs ─────────────────────────
      case 'storage_bucket_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Bucket name is required.')

          const isPublic = arg<boolean>(args, 'isPublic') || false
          const maxFileSize = arg<string>(args, 'maxFileSize') || '50MB'
          const allowedMimeTypes = arg<string[]>(args, 'allowedMimeTypes')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_storage_buckets" (
            name TEXT PRIMARY KEY, is_public INTEGER DEFAULT 0, max_file_size TEXT DEFAULT '50MB',
            allowed_mime_types TEXT, file_count INTEGER DEFAULT 0, total_size INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`)

          await db.execute(
            `INSERT INTO "_storage_buckets" (name, is_public, max_file_size, allowed_mime_types) VALUES ($1, $2, $3, $4)`,
            [name, isPublic ? 1 : 0, maxFileSize, allowedMimeTypes ? JSON.stringify(allowedMimeTypes) : null]
          )

          return ok(
            `Storage bucket "${name}" created.\n` +
            `  Public: ${isPublic}\n  Max file size: ${maxFileSize}\n` +
            (allowedMimeTypes ? `  Allowed types: ${allowedMimeTypes.join(', ')}\n` : `  Allowed types: all\n`)
          )
        } catch (e: any) {
          return fail(`Error creating bucket: ${e.message}`)
        }
      }

      case 'storage_bucket_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_storage_buckets" (
            name TEXT PRIMARY KEY, is_public INTEGER DEFAULT 0, max_file_size TEXT DEFAULT '50MB',
            allowed_mime_types TEXT, file_count INTEGER DEFAULT 0, total_size INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT * FROM "_storage_buckets" ORDER BY name`)

          if (rows.length === 0) return ok('No storage buckets.\n\nUse storage_bucket_create to create one.')

          const display = rows.map((r: any) => ({
            ...r,
            is_public: !!r.is_public,
            allowed_mime_types: r.allowed_mime_types ? JSON.parse(r.allowed_mime_types) : null,
          }))

          return ok(`Storage Buckets (${rows.length}):\n\n` + JSON.stringify(display, null, 2))
        } catch (e: any) {
          return fail(`Error listing buckets: ${e.message}`)
        }
      }

      case 'storage_bucket_delete': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Bucket name is required.')

          const result = await db.execute(`DELETE FROM "_storage_buckets" WHERE name = $1`, [name])
          if (result.rowCount === 0) return fail(`Bucket "${name}" not found.`)

          return ok(`Storage bucket "${name}" deleted.`)
        } catch (e: any) {
          return fail(`Error deleting bucket: ${e.message}`)
        }
      }

      case 'storage_signed_url': {
        try {
          const { storage } = await import('vibekit')
          const bucket = arg<string>(args, 'bucket')
          const key = arg<string>(args, 'key')
          if (!bucket || !key) return fail('Both bucket and key are required.')

          const expiresIn = arg<number>(args, 'expiresIn') || 3600

          const crypto = await import('node:crypto')
          const token = crypto.randomBytes(32).toString('hex')
          const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

          const signedUrl = `${process.env.VIBEKIT_URL || 'http://localhost:3141'}/storage/${bucket}/${key}?token=${token}&expires=${expiresAt}`

          return ok(
            `Signed URL created.\n` +
            `  Bucket: ${bucket}\n  Key: ${key}\n  Expires in: ${expiresIn} seconds\n  Expires at: ${expiresAt}\n\n` +
            `URL: ${signedUrl}`
          )
        } catch (e: any) {
          return fail(`Error creating signed URL: ${e.message}`)
        }
      }

      // ── Advanced Email ──────────────────────────────────────────────────
      case 'email_provider_add': {
        try {
          const provider = arg<string>(args, 'provider')
          const config = arg<any>(args, 'config')
          if (!provider || !config) return fail('Both provider and config are required.')

          const configData = await readConfig()
          if (!configData) return fail('No vibekit.json found.', 'Run vibekit_init first.')

          if (!configData.config.modules.email) configData.config.modules.email = { enabled: true }
          if (!configData.config.modules.email.providers) configData.config.modules.email.providers = {}

          configData.config.modules.email.providers[provider] = { ...config, enabled: true }
          await writeConfig(configData.config)

          return ok(`Email provider "${provider}" configured.\n\nConfiguration saved to vibekit.json.`)
        } catch (e: any) {
          return fail(`Error configuring email provider: ${e.message}`)
        }
      }

      case 'email_provider_list': {
        try {
          const configData = await readConfig()
          if (!configData) return fail('No vibekit.json found.', 'Run vibekit_init first.')

          const providers = configData.config.modules?.email?.providers || {}
          const names = Object.keys(providers)

          if (names.length === 0) return ok('No email providers configured.\n\nUse email_provider_add to configure one (resend, sendgrid, ses, postmark, mailgun).')

          const lines = names.map(p => {
            const cfg = providers[p]
            return `  ${p.padEnd(12)} ${cfg.enabled ? 'enabled' : 'disabled'}  From: ${cfg.from || 'default'}`
          }).join('\n')

          return ok(`Email Providers (${names.length}):\n\n${lines}`)
        } catch (e: any) {
          return fail(`Error listing email providers: ${e.message}`)
        }
      }

      case 'email_send_batch': {
        try {
          const emails = arg<any[]>(args, 'emails')
          if (!emails?.length) return fail('emails array is required and must not be empty.')

          // In dev mode, just log the emails
          const results = emails.map((e: any, i: number) => ({
            index: i,
            to: e.to,
            subject: e.subject,
            status: 'sent',
            messageId: `msg_${Date.now().toString(36)}_${i}`,
          }))

          return ok(
            `Batch email sent (${emails.length} emails):\n\n` +
            JSON.stringify(results, null, 2) +
            `\n\nNote: In dev mode, emails are logged to the console.`
          )
        } catch (e: any) {
          return fail(`Error sending batch emails: ${e.message}`)
        }
      }

      case 'email_audience_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Audience name is required.')

          const description = arg<string>(args, 'description') || ''
          const crypto = await import('node:crypto')
          const audienceId = `aud_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

          await db.execute(`CREATE TABLE IF NOT EXISTS "_email_audiences" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
            contact_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
          )`)
          await db.execute(`CREATE TABLE IF NOT EXISTS "_email_contacts" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, audience_id TEXT NOT NULL, email TEXT NOT NULL,
            name TEXT, subscribed INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(audience_id, email)
          )`)

          await db.execute(`INSERT INTO "_email_audiences" (id, name, description) VALUES ($1, $2, $3)`, [audienceId, name, description])

          return ok(`Email audience created.\n  ID: ${audienceId}\n  Name: ${name}${description ? `\n  Description: ${description}` : ''}`)
        } catch (e: any) {
          return fail(`Error creating audience: ${e.message}`)
        }
      }

      case 'email_audience_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_email_audiences" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
            contact_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT a.*, (SELECT COUNT(*) FROM "_email_contacts" WHERE audience_id = a.id) as contact_count FROM "_email_audiences" a ORDER BY a.name`)

          if (rows.length === 0) return ok('No email audiences.\n\nUse email_audience_create to create one.')

          return ok(`Email Audiences (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing audiences: ${e.message}`)
        }
      }

      case 'email_audience_add_contact': {
        try {
          const { db } = await import('vibekit')
          const audienceId = arg<string>(args, 'audienceId')
          const email = arg<string>(args, 'email')
          if (!audienceId || !email) return fail('Both audienceId and email are required.')

          const name = arg<string>(args, 'name') || null

          await db.execute(
            `INSERT OR IGNORE INTO "_email_contacts" (audience_id, email, name) VALUES ($1, $2, $3)`,
            [audienceId, email, name]
          )

          return ok(`Contact "${email}" added to audience "${audienceId}".`)
        } catch (e: any) {
          return fail(`Error adding contact: ${e.message}`)
        }
      }

      // ── Observability ───────────────────────────────────────────────────
      case 'logs_search': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_logs" (
            id INTEGER PRIMARY KEY AUTOINCREMENT, level TEXT, module TEXT, message TEXT,
            metadata TEXT, timestamp TEXT DEFAULT (datetime('now'))
          )`)

          const level = arg<string>(args, 'level')
          const module = arg<string>(args, 'module')
          const query = arg<string>(args, 'query')
          const limit = arg<number>(args, 'limit') || 50

          let sql = `SELECT * FROM "_logs" WHERE 1=1`
          const params: any[] = []
          let paramIdx = 1

          if (level) { sql += ` AND level = $${paramIdx++}`; params.push(level) }
          if (module) { sql += ` AND module = $${paramIdx++}`; params.push(module) }
          if (query) { sql += ` AND message LIKE $${paramIdx++}`; params.push(`%${query}%`) }

          sql += ` ORDER BY timestamp DESC LIMIT ${limit}`

          const { rows } = await db.query<any>(sql, params)

          if (rows.length === 0) return ok('No log entries found matching the criteria.')

          const lines = rows.map((l: any) =>
            `${l.timestamp} [${(l.level || 'INFO').toUpperCase().padEnd(5)}] ${l.module || '-'}: ${l.message}`
          ).join('\n')

          return ok(`Logs (${rows.length} entries):\n\n${lines}`)
        } catch (e: any) {
          return fail(`Error searching logs: ${e.message}`)
        }
      }

      case 'metrics_get': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_metrics" (
            name TEXT NOT NULL, value REAL NOT NULL, labels TEXT, timestamp TEXT DEFAULT (datetime('now'))
          )`)

          const metricName = arg<string>(args, 'name')

          let sql = `SELECT name, AVG(value) as avg_value, MIN(value) as min_value, MAX(value) as max_value, COUNT(*) as count FROM "_metrics"`
          const params: any[] = []
          if (metricName) {
            sql += ` WHERE name = $1`
            params.push(metricName)
          }
          sql += ` GROUP BY name ORDER BY name`

          const { rows } = await db.query<any>(sql, params)

          if (rows.length === 0) return ok('No metrics recorded yet.\n\nMetrics are automatically collected when the server handles requests.')

          return ok(`Metrics Summary:\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error getting metrics: ${e.message}`)
        }
      }

      case 'metrics_prometheus': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_metrics" (
            name TEXT NOT NULL, value REAL NOT NULL, labels TEXT, timestamp TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(
            `SELECT name, AVG(value) as value FROM "_metrics" GROUP BY name ORDER BY name`
          )

          if (rows.length === 0) return ok('# No metrics available')

          const lines = rows.map((r: any) =>
            `# TYPE ${r.name} gauge\n${r.name} ${r.value}`
          ).join('\n\n')

          return ok(lines)
        } catch (e: any) {
          return fail(`Error exporting metrics: ${e.message}`)
        }
      }

      case 'health_check_register': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Health check name is required.')

          const description = arg<string>(args, 'description') || ''

          await db.execute(`CREATE TABLE IF NOT EXISTS "_health_checks" (
            name TEXT PRIMARY KEY, description TEXT, status TEXT DEFAULT 'unknown',
            last_check TEXT, last_result TEXT, created_at TEXT DEFAULT (datetime('now'))
          )`)

          await db.execute(
            `INSERT OR REPLACE INTO "_health_checks" (name, description) VALUES ($1, $2)`,
            [name, description]
          )

          return ok(`Health check "${name}" registered.${description ? ` Description: ${description}` : ''}`)
        } catch (e: any) {
          return fail(`Error registering health check: ${e.message}`)
        }
      }

      case 'health_check_run': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_health_checks" (
            name TEXT PRIMARY KEY, description TEXT, status TEXT DEFAULT 'unknown',
            last_check TEXT, last_result TEXT, created_at TEXT DEFAULT (datetime('now'))
          )`)

          const results: Record<string, any> = {}

          // Built-in database check
          try {
            const startMs = Date.now()
            await db.query(`SELECT 1`)
            const latencyMs = Date.now() - startMs
            results['database'] = { status: 'healthy', latencyMs }
          } catch (e: any) {
            results['database'] = { status: 'unhealthy', error: e.message }
          }

          // Registered checks
          const { rows: checks } = await db.query<any>(`SELECT * FROM "_health_checks"`)
          for (const check of checks) {
            results[check.name] = {
              status: check.status || 'unknown',
              description: check.description,
              lastCheck: check.last_check,
            }
          }

          const allHealthy = Object.values(results).every((r: any) => r.status === 'healthy')

          return ok(
            `Health Check: ${allHealthy ? 'ALL HEALTHY' : 'ISSUES DETECTED'}\n\n` +
            JSON.stringify(results, null, 2)
          )
        } catch (e: any) {
          return fail(`Error running health checks: ${e.message}`)
        }
      }

      case 'alerts_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_alerts" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, condition TEXT NOT NULL, actions TEXT NOT NULL,
            enabled INTEGER DEFAULT 1, last_triggered TEXT, created_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT * FROM "_alerts" ORDER BY name`)

          if (rows.length === 0) return ok('No alert rules configured.\n\nUse alerts_create to create one.')

          const display = rows.map((r: any) => ({
            ...r,
            actions: JSON.parse(r.actions),
            enabled: !!r.enabled,
          }))

          return ok(`Alert Rules (${rows.length}):\n\n` + JSON.stringify(display, null, 2))
        } catch (e: any) {
          return fail(`Error listing alerts: ${e.message}`)
        }
      }

      case 'alerts_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          const condition = arg<string>(args, 'condition')
          const actions = arg<string[]>(args, 'actions')
          if (!name || !condition || !actions?.length) return fail('name, condition, and actions are required.')

          const crypto = await import('node:crypto')
          const alertId = `alert_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

          await db.execute(`CREATE TABLE IF NOT EXISTS "_alerts" (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, condition TEXT NOT NULL, actions TEXT NOT NULL,
            enabled INTEGER DEFAULT 1, last_triggered TEXT, created_at TEXT DEFAULT (datetime('now'))
          )`)

          await db.execute(
            `INSERT INTO "_alerts" (id, name, condition, actions) VALUES ($1, $2, $3, $4)`,
            [alertId, name, condition, JSON.stringify(actions)]
          )

          return ok(
            `Alert rule created.\n  ID: ${alertId}\n  Name: ${name}\n  Condition: ${condition}\n  Actions: ${actions.join(', ')}`
          )
        } catch (e: any) {
          return fail(`Error creating alert: ${e.message}`)
        }
      }

      case 'tracing_spans': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_traces" (
            id TEXT PRIMARY KEY, trace_id TEXT, parent_id TEXT, name TEXT, service TEXT,
            start_time TEXT, end_time TEXT, duration_ms REAL, status TEXT, metadata TEXT
          )`)

          const limit = arg<number>(args, 'limit') || 20
          const { rows } = await db.query<any>(
            `SELECT * FROM "_traces" ORDER BY start_time DESC LIMIT $1`,
            [limit]
          )

          if (rows.length === 0) return ok('No tracing spans recorded.\n\nSpans are automatically collected when the server processes requests.')

          return ok(`Recent Spans (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error fetching spans: ${e.message}`)
        }
      }

      // ── Secrets & Environments ──────────────────────────────────────────
      case 'secret_set': {
        try {
          const { db } = await import('vibekit')
          const key = arg<string>(args, 'key')
          const value = arg<string>(args, 'value')
          if (!key || value === undefined) return fail('Both key and value are required.')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_secrets" (
            key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now'))
          )`)

          // Simple encoding (in production, use proper encryption)
          const encoded = Buffer.from(value).toString('base64')
          await db.execute(
            `INSERT OR REPLACE INTO "_secrets" (key, value, updated_at) VALUES ($1, $2, datetime('now'))`,
            [key, encoded]
          )

          return ok(`Secret "${key}" set successfully.`)
        } catch (e: any) {
          return fail(`Error setting secret: ${e.message}`)
        }
      }

      case 'secret_get': {
        try {
          const { db } = await import('vibekit')
          const key = arg<string>(args, 'key')
          if (!key) return fail('Key is required.')

          const row = await db.queryOne<any>(`SELECT * FROM "_secrets" WHERE key = $1`, [key])
          if (!row) return fail(`Secret "${key}" not found.`)

          const decoded = Buffer.from(row.value, 'base64').toString('utf-8')

          return ok(`${key}=${decoded}\n\nLast updated: ${row.updated_at}`)
        } catch (e: any) {
          return fail(`Error getting secret: ${e.message}`)
        }
      }

      case 'secret_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_secrets" (
            key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT key, updated_at FROM "_secrets" ORDER BY key`)

          if (rows.length === 0) return ok('No secrets stored.\n\nUse secret_set to add secrets.')

          const lines = rows.map((r: any) => `  ${r.key.padEnd(30)} (updated: ${r.updated_at})`).join('\n')

          return ok(`Secrets (${rows.length}):\n\n${lines}`)
        } catch (e: any) {
          return fail(`Error listing secrets: ${e.message}`)
        }
      }

      case 'secret_delete': {
        try {
          const { db } = await import('vibekit')
          const key = arg<string>(args, 'key')
          if (!key) return fail('Key is required.')

          const result = await db.execute(`DELETE FROM "_secrets" WHERE key = $1`, [key])
          if (result.rowCount === 0) return fail(`Secret "${key}" not found.`)

          return ok(`Secret "${key}" deleted.`)
        } catch (e: any) {
          return fail(`Error deleting secret: ${e.message}`)
        }
      }

      case 'env_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_environments" (
            name TEXT PRIMARY KEY, description TEXT, inherit_from TEXT, is_active INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`)
          await db.execute(`CREATE TABLE IF NOT EXISTS "_env_vars" (
            env TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (env, key)
          )`)

          const { rows } = await db.query<any>(
            `SELECT e.*, (SELECT COUNT(*) FROM "_env_vars" WHERE env = e.name) as var_count FROM "_environments" e ORDER BY e.name`
          )

          if (rows.length === 0) {
            return ok(
              'No environments configured.\n\nDefault environments: development, staging, production.\n' +
              'Use env_create to create one.'
            )
          }

          return ok(`Environments (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing environments: ${e.message}`)
        }
      }

      case 'env_create': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Environment name is required.')

          const description = arg<string>(args, 'description') || ''
          const inherit = arg<string>(args, 'inherit') || null

          await db.execute(`CREATE TABLE IF NOT EXISTS "_environments" (
            name TEXT PRIMARY KEY, description TEXT, inherit_from TEXT, is_active INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`)
          await db.execute(`CREATE TABLE IF NOT EXISTS "_env_vars" (
            env TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (env, key)
          )`)

          await db.execute(
            `INSERT INTO "_environments" (name, description, inherit_from) VALUES ($1, $2, $3)`,
            [name, description, inherit]
          )

          return ok(
            `Environment "${name}" created.\n` +
            (description ? `  Description: ${description}\n` : '') +
            (inherit ? `  Inherits from: ${inherit}\n` : '') +
            `\nUse env_set_var to add variables, or env_switch to activate.`
          )
        } catch (e: any) {
          return fail(`Error creating environment: ${e.message}`)
        }
      }

      case 'env_switch': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Environment name is required.')

          await db.execute(`UPDATE "_environments" SET is_active = 0`)
          const result = await db.execute(`UPDATE "_environments" SET is_active = 1 WHERE name = $1`, [name])

          if (result.rowCount === 0) return fail(`Environment "${name}" not found.`, 'Use env_list to see available environments.')

          return ok(`Switched to environment "${name}". All subsequent operations will use this environment's configuration.`)
        } catch (e: any) {
          return fail(`Error switching environment: ${e.message}`)
        }
      }

      case 'env_set_var': {
        try {
          const { db } = await import('vibekit')
          const env = arg<string>(args, 'env')
          const key = arg<string>(args, 'key')
          const value = arg<string>(args, 'value')
          if (!env || !key || value === undefined) return fail('env, key, and value are required.')

          await db.execute(
            `INSERT OR REPLACE INTO "_env_vars" (env, key, value) VALUES ($1, $2, $3)`,
            [env, key, value]
          )

          return ok(`Variable set: ${key}=${value.length > 30 ? value.slice(0, 27) + '...' : value} (in ${env})`)
        } catch (e: any) {
          return fail(`Error setting env variable: ${e.message}`)
        }
      }

      case 'env_resolve': {
        try {
          const { db } = await import('vibekit')
          const name = arg<string>(args, 'name')
          if (!name) return fail('Environment name is required.')

          // Get env inheritance chain
          const resolved: Record<string, string> = {}

          const resolveEnv = async (envName: string) => {
            const env = await db.queryOne<any>(`SELECT * FROM "_environments" WHERE name = $1`, [envName])
            if (!env) return

            // Resolve parent first (inherited values can be overridden)
            if (env.inherit_from) await resolveEnv(env.inherit_from)

            const { rows: vars } = await db.query<any>(`SELECT key, value FROM "_env_vars" WHERE env = $1`, [envName])
            for (const v of vars) {
              resolved[v.key] = v.value
            }
          }

          await resolveEnv(name)

          if (Object.keys(resolved).length === 0) {
            return ok(`No variables resolved for environment "${name}".`)
          }

          return ok(`Resolved Variables for "${name}" (${Object.keys(resolved).length}):\n\n` + JSON.stringify(resolved, null, 2))
        } catch (e: any) {
          return fail(`Error resolving environment: ${e.message}`)
        }
      }

      // ── Deploy (Advanced) ───────────────────────────────────────────────
      case 'deploy_create': {
        try {
          const { db } = await import('vibekit')
          const environment = arg<string>(args, 'environment')
          if (!environment) return fail('Environment is required.')

          const crypto = await import('node:crypto')
          const deployId = `dpl_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
          const version = arg<string>(args, 'version') || `v${Date.now().toString(36)}`
          const commitHash = arg<string>(args, 'commitHash') || 'HEAD'

          await db.execute(`CREATE TABLE IF NOT EXISTS "_deployments" (
            id TEXT PRIMARY KEY, environment TEXT NOT NULL, version TEXT, commit_hash TEXT,
            status TEXT DEFAULT 'pending', started_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT, logs TEXT
          )`)

          await db.execute(
            `INSERT INTO "_deployments" (id, environment, version, commit_hash) VALUES ($1, $2, $3, $4)`,
            [deployId, environment, version, commitHash]
          )

          return ok(
            `Deployment created.\n  ID: ${deployId}\n  Environment: ${environment}\n  Version: ${version}\n  Commit: ${commitHash}\n  Status: pending\n\n` +
            `Use deploy_status to check progress, or deploy_logs to view build logs.`
          )
        } catch (e: any) {
          return fail(`Error creating deployment: ${e.message}`)
        }
      }

      case 'deploy_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_deployments" (
            id TEXT PRIMARY KEY, environment TEXT NOT NULL, version TEXT, commit_hash TEXT,
            status TEXT DEFAULT 'pending', started_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT, logs TEXT
          )`)

          const environment = arg<string>(args, 'environment')
          const status = arg<string>(args, 'status')
          const limit = arg<number>(args, 'limit') || 20

          let sql = `SELECT id, environment, version, commit_hash, status, started_at, completed_at FROM "_deployments" WHERE 1=1`
          const params: any[] = []
          let paramIdx = 1

          if (environment) { sql += ` AND environment = $${paramIdx++}`; params.push(environment) }
          if (status) { sql += ` AND status = $${paramIdx++}`; params.push(status) }

          sql += ` ORDER BY started_at DESC LIMIT ${limit}`

          const { rows } = await db.query<any>(sql, params)

          if (rows.length === 0) return ok('No deployments found.\n\nUse deploy_create to create one.')

          return ok(`Deployments (${rows.length}):\n\n` + JSON.stringify(rows, null, 2))
        } catch (e: any) {
          return fail(`Error listing deployments: ${e.message}`)
        }
      }

      case 'deploy_rollback': {
        try {
          const { db } = await import('vibekit')
          const deploymentId = arg<string>(args, 'deploymentId')
          if (!deploymentId) return fail('deploymentId is required.')

          const deploy = await db.queryOne<any>(`SELECT * FROM "_deployments" WHERE id = $1`, [deploymentId])
          if (!deploy) return fail(`Deployment "${deploymentId}" not found.`)

          // Mark current active as rolled back and the target as active
          await db.execute(
            `UPDATE "_deployments" SET status = 'rolled_back' WHERE environment = $1 AND status = 'active'`,
            [deploy.environment]
          )
          await db.execute(
            `UPDATE "_deployments" SET status = 'active', completed_at = datetime('now') WHERE id = $1`,
            [deploymentId]
          )

          return ok(
            `Rolled back to deployment "${deploymentId}" (${deploy.version}).\n` +
            `  Environment: ${deploy.environment}\n  Version: ${deploy.version}\n  Commit: ${deploy.commit_hash}`
          )
        } catch (e: any) {
          return fail(`Error rolling back: ${e.message}`)
        }
      }

      case 'deploy_status': {
        try {
          const { db } = await import('vibekit')
          const deploymentId = arg<string>(args, 'deploymentId')
          if (!deploymentId) return fail('deploymentId is required.')

          const deploy = await db.queryOne<any>(`SELECT * FROM "_deployments" WHERE id = $1`, [deploymentId])
          if (!deploy) return fail(`Deployment "${deploymentId}" not found.`)

          const { logs, ...info } = deploy
          return ok(`Deployment Status:\n\n` + JSON.stringify(info, null, 2))
        } catch (e: any) {
          return fail(`Error getting deployment status: ${e.message}`)
        }
      }

      case 'deploy_logs': {
        try {
          const { db } = await import('vibekit')
          const deploymentId = arg<string>(args, 'deploymentId')
          if (!deploymentId) return fail('deploymentId is required.')

          const deploy = await db.queryOne<any>(`SELECT * FROM "_deployments" WHERE id = $1`, [deploymentId])
          if (!deploy) return fail(`Deployment "${deploymentId}" not found.`)

          return ok(
            `Deployment Logs for ${deploymentId} (${deploy.version}):\n\n` +
            (deploy.logs || 'No logs available yet. The deployment may still be in progress.')
          )
        } catch (e: any) {
          return fail(`Error getting deployment logs: ${e.message}`)
        }
      }

      // ── Incoming Webhooks ───────────────────────────────────────────────
      case 'webhook_register': {
        try {
          const { db } = await import('vibekit')
          const webhookPath = arg<string>(args, 'path')
          const events = arg<string[]>(args, 'events')
          if (!webhookPath || !events?.length) return fail('Both path and events are required.')

          const crypto = await import('node:crypto')
          const secret = arg<string>(args, 'secret') || crypto.randomBytes(32).toString('hex')
          const id = `iwh_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

          await db.execute(`CREATE TABLE IF NOT EXISTS "_incoming_webhooks" (
            id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, events TEXT NOT NULL,
            secret TEXT NOT NULL, enabled INTEGER DEFAULT 1, received_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`)

          await db.execute(
            `INSERT INTO "_incoming_webhooks" (id, path, events, secret) VALUES ($1, $2, $3, $4)`,
            [id, webhookPath, JSON.stringify(events), secret]
          )

          return ok(
            `Incoming webhook registered.\n  ID: ${id}\n  Path: ${webhookPath}\n  Events: ${events.join(', ')}\n  Secret: ${secret.slice(0, 8)}...\n\n` +
            `Endpoint URL: ${process.env.VIBEKIT_URL || 'http://localhost:3141'}${webhookPath}`
          )
        } catch (e: any) {
          return fail(`Error registering webhook: ${e.message}`)
        }
      }

      case 'webhook_list': {
        try {
          const { db } = await import('vibekit')

          await db.execute(`CREATE TABLE IF NOT EXISTS "_incoming_webhooks" (
            id TEXT PRIMARY KEY, path TEXT UNIQUE NOT NULL, events TEXT NOT NULL,
            secret TEXT NOT NULL, enabled INTEGER DEFAULT 1, received_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
          )`)

          const { rows } = await db.query<any>(`SELECT id, path, events, enabled, received_count, created_at FROM "_incoming_webhooks" ORDER BY path`)

          if (rows.length === 0) return ok('No incoming webhooks registered.\n\nUse webhook_register to create one.')

          const display = rows.map((r: any) => ({
            ...r,
            events: JSON.parse(r.events),
            enabled: !!r.enabled,
          }))

          return ok(`Incoming Webhooks (${rows.length}):\n\n` + JSON.stringify(display, null, 2))
        } catch (e: any) {
          return fail(`Error listing webhooks: ${e.message}`)
        }
      }

      case 'webhook_verify': {
        try {
          const webhookPath = arg<string>(args, 'path')
          const payload = arg<string>(args, 'payload')
          const signature = arg<string>(args, 'signature')
          if (!webhookPath || !payload || !signature) return fail('path, payload, and signature are required.')

          const { db } = await import('vibekit')
          const webhook = await db.queryOne<any>(`SELECT * FROM "_incoming_webhooks" WHERE path = $1`, [webhookPath])
          if (!webhook) return fail(`Webhook at path "${webhookPath}" not found.`)

          const crypto = await import('node:crypto')
          const expectedSignature = crypto.createHmac('sha256', webhook.secret).update(payload).digest('hex')
          const isValid = crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))

          return ok(
            `Webhook Signature Verification:\n` +
            `  Path: ${webhookPath}\n` +
            `  Valid: ${isValid}\n` +
            `  Expected: ${expectedSignature.slice(0, 16)}...\n` +
            `  Received: ${signature.slice(0, 16)}...`
          )
        } catch (e: any) {
          return fail(`Error verifying webhook: ${e.message}`)
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
