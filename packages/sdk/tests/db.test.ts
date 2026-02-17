import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestDb } from '../src/testing/index.js'
import { QueryBuilder } from '../src/db/query-builder.js'
import type { DatabaseAdapter } from '../src/db/types.js'

describe('SQLite Adapter', () => {
  let db: DatabaseAdapter

  beforeEach(() => {
    db = createTestDb()
  })

  afterEach(async () => {
    await db.close()
  })

  it('creates tables and inserts data', async () => {
    await db.execute(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, age INTEGER)`)
    await db.execute(`INSERT INTO users (id, name, age) VALUES ($1, $2, $3)`, ['1', 'Alice', 30])
    const result = await db.query<{ id: string; name: string; age: number }>('SELECT * FROM users')
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].name).toBe('Alice')
    expect(result.rows[0].age).toBe(30)
  })

  it('handles parameterized queries with $N syntax', async () => {
    await db.execute(`CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)`)
    await db.execute(`INSERT INTO items (id, value) VALUES ($1, $2)`, [1, 'hello'])
    await db.execute(`INSERT INTO items (id, value) VALUES ($1, $2)`, [2, 'world'])
    const result = await db.query<{ value: string }>('SELECT value FROM items WHERE id = $1', [1])
    expect(result.rows[0].value).toBe('hello')
  })

  it('converts booleans to integers', async () => {
    await db.execute(`CREATE TABLE flags (id INTEGER, active INTEGER)`)
    await db.execute(`INSERT INTO flags (id, active) VALUES ($1, $2)`, [1, true])
    const result = await db.queryOne<{ active: number }>('SELECT active FROM flags WHERE id = $1', [1])
    expect(result?.active).toBe(1)
  })

  it('supports queryOne returning null', async () => {
    await db.execute(`CREATE TABLE empty (id INTEGER)`)
    const result = await db.queryOne('SELECT * FROM empty WHERE id = $1', [999])
    expect(result).toBeNull()
  })

  it('supports transactions with commit', async () => {
    await db.execute(`CREATE TABLE accounts (id INTEGER, balance INTEGER)`)
    await db.execute(`INSERT INTO accounts (id, balance) VALUES ($1, $2)`, [1, 100])
    await db.execute(`INSERT INTO accounts (id, balance) VALUES ($1, $2)`, [2, 200])

    await db.transaction(async (tx) => {
      await tx.execute('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [50, 1])
      await tx.execute('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [50, 2])
    })

    const a1 = await db.queryOne<{ balance: number }>('SELECT balance FROM accounts WHERE id = $1', [1])
    const a2 = await db.queryOne<{ balance: number }>('SELECT balance FROM accounts WHERE id = $1', [2])
    expect(a1?.balance).toBe(50)
    expect(a2?.balance).toBe(250)
  })

  it('rolls back transactions on error', async () => {
    await db.execute(`CREATE TABLE data (id INTEGER PRIMARY KEY, val TEXT)`)
    await db.execute(`INSERT INTO data (id, val) VALUES ($1, $2)`, [1, 'original'])

    try {
      await db.transaction(async (tx) => {
        await tx.execute('UPDATE data SET val = $1 WHERE id = $2', ['changed', 1])
        throw new Error('abort')
      })
    } catch {}

    const result = await db.queryOne<{ val: string }>('SELECT val FROM data WHERE id = $1', [1])
    expect(result?.val).toBe('original')
  })

  it('supports gen_random_uuid() function', async () => {
    await db.execute(`CREATE TABLE uuids (id TEXT DEFAULT (gen_random_uuid()) PRIMARY KEY, name TEXT)`)
    await db.execute(`INSERT INTO uuids (name) VALUES ($1)`, ['test'])
    const result = await db.queryOne<{ id: string; name: string }>('SELECT * FROM uuids')
    expect(result?.id).toBeTruthy()
    expect(result?.id.length).toBe(36) // UUID format
  })
})

describe('QueryBuilder', () => {
  let db: DatabaseAdapter

  beforeEach(async () => {
    db = createTestDb()
    await db.execute(`CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT, published INTEGER DEFAULT 0, author TEXT, created_at TEXT DEFAULT (datetime('now')))`)
    await db.execute(`INSERT INTO posts (id, title, published, author) VALUES ($1, $2, $3, $4)`, [1, 'First', 1, 'Alice'])
    await db.execute(`INSERT INTO posts (id, title, published, author) VALUES ($1, $2, $3, $4)`, [2, 'Second', 0, 'Bob'])
    await db.execute(`INSERT INTO posts (id, title, published, author) VALUES ($1, $2, $3, $4)`, [3, 'Third', 1, 'Alice'])
  })

  afterEach(async () => {
    await db.close()
  })

  it('selects all rows', async () => {
    const qb = new QueryBuilder('posts', db)
    const rows = await qb.all()
    expect(rows).toHaveLength(3)
  })

  it('filters with where', async () => {
    const qb = new QueryBuilder<{ title: string }>('posts', db)
    const rows = await qb.where('published', '=', 1).all()
    expect(rows).toHaveLength(2)
  })

  it('orders results', async () => {
    const qb = new QueryBuilder<{ id: number }>('posts', db)
    const rows = await qb.orderBy('id', 'desc').all()
    expect(rows[0].id).toBe(3)
  })

  it('limits results', async () => {
    const qb = new QueryBuilder('posts', db)
    const rows = await qb.limit(1).all()
    expect(rows).toHaveLength(1)
  })

  it('gets first result', async () => {
    const qb = new QueryBuilder<{ title: string }>('posts', db)
    const row = await qb.where('id', '=', 1).first()
    expect(row?.title).toBe('First')
  })

  it('counts rows', async () => {
    const qb = new QueryBuilder('posts', db)
    const count = await qb.where('published', '=', 1).count()
    expect(count).toBe(2)
  })

  it('checks existence', async () => {
    const qb = new QueryBuilder('posts', db)
    const exists = await qb.where('id', '=', 1).exists()
    expect(exists).toBe(true)

    const notExists = await new QueryBuilder('posts', db).where('id', '=', 999).exists()
    expect(notExists).toBe(false)
  })

  it('inserts data', async () => {
    const qb = new QueryBuilder('posts', db)
    await qb.insert({ id: 4, title: 'Fourth', published: 1, author: 'Charlie' })
    const count = await new QueryBuilder('posts', db).count()
    expect(count).toBe(4)
  })

  it('updates data', async () => {
    const qb = new QueryBuilder('posts', db)
    const affected = await qb.where('id', '=', 1).update({ title: 'Updated' })
    expect(affected).toBe(1)
    const row = await new QueryBuilder<{ title: string }>('posts', db).where('id', '=', 1).first()
    expect(row?.title).toBe('Updated')
  })

  it('deletes data', async () => {
    const qb = new QueryBuilder('posts', db)
    const deleted = await qb.where('id', '=', 2).delete()
    expect(deleted).toBe(1)
    const count = await new QueryBuilder('posts', db).count()
    expect(count).toBe(2)
  })

  it('supports orWhere', async () => {
    const qb = new QueryBuilder('posts', db)
    const rows = await qb.where('id', '=', 1).orWhere('id', '=', 3).all()
    expect(rows).toHaveLength(2)
  })

  it('returns SQL with toSQL', async () => {
    const qb = new QueryBuilder('posts', db)
    const { sql, params } = qb.where('published', '=', 1).limit(5).toSQL()
    expect(sql).toContain('SELECT')
    expect(sql).toContain('WHERE')
    expect(sql).toContain('LIMIT')
    expect(params).toEqual([1])
  })
})
