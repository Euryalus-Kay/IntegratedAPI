# Database

VibeKit provides a database module that works with SQLite in local development and Postgres in production. No configuration required.

## Schema Definition

```typescript
import { db } from 'vibekit'

db.defineTable('posts', {
  id: { type: 'uuid', primaryKey: true, default: 'gen_random_uuid()' },
  title: { type: 'text', notNull: true },
  body: { type: 'text' },
  published: { type: 'boolean', default: false },
})
```

## Query Builder

```typescript
const posts = await db.from('posts')
  .where('published', '=', true)
  .orderBy('created_at', 'desc')
  .limit(10)
  .all()
```

## Raw SQL

```typescript
const result = await db.query('SELECT * FROM posts WHERE id = $1', [postId])
```

## Transactions

```typescript
await db.transaction(async (tx) => {
  await tx.execute('INSERT INTO posts (title) VALUES ($1)', ['Hello'])
  await tx.execute('UPDATE counters SET count = count + 1')
})
```
