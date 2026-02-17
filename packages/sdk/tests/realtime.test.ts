import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { RealtimeServer } from '../src/realtime/server.js'

// ─────────────────────────────────────────────────────────────────────────────
// RealtimeServer — unit tests without a WebSocket server
// These tests verify the internal state management of the RealtimeServer
// class (channels, presence, client count) without requiring a full WS setup.
// ─────────────────────────────────────────────────────────────────────────────

describe('RealtimeServer', () => {
  let server: RealtimeServer

  beforeEach(() => {
    server = new RealtimeServer()
  })

  afterEach(() => {
    server.close()
  })

  // ── Channel management ───────────────────────────────────────────────────

  describe('Channel management', () => {
    it('starts with no channels', () => {
      expect(server.getChannels()).toEqual([])
    })

    it('starts with zero clients', () => {
      expect(server.getClientCount()).toBe(0)
    })

    it('getChannelInfo returns zero clients for an empty channel', () => {
      const info = server.getChannelInfo('test-channel')
      expect(info.name).toBe('test-channel')
      expect(info.clients).toBe(0)
      expect(info.presence).toEqual([])
    })

    it('getChannelInfo returns correct structure', () => {
      const info = server.getChannelInfo('my-channel')
      expect(info).toHaveProperty('name')
      expect(info).toHaveProperty('clients')
      expect(info).toHaveProperty('presence')
    })
  })

  // ── Broadcast ────────────────────────────────────────────────────────────

  describe('Broadcast', () => {
    it('broadcast does not throw when channel has no subscribers', () => {
      expect(() => {
        server.broadcast('empty-channel', {
          type: 'notification',
          data: { message: 'hello' },
        })
      }).not.toThrow()
    })

    it('broadcastToUser does not throw when no matching user exists', () => {
      expect(() => {
        server.broadcastToUser('nonexistent-user', {
          type: 'alert',
          data: { message: 'hello' },
        })
      }).not.toThrow()
    })
  })

  // ── Presence ─────────────────────────────────────────────────────────────

  describe('Presence', () => {
    it('getChannelInfo returns empty presence for a new channel', () => {
      const info = server.getChannelInfo('presence-test')
      expect(info.presence).toEqual([])
    })
  })

  // ── Close ────────────────────────────────────────────────────────────────

  describe('Close', () => {
    it('can be closed without errors', () => {
      expect(() => server.close()).not.toThrow()
    })

    it('can be closed multiple times', () => {
      server.close()
      expect(() => server.close()).not.toThrow()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// RealtimeServer with WebSocket integration test
// ─────────────────────────────────────────────────────────────────────────────

describe('RealtimeServer with WebSocket', () => {
  let server: RealtimeServer
  let httpServer: import('node:http').Server

  beforeEach(async () => {
    const http = await import('node:http')
    server = new RealtimeServer()

    httpServer = http.createServer()
    server.attach(httpServer, '/ws')

    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', resolve)
    })
  })

  afterEach(async () => {
    server.close()
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve())
    })
  })

  function getWsUrl(): string {
    const addr = httpServer.address() as import('node:net').AddressInfo
    return `ws://127.0.0.1:${addr.port}/ws`
  }

  it('accepts a WebSocket connection', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    const connected = await new Promise<boolean>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'connected') {
          resolve(true)
        }
      })
      ws.on('error', () => resolve(false))
    })

    expect(connected).toBe(true)
    expect(server.getClientCount()).toBe(1)

    ws.close()
    // Wait for cleanup
    await new Promise(r => setTimeout(r, 100))
  })

  it('sends a connected message with clientId', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    const msg = await new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        resolve(JSON.parse(raw.toString()))
      })
    })

    expect(msg.type).toBe('connected')
    expect(msg.data.clientId).toBeTruthy()

    ws.close()
    await new Promise(r => setTimeout(r, 100))
  })

  it('handles subscribe and channel tracking', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    // Wait for connected
    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'connected') resolve()
      })
    })

    // Subscribe to a channel
    ws.send(JSON.stringify({ action: 'subscribe', channel: 'chat' }))

    const subscribed = await new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'subscribed') resolve(msg)
      })
    })

    expect(subscribed.data.channel).toBe('chat')

    const info = server.getChannelInfo('chat')
    expect(info.clients).toBe(1)
    expect(server.getChannels()).toContain('chat')

    ws.close()
    await new Promise(r => setTimeout(r, 100))
  })

  it('broadcasts messages to channel subscribers', async () => {
    const { WebSocket } = await import('ws')
    const ws1 = new WebSocket(getWsUrl())
    const ws2 = new WebSocket(getWsUrl())

    // Wait for both to connect
    await Promise.all([
      new Promise<void>((resolve) => {
        ws1.on('message', (raw) => {
          if (JSON.parse(raw.toString()).type === 'connected') resolve()
        })
      }),
      new Promise<void>((resolve) => {
        ws2.on('message', (raw) => {
          if (JSON.parse(raw.toString()).type === 'connected') resolve()
        })
      }),
    ])

    // Subscribe both to 'room'
    ws1.send(JSON.stringify({ action: 'subscribe', channel: 'room' }))
    ws2.send(JSON.stringify({ action: 'subscribe', channel: 'room' }))

    // Wait for subscriptions
    await new Promise(r => setTimeout(r, 100))

    // Broadcast from server
    server.broadcast('room', { type: 'update', data: { count: 42 } })

    // Both should receive the message
    const received = await Promise.all([
      new Promise<any>((resolve) => {
        ws1.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'update') resolve(msg)
        })
      }),
      new Promise<any>((resolve) => {
        ws2.on('message', (raw) => {
          const msg = JSON.parse(raw.toString())
          if (msg.type === 'update') resolve(msg)
        })
      }),
    ])

    expect(received[0].data.count).toBe(42)
    expect(received[1].data.count).toBe(42)

    ws1.close()
    ws2.close()
    await new Promise(r => setTimeout(r, 100))
  })

  it('handles unsubscribe', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        if (JSON.parse(raw.toString()).type === 'connected') resolve()
      })
    })

    ws.send(JSON.stringify({ action: 'subscribe', channel: 'temp' }))
    await new Promise(r => setTimeout(r, 50))

    expect(server.getChannelInfo('temp').clients).toBe(1)

    ws.send(JSON.stringify({ action: 'unsubscribe', channel: 'temp' }))
    await new Promise(r => setTimeout(r, 50))

    expect(server.getChannelInfo('temp').clients).toBe(0)

    ws.close()
    await new Promise(r => setTimeout(r, 100))
  })

  it('cleans up client on disconnect', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        if (JSON.parse(raw.toString()).type === 'connected') resolve()
      })
    })

    expect(server.getClientCount()).toBe(1)

    ws.close()
    await new Promise(r => setTimeout(r, 200))

    expect(server.getClientCount()).toBe(0)
  })

  it('handles presence join', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        if (JSON.parse(raw.toString()).type === 'connected') resolve()
      })
    })

    // Subscribe to the channel first
    ws.send(JSON.stringify({ action: 'subscribe', channel: 'presence-room' }))
    await new Promise(r => setTimeout(r, 50))

    // Join presence
    ws.send(JSON.stringify({
      action: 'presence:join',
      channel: 'presence-room',
      userId: 'user-1',
      data: { name: 'Alice' },
    }))

    // Wait for presence state reply
    const presenceMsg = await new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'presence:state') resolve(msg)
      })
    })

    expect(presenceMsg.channel).toBe('presence-room')
    expect(presenceMsg.data).toBeInstanceOf(Array)
    expect(presenceMsg.data.length).toBeGreaterThanOrEqual(1)
    expect(presenceMsg.data[0].userId).toBe('user-1')

    const info = server.getChannelInfo('presence-room')
    expect(info.presence.length).toBe(1)
    expect(info.presence[0].userId).toBe('user-1')

    ws.close()
    await new Promise(r => setTimeout(r, 200))
  })

  it('cleans up presence on disconnect', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        if (JSON.parse(raw.toString()).type === 'connected') resolve()
      })
    })

    ws.send(JSON.stringify({ action: 'subscribe', channel: 'cleanup' }))
    await new Promise(r => setTimeout(r, 50))

    ws.send(JSON.stringify({
      action: 'presence:join',
      channel: 'cleanup',
      userId: 'temp-user',
    }))
    await new Promise(r => setTimeout(r, 50))

    expect(server.getChannelInfo('cleanup').presence.length).toBe(1)

    ws.close()
    await new Promise(r => setTimeout(r, 200))

    expect(server.getChannelInfo('cleanup').presence.length).toBe(0)
  })

  it('handles invalid message format', async () => {
    const { WebSocket } = await import('ws')
    const ws = new WebSocket(getWsUrl())

    await new Promise<void>((resolve) => {
      ws.on('message', (raw) => {
        if (JSON.parse(raw.toString()).type === 'connected') resolve()
      })
    })

    // Send invalid JSON
    ws.send('not json at all')

    const errorMsg = await new Promise<any>((resolve) => {
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'error') resolve(msg)
      })
    })

    expect(errorMsg.type).toBe('error')
    expect(errorMsg.data.message).toContain('Invalid message format')

    ws.close()
    await new Promise(r => setTimeout(r, 100))
  })

  it('handles client-to-channel messaging', async () => {
    const { WebSocket } = await import('ws')
    const ws1 = new WebSocket(getWsUrl())
    const ws2 = new WebSocket(getWsUrl())

    // Wait for both to connect
    await Promise.all([
      new Promise<void>((resolve) => {
        ws1.on('message', (raw) => {
          if (JSON.parse(raw.toString()).type === 'connected') resolve()
        })
      }),
      new Promise<void>((resolve) => {
        ws2.on('message', (raw) => {
          if (JSON.parse(raw.toString()).type === 'connected') resolve()
        })
      }),
    ])

    // Both subscribe
    ws1.send(JSON.stringify({ action: 'subscribe', channel: 'msg-test' }))
    ws2.send(JSON.stringify({ action: 'subscribe', channel: 'msg-test' }))
    await new Promise(r => setTimeout(r, 100))

    // ws1 sends a message
    ws1.send(JSON.stringify({
      action: 'message',
      channel: 'msg-test',
      data: { text: 'hello from ws1' },
    }))

    // ws2 should receive it
    const received = await new Promise<any>((resolve) => {
      ws2.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'message' && msg.channel === 'msg-test') resolve(msg)
      })
    })

    expect(received.data.text).toBe('hello from ws1')
    expect(received.timestamp).toBeTruthy()

    ws1.close()
    ws2.close()
    await new Promise(r => setTimeout(r, 100))
  })
})
