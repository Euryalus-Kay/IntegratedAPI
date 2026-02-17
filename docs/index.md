# VibeKit Documentation

VibeKit is the complete backend for AI-coded apps. Database, auth, storage, email, realtime, and deployment in one package.

## Install

```bash
npm install vibekit
```

## Quick Start

1. Create a project: `npx create-vibekit my-app`
2. Start development: `npx vibekit dev`
3. Build your app using `import { db, auth, storage, email } from 'vibekit'`
4. Deploy: `npx vibekit deploy`

## Modules

- [Database](./sdk/database.md): Query builder, raw SQL, schema migrations, transactions
- [Authentication](./sdk/auth.md): Email + code login, sessions, middleware, user management
- [Storage](./sdk/storage.md): File upload, download, signed URLs
- [Email](./sdk/email.md): Transactional email, templates, local dev preview
- [Realtime](./sdk/realtime.md): WebSocket channels, presence
- [Configuration](./sdk/config.md): Environment detection, project settings

## Tools

- [CLI Reference](./cli/commands.md): All terminal commands
- [MCP Server](./mcp/tools.md): AI agent tools for Claude Code and Cursor
