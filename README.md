<p align="center">
  <h3 align="center">VibeKit</h3>
</p>

<h3 align="center">The complete backend for AI-coded apps</h3>

<p align="center">
  Database, auth, storage, email, realtime, and deployment in one package.<br/>
  Zero configuration. One import replaces Supabase + Vercel + Railway.
</p>

---

## Install

```bash
npm install vibekit
```

```typescript
import { db, auth, storage, email } from 'vibekit'

// Database: just works. SQLite locally, Postgres in production.
const users = await db.from('users').select('*').all()

// Auth: email + verification code. No passwords.
await auth.sendCode('user@example.com')
const session = await auth.verifyCode('user@example.com', '847291')

// Storage: upload files. Local filesystem locally, cloud in production.
const file = await storage.upload(buffer, { filename: 'photo.jpg' })

// Email: send transactional email. Console output locally, real email in production.
await email.send({ to: 'user@example.com', template: 'welcome' })
```

## What is VibeKit?

VibeKit is a backend infrastructure SDK that provides database, authentication, file storage, transactional email, realtime WebSockets, and deployment in a single npm package.

It is designed for developers who build apps with AI coding tools like Claude Code and Cursor. The SDK auto-detects the environment: in local development it uses SQLite and the local filesystem with zero external dependencies; in production it uses managed Postgres, cloud storage, and a global CDN.

VibeKit replaces the need to separately set up and manage Supabase (database, auth), Vercel (hosting, CDN), and Railway (backend, containers). One package, one account, one bill.

## Features

| Feature | What it does | Local mode | Production mode |
|---------|-------------|------------|-----------------|
| Database | SQL queries, query builder, schema migrations | SQLite (embedded) | Postgres (Neon) |
| Auth | Email + verification code login, sessions, middleware | Codes shown in terminal | Codes sent via email |
| Storage | File upload, download, delete, signed URLs | Local filesystem | Cloudflare R2 |
| Email | Transactional email with templates | Console output | Resend / SMTP |
| Realtime | WebSocket channels, presence, DB change subscriptions | Local WebSocket server | Production WebSocket |
| Deploy | One-command deployment to production | N/A | Cloudflare Pages + Fly.io |

## Quick Start

```bash
# Create a new project
npx create-vibekit my-app
cd my-app

# Start local development
npx vibekit dev

# Deploy to production
npx vibekit deploy
```

## Database

```typescript
import { db } from 'vibekit'

// Define your schema
db.defineTable('posts', {
  id: { type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
  title: { type: 'text', notNull: true },
  body: { type: 'text' },
  published: { type: 'boolean', default: false },
  created_at: { type: 'timestamp', default: 'now()' },
})

// Query with the builder
const posts = await db.from('posts')
  .select('*')
  .where('published', '=', true)
  .orderBy('created_at', 'desc')
  .limit(10)
  .all()

// Or use raw SQL
const result = await db.query('SELECT * FROM posts WHERE published = $1', [true])

// Insert
await db.from('posts').insert({ title: 'Hello World', body: 'First post' })

// Transactions
await db.transaction(async (tx) => {
  const user = await tx.queryOne('INSERT INTO users (name) VALUES ($1) RETURNING *', ['Zain'])
  await tx.execute('INSERT INTO posts (title, author_id) VALUES ($1, $2)', ['Post', user.id])
})
```

## Authentication

```typescript
import { auth } from 'vibekit'

// Send a verification code
await auth.sendCode('user@example.com')

// Verify the code (creates account if new, logs in if existing)
const { user, token } = await auth.verifyCode('user@example.com', '847291')

// Get current user
const user = await auth.getUser(request)
```

No passwords. No OAuth configuration. No redirect URLs. Email and a 6-digit code.

## Storage

```typescript
import { storage } from 'vibekit'

const file = await storage.upload(buffer, {
  filename: 'avatar.png',
  folder: 'avatars',
})

const url = storage.getUrl('avatars/avatar.png')
const files = await storage.list({ folder: 'avatars' })
await storage.delete('avatars/avatar.png')
```

## CLI

```bash
vibekit login          # Authenticate (email + code)
vibekit init           # Create a new project
vibekit dev            # Start local dev server
vibekit deploy         # Deploy to production
vibekit db push        # Push schema changes
vibekit db studio      # Open database browser
vibekit auth enable    # Enable authentication
vibekit auth users     # List users
vibekit storage list   # List uploaded files
vibekit logs           # View production logs
vibekit status         # Check project health
```

## MCP Server (for Claude Code and Cursor)

Install the MCP server to give your AI coding agent full access to VibeKit tools:

```bash
npx vibekit-mcp
```

## How does VibeKit compare to Supabase?

| | VibeKit | Supabase + Vercel + Railway |
|---|---------|---------------------------|
| Packages to install | 1 | 3+ |
| Accounts to create | 1 | 3 |
| Dashboard required | No | Yes (3 dashboards) |
| Configuration files | 0 | Multiple (.env, vercel.json, etc.) |
| Works offline | Yes (SQLite) | No |
| AI agent support | Native MCP server | Limited |
| Deploy command | `vibekit deploy` | Separate per service |

## License

MIT
