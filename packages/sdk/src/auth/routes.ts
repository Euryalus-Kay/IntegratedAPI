import { Hono } from 'hono'
import { auth } from './provider.js'
import { setSessionCookie, clearSessionCookie } from './middleware.js'

export const authRoutes = new Hono()

authRoutes.post('/send-code', async (c) => {
  const { email } = await c.req.json()
  if (!email || typeof email !== 'string') {
    return c.json({ error: 'Email is required' }, 400)
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: 'Invalid email address' }, 400)
  }

  try {
    const result = await auth.sendCode(email)
    return c.json(result)
  } catch (err: any) {
    return c.json({ error: err.message, code: err.code }, err.statusCode || 500)
  }
})

authRoutes.post('/verify', async (c) => {
  const { email, code } = await c.req.json()
  if (!email || !code) {
    return c.json({ error: 'Email and code are required' }, 400)
  }

  try {
    const result = await auth.verifyCode(email, code, {
      ipAddress: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || undefined,
      userAgent: c.req.header('user-agent') || undefined,
    })

    setSessionCookie(c, result.token, result.expiresAt)

    return c.json({
      user: result.user,
      token: result.token,
      expiresAt: result.expiresAt.toISOString(),
    })
  } catch (err: any) {
    return c.json({ error: err.message, code: err.code }, err.statusCode || 500)
  }
})

authRoutes.post('/logout', async (c) => {
  try {
    await auth.logout(c.req.raw)
    clearSessionCookie(c)
    return c.json({ success: true })
  } catch (err: any) {
    return c.json({ error: err.message }, 500)
  }
})

authRoutes.get('/me', async (c) => {
  try {
    const user = await auth.getUser(c.req.raw)
    if (!user) {
      return c.json({ user: null }, 401)
    }
    return c.json({ user })
  } catch {
    return c.json({ user: null }, 401)
  }
})
