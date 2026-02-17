import { WebSocketServer, WebSocket } from 'ws'
import crypto from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Server } from 'node:http'
import type { RealtimeMessage, PresenceState, ChannelInfo, MessageHandler } from './types.js'

interface Client {
  ws: WebSocket
  id: string
  userId?: string
  channels: Set<string>
}

export class RealtimeServer {
  private wss: WebSocketServer | null = null
  private clients: Map<string, Client> = new Map()
  private channels: Map<string, Set<string>> = new Map()
  private presence: Map<string, PresenceState[]> = new Map()
  private messageHandlers: Map<string, MessageHandler[]> = new Map()

  attach(server: Server, path: string = '/realtime'): void {
    this.wss = new WebSocketServer({ server, path })

    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const clientId = crypto.randomUUID()
      const client: Client = { ws, id: clientId, channels: new Set() }
      this.clients.set(clientId, client)

      ws.on('message', (raw: Buffer) => {
        try {
          const msg = JSON.parse(raw.toString()) as { action: string; channel?: string; data?: unknown; userId?: string }
          this.handleClientMessage(client, msg)
        } catch {
          ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid message format' } }))
        }
      })

      ws.on('close', () => {
        for (const channel of client.channels) {
          this.channels.get(channel)?.delete(clientId)
          const presenceList = this.presence.get(channel)
          if (presenceList && client.userId) {
            const filtered = presenceList.filter(p => p.userId !== client.userId)
            this.presence.set(channel, filtered)
            this.broadcastToChannel(channel, { type: 'presence:leave', data: { userId: client.userId }, channel })
          }
        }
        this.clients.delete(clientId)
      })

      ws.send(JSON.stringify({ type: 'connected', data: { clientId } }))
    })
  }

  private handleClientMessage(client: Client, msg: { action: string; channel?: string; data?: unknown; userId?: string }): void {
    switch (msg.action) {
      case 'subscribe':
        if (msg.channel) {
          client.channels.add(msg.channel)
          if (!this.channels.has(msg.channel)) this.channels.set(msg.channel, new Set())
          this.channels.get(msg.channel)!.add(client.id)
          client.ws.send(JSON.stringify({ type: 'subscribed', data: { channel: msg.channel } }))
        }
        break

      case 'unsubscribe':
        if (msg.channel) {
          client.channels.delete(msg.channel)
          this.channels.get(msg.channel)?.delete(client.id)
        }
        break

      case 'presence:join':
        if (msg.channel && msg.userId) {
          client.userId = msg.userId
          if (!this.presence.has(msg.channel)) this.presence.set(msg.channel, [])
          const presenceList = this.presence.get(msg.channel)!
          if (!presenceList.find(p => p.userId === msg.userId)) {
            const state: PresenceState = { userId: msg.userId, data: msg.data as Record<string, unknown>, joinedAt: new Date().toISOString() }
            presenceList.push(state)
          }
          this.broadcastToChannel(msg.channel, { type: 'presence:join', data: { userId: msg.userId }, channel: msg.channel })
          client.ws.send(JSON.stringify({ type: 'presence:state', data: this.presence.get(msg.channel), channel: msg.channel }))
        }
        break

      case 'message':
        if (msg.channel) {
          this.broadcastToChannel(msg.channel, { type: 'message', data: msg.data, channel: msg.channel })
        }
        break
    }
  }

  broadcast(channel: string, message: RealtimeMessage): void {
    this.broadcastToChannel(channel, { ...message, channel })
  }

  broadcastToUser(userId: string, message: RealtimeMessage): void {
    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(JSON.stringify({ ...message, timestamp: new Date().toISOString() }))
      }
    }
  }

  getChannelInfo(channel: string): ChannelInfo {
    return {
      name: channel,
      clients: this.channels.get(channel)?.size || 0,
      presence: this.presence.get(channel) || [],
    }
  }

  getChannels(): string[] {
    return Array.from(this.channels.keys())
  }

  getClientCount(): number {
    return this.clients.size
  }

  private broadcastToChannel(channel: string, message: RealtimeMessage): void {
    const clientIds = this.channels.get(channel)
    if (!clientIds) return

    const payload = JSON.stringify({ ...message, timestamp: new Date().toISOString() })
    for (const clientId of clientIds) {
      const client = this.clients.get(clientId)
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload)
      }
    }
  }

  close(): void {
    this.wss?.close()
  }
}
