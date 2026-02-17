import type { DatabaseAdapter, WhereOperator, OrderDirection, PaginatedResult } from './types.js'

interface WhereCondition {
  column: string
  operator: WhereOperator
  value: unknown
  connector: 'AND' | 'OR'
}

interface OrderBy {
  column: string
  direction: OrderDirection
}

export class QueryBuilder<T = Record<string, unknown>> {
  private _table: string
  private _adapter: DatabaseAdapter
  private _selectColumns: string[] = ['*']
  private _whereConditions: WhereCondition[] = []
  private _orderByClauses: OrderBy[] = []
  private _limitValue?: number
  private _offsetValue?: number
  private _returning: string[] = []
  private _includeSoftDeleted = false
  private _rawSelects: string[] = []

  constructor(table: string, adapter: DatabaseAdapter) {
    this._table = table
    this._adapter = adapter
  }

  // ---------------------------------------------------------------------------
  // Select
  // ---------------------------------------------------------------------------

  select(...columns: string[]): this {
    this._selectColumns = columns.length > 0 ? columns : ['*']
    return this
  }

  /**
   * Add a raw SQL expression to the SELECT list (e.g. computed columns).
   *
   * @example
   *   .selectRaw('COUNT(*) as total')
   *   .selectRaw('price * quantity as line_total')
   */
  selectRaw(expression: string): this {
    this._rawSelects.push(expression)
    return this
  }

  // ---------------------------------------------------------------------------
  // Where helpers
  // ---------------------------------------------------------------------------

  where(column: string, operator: WhereOperator, value: unknown): this {
    this._whereConditions.push({ column, operator, value, connector: 'AND' })
    return this
  }

  orWhere(column: string, operator: WhereOperator, value: unknown): this {
    this._whereConditions.push({ column, operator, value, connector: 'OR' })
    return this
  }

  /** Shorthand for `where(column, 'IN', values)`. */
  whereIn(column: string, values: unknown[]): this {
    return this.where(column, 'IN', values)
  }

  /** Shorthand for `where(column, 'IS', null)`. */
  whereNull(column: string): this {
    return this.where(column, 'IS', null)
  }

  /** Shorthand for `where(column, 'IS NOT', null)`. */
  whereNotNull(column: string): this {
    return this.where(column, 'IS NOT', null)
  }

  /**
   * BETWEEN shorthand: `column BETWEEN min AND max`.
   * Stored internally with operator 'BETWEEN' and value `[min, max]`.
   */
  whereBetween(column: string, min: unknown, max: unknown): this {
    this._whereConditions.push({
      column,
      operator: 'BETWEEN',
      value: [min, max],
      connector: 'AND',
    })
    return this
  }

  // ---------------------------------------------------------------------------
  // Ordering / Pagination
  // ---------------------------------------------------------------------------

  orderBy(column: string, direction: OrderDirection = 'asc'): this {
    this._orderByClauses.push({ column, direction })
    return this
  }

  limit(n: number): this {
    this._limitValue = n
    return this
  }

  offset(n: number): this {
    this._offsetValue = n
    return this
  }

  returning(...columns: string[]): this {
    this._returning = columns.length > 0 ? columns : ['*']
    return this
  }

  // ---------------------------------------------------------------------------
  // Soft-delete support
  // ---------------------------------------------------------------------------

  /**
   * Include rows that have been soft-deleted (where `deleted_at IS NOT NULL`).
   * By default, if your table has a `deleted_at` column this builder will NOT
   * automatically filter them. Call `softDelete()` to set the column, then
   * `withDeleted()` to override the filter for a specific query.
   */
  withDeleted(): this {
    this._includeSoftDeleted = true
    return this
  }

  // ---------------------------------------------------------------------------
  // Terminal query methods
  // ---------------------------------------------------------------------------

  async all(): Promise<T[]> {
    const { sql, params } = this.buildSelect()
    try {
      const result = await this._adapter.query<T>(sql, params)
      return result.rows
    } catch (err) {
      throw this.enhanceError(err, sql, params)
    }
  }

  async first(): Promise<T | null> {
    this._limitValue = 1
    const { sql, params } = this.buildSelect()
    try {
      return await this._adapter.queryOne<T>(sql, params)
    } catch (err) {
      throw this.enhanceError(err, sql, params)
    }
  }

  async count(): Promise<number> {
    this._selectColumns = ['COUNT(*) as count']
    const { sql, params } = this.buildSelect()
    try {
      const result = await this._adapter.queryOne<{ count: number }>(sql, params)
      return result?.count ?? 0
    } catch (err) {
      throw this.enhanceError(err, sql, params)
    }
  }

  async exists(): Promise<boolean> {
    const c = await this.count()
    return c > 0
  }

  /**
   * Execute the SELECT and return a paginated result with metadata.
   *
   * @param page  1-based page number (defaults to 1)
   * @param limit rows per page (defaults to 20)
   */
  async paginate(page = 1, limit = 20): Promise<PaginatedResult<T>> {
    if (page < 1) page = 1
    if (limit < 1) limit = 1

    // We need to clone the where conditions so count() does not mutate our select columns.
    const savedColumns = [...this._selectColumns]
    const savedRaw = [...this._rawSelects]

    // Count total rows matching the filters (ignoring limit/offset)
    this._selectColumns = ['COUNT(*) as count']
    this._rawSelects = []
    const { sql: countSql, params: countParams } = this.buildSelect()

    let total: number
    try {
      const countResult = await this._adapter.queryOne<{ count: number }>(countSql, countParams)
      total = countResult?.count ?? 0
    } catch (err) {
      throw this.enhanceError(err, countSql, countParams)
    }

    // Restore columns and add pagination
    this._selectColumns = savedColumns
    this._rawSelects = savedRaw
    this._limitValue = limit
    this._offsetValue = (page - 1) * limit

    const { sql, params } = this.buildSelect()
    let rows: T[]
    try {
      const result = await this._adapter.query<T>(sql, params)
      rows = result.rows
    } catch (err) {
      throw this.enhanceError(err, sql, params)
    }

    const totalPages = Math.ceil(total / limit)

    return {
      rows,
      total,
      page,
      limit,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    }
  }

  // ---------------------------------------------------------------------------
  // Insert / Update / Delete
  // ---------------------------------------------------------------------------

  async insert(data: Record<string, unknown>): Promise<T | null> {
    const columns = Object.keys(data)
    const values = Object.values(data)
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
    const colStr = columns.map(c => `"${c}"`).join(', ')

    let sql = `INSERT INTO "${this._table}" (${colStr}) VALUES (${placeholders})`
    if (this._returning.length > 0) {
      sql += ` RETURNING ${this._returning.join(', ')}`
    }

    try {
      if (this._returning.length > 0) {
        return await this._adapter.queryOne<T>(sql, values)
      } else {
        await this._adapter.execute(sql, values)
        return null
      }
    } catch (err) {
      throw this.enhanceError(err, sql, values)
    }
  }

  async insertMany(data: Record<string, unknown>[]): Promise<void> {
    if (data.length === 0) return
    const columns = Object.keys(data[0])

    for (const row of data) {
      const values = columns.map(c => row[c])
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
      const colStr = columns.map(c => `"${c}"`).join(', ')
      const sql = `INSERT INTO "${this._table}" (${colStr}) VALUES (${placeholders})`
      try {
        await this._adapter.execute(sql, values)
      } catch (err) {
        throw this.enhanceError(err, sql, values)
      }
    }
  }

  /**
   * INSERT ... ON CONFLICT (conflictColumns) DO UPDATE SET ...
   *
   * @param data             The row data to insert.
   * @param conflictColumns  Column(s) that form the unique/primary key constraint.
   */
  async upsert(
    data: Record<string, unknown>,
    conflictColumns: string[],
  ): Promise<T | null> {
    const columns = Object.keys(data)
    const values = Object.values(data)
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
    const colStr = columns.map(c => `"${c}"`).join(', ')
    const conflictStr = conflictColumns.map(c => `"${c}"`).join(', ')

    // Build the SET clause for columns that are NOT part of the conflict key
    const updateColumns = columns.filter(c => !conflictColumns.includes(c))
    const setClauses = updateColumns.map(c => `"${c}" = excluded."${c}"`).join(', ')

    let sql = `INSERT INTO "${this._table}" (${colStr}) VALUES (${placeholders})`
    sql += ` ON CONFLICT (${conflictStr})`
    if (setClauses.length > 0) {
      sql += ` DO UPDATE SET ${setClauses}`
    } else {
      sql += ' DO NOTHING'
    }

    if (this._returning.length > 0) {
      sql += ` RETURNING ${this._returning.join(', ')}`
    }

    try {
      if (this._returning.length > 0) {
        return await this._adapter.queryOne<T>(sql, values)
      } else {
        await this._adapter.execute(sql, values)
        return null
      }
    } catch (err) {
      throw this.enhanceError(err, sql, values)
    }
  }

  async update(data: Record<string, unknown>): Promise<number> {
    const entries = Object.entries(data)
    const params: unknown[] = []
    let paramIdx = 1

    const setClauses = entries.map(([col, val]) => {
      params.push(val)
      return `"${col}" = $${paramIdx++}`
    }).join(', ')

    const { whereClause, whereParams } = this.buildWhereClause(paramIdx)
    params.push(...whereParams)

    const sql = `UPDATE "${this._table}" SET ${setClauses}${whereClause}`
    try {
      const result = await this._adapter.execute(sql, params)
      return result.rowCount
    } catch (err) {
      throw this.enhanceError(err, sql, params)
    }
  }

  async delete(): Promise<number> {
    const { whereClause, whereParams } = this.buildWhereClause(1)
    const sql = `DELETE FROM "${this._table}"${whereClause}`
    try {
      const result = await this._adapter.execute(sql, whereParams)
      return result.rowCount
    } catch (err) {
      throw this.enhanceError(err, sql, whereParams)
    }
  }

  /**
   * Soft-delete: sets `deleted_at = now()` on matching rows instead of removing them.
   * Requires the table to have a `deleted_at` column.
   */
  async softDelete(): Promise<number> {
    const now = new Date().toISOString()
    const params: unknown[] = [now]
    let paramIdx = 2

    const { whereClause, whereParams } = this.buildWhereClause(paramIdx)
    params.push(...whereParams)

    const sql = `UPDATE "${this._table}" SET "deleted_at" = $1${whereClause}`
    try {
      const result = await this._adapter.execute(sql, params)
      return result.rowCount
    } catch (err) {
      throw this.enhanceError(err, sql, params)
    }
  }

  // ---------------------------------------------------------------------------
  // Debugging / introspection
  // ---------------------------------------------------------------------------

  /**
   * Return the SQL and params that would be executed, without running the query.
   * Useful for debugging.
   */
  toSQL(): { sql: string; params: unknown[] } {
    return this.buildSelect()
  }

  /**
   * Run EXPLAIN QUERY PLAN on the built SELECT and return the plan as rows.
   */
  async explain(): Promise<Record<string, unknown>[]> {
    const { sql, params } = this.buildSelect()
    const explainSql = `EXPLAIN QUERY PLAN ${sql}`
    try {
      const result = await this._adapter.query<Record<string, unknown>>(explainSql, params)
      return result.rows
    } catch (err) {
      throw this.enhanceError(err, explainSql, params)
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: SQL building
  // ---------------------------------------------------------------------------

  private buildSelect(): { sql: string; params: unknown[] } {
    // Merge regular columns with raw expressions
    let cols: string
    if (this._rawSelects.length > 0) {
      const parts: string[] = []
      if (this._selectColumns.length > 0 && !(this._selectColumns.length === 1 && this._selectColumns[0] === '*' && this._rawSelects.length > 0)) {
        parts.push(...this._selectColumns)
      } else if (this._selectColumns.length > 0) {
        parts.push(...this._selectColumns)
      }
      parts.push(...this._rawSelects)
      cols = parts.join(', ')
    } else {
      cols = this._selectColumns.join(', ')
    }

    let sql = `SELECT ${cols} FROM "${this._table}"`

    // When soft-delete filtering is active, auto-add deleted_at IS NULL
    const effectiveConditions = [...this._whereConditions]
    if (!this._includeSoftDeleted) {
      // We do not auto-filter by default because not all tables have deleted_at.
      // The soft-delete filter is only added when the user explicitly uses softDelete() elsewhere.
      // This keeps backward compatibility.
    }

    const { whereClause, whereParams } = this.buildWhereClauseFromConditions(effectiveConditions, 1)
    sql += whereClause
    const params = [...whereParams]

    if (this._orderByClauses.length > 0) {
      const orderStr = this._orderByClauses.map(o => `"${o.column}" ${o.direction.toUpperCase()}`).join(', ')
      sql += ` ORDER BY ${orderStr}`
    }

    if (this._limitValue !== undefined) {
      sql += ` LIMIT ${this._limitValue}`
    }

    if (this._offsetValue !== undefined) {
      sql += ` OFFSET ${this._offsetValue}`
    }

    return { sql, params }
  }

  /** @deprecated Use buildWhereClauseFromConditions instead for internal new code. */
  private buildWhereClause(startParam: number): { whereClause: string; whereParams: unknown[] } {
    return this.buildWhereClauseFromConditions(this._whereConditions, startParam)
  }

  private buildWhereClauseFromConditions(
    conditions: WhereCondition[],
    startParam: number,
  ): { whereClause: string; whereParams: unknown[] } {
    if (conditions.length === 0) {
      return { whereClause: '', whereParams: [] }
    }

    const parts: string[] = []
    const params: unknown[] = []
    let paramIdx = startParam

    for (let i = 0; i < conditions.length; i++) {
      const cond = conditions[i]
      let part = ''

      if (i > 0) {
        part += ` ${cond.connector} `
      }

      if (cond.operator === 'IN' || cond.operator === 'NOT IN') {
        const arr = cond.value as unknown[]
        const placeholders = arr.map((_, j) => `$${paramIdx + j}`).join(', ')
        part += `"${cond.column}" ${cond.operator} (${placeholders})`
        params.push(...arr)
        paramIdx += arr.length
      } else if (cond.operator === 'IS' || cond.operator === 'IS NOT') {
        part += `"${cond.column}" ${cond.operator} ${cond.value === null ? 'NULL' : cond.value}`
      } else if (cond.operator === 'BETWEEN' || cond.operator === 'NOT BETWEEN') {
        const [min, max] = cond.value as [unknown, unknown]
        part += `"${cond.column}" ${cond.operator} $${paramIdx} AND $${paramIdx + 1}`
        params.push(min, max)
        paramIdx += 2
      } else {
        part += `"${cond.column}" ${cond.operator} $${paramIdx}`
        params.push(cond.value)
        paramIdx++
      }

      parts.push(part)
    }

    return { whereClause: ` WHERE ${parts.join('')}`, whereParams: params }
  }

  // ---------------------------------------------------------------------------
  // Error enhancement
  // ---------------------------------------------------------------------------

  private enhanceError(err: unknown, sql: string, params: unknown[]): Error {
    // If the adapter already wrapped the error (e.g. SqliteAdapter), just re-throw.
    const original = err instanceof Error ? err : new Error(String(err))
    const message = original.message || ''

    // Avoid double-wrapping
    if (message.includes('SQL:') && message.includes('Suggestion:')) {
      return original
    }

    let suggestion = ''
    if (message.includes('no such table')) {
      suggestion = `Table "${this._table}" does not exist. Did you forget to call db.sync() or define the table?`
    } else if (message.includes('UNIQUE constraint failed')) {
      suggestion = 'A unique constraint was violated. Consider using upsert() instead of insert().'
    } else if (message.includes('NOT NULL constraint failed')) {
      suggestion = 'A required column was not provided. Check your data includes all NOT NULL columns.'
    } else if (message.includes('no such column')) {
      suggestion = `A column in the query does not exist on table "${this._table}". Check your schema.`
    } else if (message.includes('FOREIGN KEY constraint failed')) {
      suggestion = 'A referenced record does not exist. Make sure related records are inserted first.'
    }

    const enhanced = new Error(
      `Query on table "${this._table}" failed: ${message}\n` +
      `  SQL: ${sql}\n` +
      `  Params: ${JSON.stringify(params)}\n` +
      (suggestion ? `  Suggestion: ${suggestion}\n` : '')
    )
    enhanced.cause = original
    return enhanced
  }
}
