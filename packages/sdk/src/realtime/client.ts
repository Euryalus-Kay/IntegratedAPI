import type { RealtimeMessage, PresenceState, MessageHandler, PresenceHandler } from './types.js'

export interface RealtimeClientOptions {
  url: string
  autoReconnect?: boolean
  reconnectInterval?: number
}

export function createRealtimeClient(options: RealtimeClientOptions) {
  let ws: WebSocket | null = null
  let clientId: string | null = null
  const handlers: Map<string, MessageHandler[]> = new Map()
  const presenceHandlers: Map<string, PresenceHandler[]> = new Map()
  let reconnectTimer: any = null

  function connect(): void {
    ws = new WebSocket(options.url)

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as RealtimeMessage & { channel?: string }
        if (msg.type === 'connected') {
          clientId = (msg.data as any)?.clientId
          return
        }

        if (msg.channel) {
          const channelHandlers = handlers.get(msg.channel) || []
          for (const handler of channelHandlers) handler(msg)

          if (msg.type.startsWith('presence:')) {
            const pHandlers = presenceHandlers.get(msg.channel) || []
            for (const handler of pHandlers) handler(msg.data as PresenceState[])
          }
        }

        const wildcardHandlers = handlers.get('*') || []
        for (const handler of wildcardHandlers) handler(msg)
      } catch { /* ignore parse errors */ }
    }

    ws.onclose = () => {
      if (options.autoReconnect !== false) {
        reconnectTimer = setTimeout(connect, options.reconnectInterval || 3000)
      }
    }
  }

  connect()

  return {
    subscribe(channel: string, handler: MessageHandler): () => void {
      if (!handlers.has(channel)) handlers.set(channel, [])
      handlers.get(channel)!.push(handler)

      ws?.send(JSON.stringify({ action: 'subscribe', channel }))

      return () => {
        const list = handlers.get(channel)
        if (list) {
          const idx = list.indexOf(handler)
          if (idx >= 0) list.splice(idx, 1)
        }
        ws?.send(JSON.stringify({ action: 'unsubscribe', channel }))
      }
    },

    subscribePresence(channel: string, handler: PresenceHandler): () => void {
      if (!presenceHandlers.has(channel)) presenceHandlers.set(channel, [])
      presenceHandlers.get(channel)!.push(handler)

      return () => {
        const list = presenceHandlers.get(channel)
        if (list) {
          const idx = list.indexOf(handler)
          if (idx >= 0) list.splice(idx, 1)
        }
      }
    },

    joinPresence(channel: string, userId: string, data?: Record<string, unknown>): void {
      ws?.send(JSON.stringify({ action: 'presence:join', channel, userId, data }))
    },

    send(channel: string, message: RealtimeMessage): void {
      ws?.send(JSON.stringify({ action: 'message', channel, data: message.data, type: message.type }))
    },

    disconnect(): void {
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
      ws = null
    },

    get connected(): boolean {
      return ws?.readyState === WebSocket.OPEN
    },
  }
}
