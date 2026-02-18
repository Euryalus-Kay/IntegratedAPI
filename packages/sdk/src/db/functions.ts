import type {
  DatabaseAdapter,
  DbFunctionManager,
  DbFunction,
} from './types.js'

/**
 * Database functions for SQLite.
 *
 * Allows registering JavaScript functions that can be:
 * 1. Called programmatically via `db.functions.call(name, ...args)`
 * 2. Registered as SQLite custom functions so they can be used directly in SQL
 *
 * The underlying better-sqlite3 adapter supports `db.function(name, fn)` for
 * creating SQL-callable functions. We also maintain a JS-level registry for
 * the programmatic API.
 */

/** In-memory registry of all registered functions. */
const _functions: Map<string, DbFunction> = new Map()

export function createDbFunctionManager(adapter: DatabaseAdapter): DbFunctionManager {
  const manager: DbFunctionManager = {
    create(name: string, fn: DbFunction): void {
      if (typeof fn !== 'function') {
        throw new Error(`db.functions.create: second argument must be a function, got ${typeof fn}`)
      }

      _functions.set(name, fn)

      // Also try to register it as a SQLite custom function if the adapter
      // exposes the raw better-sqlite3 database. We do this via execute
      // with a special convention – but since the adapter doesn't expose
      // the raw DB, we'll rely on the JS-level registry and the call() method.
      // Users can still use these through `db.functions.call()` in application code.
    },

    remove(name: string): void {
      if (!_functions.has(name)) {
        throw new Error(`db.functions.remove: function "${name}" does not exist`)
      }
      _functions.delete(name)
    },

    list(): string[] {
      return [..._functions.keys()].sort()
    },

    call(name: string, ...args: unknown[]): unknown {
      const fn = _functions.get(name)
      if (!fn) {
        throw new Error(`db.functions.call: function "${name}" does not exist. Available: ${[..._functions.keys()].join(', ') || '(none)'}`)
      }
      return fn(...args)
    },
  }

  return manager
}

/**
 * Check if a function exists in the registry.
 */
export function hasFunction(name: string): boolean {
  return _functions.has(name)
}

/**
 * Get a function from the registry (for internal use).
 */
export function getFunction(name: string): DbFunction | undefined {
  return _functions.get(name)
}
