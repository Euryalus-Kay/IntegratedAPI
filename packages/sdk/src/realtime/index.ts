import { RealtimeServer } from './server.js'
import type { RealtimeMessage } from './types.js'

let _server: RealtimeServer | null = null

function getServer(): RealtimeServer {
  if (!_server) {
    _server = new RealtimeServer()
  }
  return _server
}

export const realtime = {
  broadcast(channel: string, message: RealtimeMessage): void {
    getServer().broadcast(channel, message)
  },

  broadcastToUser(userId: string, message: RealtimeMessage): void {
    getServer().broadcastToUser(userId, message)
  },

  getChannelInfo(channel: string) {
    return getServer().getChannelInfo(channel)
  },

  getChannels() {
    return getServer().getChannels()
  },

  getClientCount() {
    return getServer().getClientCount()
  },

  /** @internal used by dev server to attach WS to HTTP server */
  _getServer(): RealtimeServer {
    return getServer()
  },
}

export { RealtimeServer }
export { createRealtimeClient } from './client.js'
export type { RealtimeMessage, PresenceState, ChannelInfo, MessageHandler, PresenceHandler } from './types.js'

// Realtime v2 modules
export { broadcast } from './broadcast.js'
export type {
  BroadcastCallback, ChannelAuthCallback, BroadcastEvent, BroadcastSubscriber,
} from './broadcast.js'

export { presence as presenceV2 } from './presence.js'
export type {
  PresenceUser, PresenceJoinCallback, PresenceLeaveCallback, PresenceSyncCallback,
} from './presence.js'

export { cdc } from './cdc.js'
export type {
  CDCEventType, CDCChange, CDCCallback, CDCFilterOptions, CDCSubscription,
} from './cdc.js'
