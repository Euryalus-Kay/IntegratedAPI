import type { DatabaseAdapter, WhereOperator, OrderDirection } from './types.js'

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

  constructor(table: string, adapter: DatabaseAdapter) {
    this._table = table
    this._adapter = adapter
  }

  select(...columns: string[]): this {
    this._selectColumns = columns.length > 0 ? columns : ['*']
    return this
  }

  where(column: string, operator: WhereOperator, value: unknown): this {
    this._whereConditions.push({ column, operator, value, connector: 'AND' })
    return this
  }

  orWhere(column: string, operator: WhereOperator, value: unknown): this {
    this._whereConditions.push({ column, operator, value, connector: 'OR' })
    return this
  }

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

  async all(): Promise<T[]> {
    const { sql, params } = this.buildSelect()
    const result = await this._adapter.query<T>(sql, params)
    return result.rows
  }

  async first(): Promise<T | null> {
    this._limitValue = 1
    const { sql, params } = this.buildSelect()
    return this._adapter.queryOne<T>(sql, params)
  }

  async count(): Promise<number> {
    this._selectColumns = ['COUNT(*) as count']
    const { sql, params } = this.buildSelect()
    const result = await this._adapter.queryOne<{ count: number }>(sql, params)
    return result?.count ?? 0
  }

  async exists(): Promise<boolean> {
    const c = await this.count()
    return c > 0
  }

  async insert(data: Record<string, unknown>): Promise<T | null> {
    const columns = Object.keys(data)
    const values = Object.values(data)
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
    const colStr = columns.map(c => `"${c}"`).join(', ')

    let sql = `INSERT INTO "${this._table}" (${colStr}) VALUES (${placeholders})`
    if (this._returning.length > 0) {
      sql += ` RETURNING ${this._returning.join(', ')}`
    }

    if (this._returning.length > 0) {
      return this._adapter.queryOne<T>(sql, values)
    } else {
      await this._adapter.execute(sql, values)
      return null
    }
  }

  async insertMany(data: Record<string, unknown>[]): Promise<void> {
    if (data.length === 0) return
    const columns = Object.keys(data[0])

    for (const row of data) {
      const values = columns.map(c => row[c])
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ')
      const colStr = columns.map(c => `"${c}"`).join(', ')
      await this._adapter.execute(
        `INSERT INTO "${this._table}" (${colStr}) VALUES (${placeholders})`,
        values
      )
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
    const result = await this._adapter.execute(sql, params)
    return result.rowCount
  }

  async delete(): Promise<number> {
    const { whereClause, whereParams } = this.buildWhereClause(1)
    const sql = `DELETE FROM "${this._table}"${whereClause}`
    const result = await this._adapter.execute(sql, whereParams)
    return result.rowCount
  }

  private buildSelect(): { sql: string; params: unknown[] } {
    const cols = this._selectColumns.join(', ')
    let sql = `SELECT ${cols} FROM "${this._table}"`

    const { whereClause, whereParams } = this.buildWhereClause(1)
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

  private buildWhereClause(startParam: number): { whereClause: string; whereParams: unknown[] } {
    if (this._whereConditions.length === 0) {
      return { whereClause: '', whereParams: [] }
    }

    const parts: string[] = []
    const params: unknown[] = []
    let paramIdx = startParam

    for (let i = 0; i < this._whereConditions.length; i++) {
      const cond = this._whereConditions[i]
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
      } else {
        part += `"${cond.column}" ${cond.operator} $${paramIdx}`
        params.push(cond.value)
        paramIdx++
      }

      parts.push(part)
    }

    return { whereClause: ` WHERE ${parts.join('')}`, whereParams: params }
  }
}
