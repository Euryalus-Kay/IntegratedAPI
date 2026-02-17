export interface RealtimeMessage {
  type: string
  data: unknown
  channel?: string
  timestamp?: string
}

export interface PresenceState {
  userId: string
  data?: Record<string, unknown>
  joinedAt: string
}

export interface ChannelInfo {
  name: string
  clients: number
  presence: PresenceState[]
}

export type MessageHandler = (message: RealtimeMessage) => void
export type PresenceHandler = (users: PresenceState[]) => void
