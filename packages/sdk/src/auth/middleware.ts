import { auth } from './provider.js'
import type { User } from './types.js'

export function middleware() {
  return async (req: any, res: any, next: any) => {
    try {
      req.user = await auth.getUser(req)
    } catch {
      req.user = null
    }
    next()
  }
}

export function protect(options?: { role?: string; redirectTo?: string }) {
  return async (req: any, res: any, next: any) => {
    try {
      const user = await auth.requireUser(req)
      if (options?.role && user.role !== options.role) {
        if (options?.redirectTo) return res.redirect(options.redirectTo)
        return res.status(403).json({ error: 'Insufficient permissions' })
      }
      req.user = user
      next()
    } catch {
      if (options?.redirectTo) return res.redirect(options.redirectTo)
      res.status(401).json({ error: 'Authentication required' })
    }
  }
}

export function honoMiddleware() {
  return async (c: any, next: any) => {
    try {
      const user = await auth.getUser(c.req.raw)
      c.set('user', user)
    } catch {
      c.set('user', null)
    }
    await next()
  }
}

export function honoProtect(options?: { role?: string }) {
  return async (c: any, next: any) => {
    try {
      const user = await auth.requireUser(c.req.raw)
      if (options?.role && user.role !== options.role) {
        return c.json({ error: 'Insufficient permissions' }, 403)
      }
      c.set('user', user)
      await next()
    } catch {
      return c.json({ error: 'Authentication required' }, 401)
    }
  }
}

export function setSessionCookie(res: any, token: string, expiresAt: Date): void {
  const isSecure = process.env.NODE_ENV === 'production'
  const cookie = [
    `vibekit_session=${token}`,
    `Path=/`,
    `HttpOnly`,
    `SameSite=Lax`,
    `Expires=${expiresAt.toUTCString()}`,
    isSecure ? 'Secure' : '',
  ].filter(Boolean).join('; ')

  if (res.setHeader) {
    res.setHeader('Set-Cookie', cookie)
  } else if (res.header) {
    res.header('Set-Cookie', cookie)
  }
}

export function clearSessionCookie(res: any): void {
  const cookie = 'vibekit_session=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT'
  if (res.setHeader) {
    res.setHeader('Set-Cookie', cookie)
  } else if (res.header) {
    res.header('Set-Cookie', cookie)
  }
}
