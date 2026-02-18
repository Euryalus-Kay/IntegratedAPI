// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Realtime — Presence Tracking
// ──────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export interface PresenceUser {
  userId: string
  state: Record<string, unknown>
  joinedAt: string
  lastSeenAt: string
}

export type PresenceJoinCallback = (channel: string, user: PresenceUser) => void
export type PresenceLeaveCallback = (channel: string, user: PresenceUser) => void
export type PresenceSyncCallback = (channel: string, users: PresenceUser[]) => void

interface ChannelPresence {
  users: Map<string, PresenceUser>
  onJoin: PresenceJoinCallback[]
  onLeave: PresenceLeaveCallback[]
  onSync: PresenceSyncCallback[]
}

// ── State ────────────────────────────────────────────────────────────────────

const _channels: Map<string, ChannelPresence> = new Map()
let _heartbeatInterval: ReturnType<typeof setInterval> | null = null
let _heartbeatMs = 30_000
let _timeoutMs = 60_000

function getOrCreateChannel(channel: string): ChannelPresence {
  let ch = _channels.get(channel)
  if (!ch) {
    ch = {
      users: new Map(),
      onJoin: [],
      onLeave: [],
      onSync: [],
    }
    _channels.set(channel, ch)
  }
  return ch
}

function startHeartbeat(): void {
  if (_heartbeatInterval) return
  _heartbeatInterval = setInterval(() => {
    const now = Date.now()
    for (const [channelName, ch] of _channels) {
      const expired: PresenceUser[] = []
      for (const [userId, user] of ch.users) {
        if (now - new Date(user.lastSeenAt).getTime() > _timeoutMs) {
          expired.push(user)
          ch.users.delete(userId)
        }
      }
      for (const user of expired) {
        for (const cb of ch.onLeave) {
          try { cb(channelName, user) } catch { /* swallow */ }
        }
      }
      if (expired.length > 0) {
        const users = [...ch.users.values()]
        for (const cb of ch.onSync) {
          try { cb(channelName, users) } catch { /* swallow */ }
        }
      }
      // Clean up empty channels
      if (ch.users.size === 0 && ch.onJoin.length === 0 && ch.onLeave.length === 0 && ch.onSync.length === 0) {
        _channels.delete(channelName)
      }
    }
  }, _heartbeatMs)

  // Allow the process to exit naturally without waiting for this timer
  if (_heartbeatInterval && typeof _heartbeatInterval === 'object' && 'unref' in _heartbeatInterval) {
    (_heartbeatInterval as NodeJS.Timeout).unref()
  }
}

// ── Module ───────────────────────────────────────────────────────────────────

export const presence = {
  /**
   * Track a user's presence in a channel. If the user is already tracked
   * their state and heartbeat timestamp are updated.
   */
  track(
    channel: string,
    userId: string,
    state: Record<string, unknown> = {},
  ): PresenceUser {
    startHeartbeat()
    const ch = getOrCreateChannel(channel)
    const now = new Date().toISOString()
    const existing = ch.users.get(userId)

    if (existing) {
      existing.state = { ...existing.state, ...state }
      existing.lastSeenAt = now
      // Fire sync callbacks
      const users = [...ch.users.values()]
      for (const cb of ch.onSync) {
        try { cb(channel, users) } catch { /* swallow */ }
      }
      return existing
    }

    const user: PresenceUser = {
      userId,
      state,
      joinedAt: now,
      lastSeenAt: now,
    }
    ch.users.set(userId, user)

    // Fire join callbacks
    for (const cb of ch.onJoin) {
      try { cb(channel, user) } catch { /* swallow */ }
    }

    // Fire sync callbacks
    const users = [...ch.users.values()]
    for (const cb of ch.onSync) {
      try { cb(channel, users) } catch { /* swallow */ }
    }

    return user
  },

  /**
   * Remove a user's presence from a channel.
   */
  untrack(channel: string, userId: string): void {
    const ch = _channels.get(channel)
    if (!ch) return

    const user = ch.users.get(userId)
    if (!user) return

    ch.users.delete(userId)

    // Fire leave callbacks
    for (const cb of ch.onLeave) {
      try { cb(channel, user) } catch { /* swallow */ }
    }

    // Fire sync callbacks
    const users = [...ch.users.values()]
    for (const cb of ch.onSync) {
      try { cb(channel, users) } catch { /* swallow */ }
    }

    // Clean up empty channel
    if (ch.users.size === 0 && ch.onJoin.length === 0 && ch.onLeave.length === 0 && ch.onSync.length === 0) {
      _channels.delete(channel)
    }
  },

  /**
   * Get the full presence state for all users in a channel.
   */
  getState(channel: string): PresenceUser[] {
    const ch = _channels.get(channel)
    if (!ch) return []
    return [...ch.users.values()]
  },

  /**
   * Register a callback that fires when a user joins a channel.
   */
  onJoin(channel: string, callback: PresenceJoinCallback): void {
    const ch = getOrCreateChannel(channel)
    ch.onJoin.push(callback)
    startHeartbeat()
  },

  /**
   * Register a callback that fires when a user leaves a channel
   * (either explicitly or via heartbeat timeout).
   */
  onLeave(channel: string, callback: PresenceLeaveCallback): void {
    const ch = getOrCreateChannel(channel)
    ch.onLeave.push(callback)
    startHeartbeat()
  },

  /**
   * Register a callback that fires whenever the presence state
   * changes for a channel (join, leave, or state update).
   */
  onSync(channel: string, callback: PresenceSyncCallback): void {
    const ch = getOrCreateChannel(channel)
    ch.onSync.push(callback)
    startHeartbeat()
  },

  /**
   * Configure heartbeat and timeout intervals (in milliseconds).
   * - `heartbeat` — how often to check for stale connections (default: 30s)
   * - `timeout` — how long since last activity before a user is removed (default: 60s)
   */
  configure(options: { heartbeat?: number; timeout?: number }): void {
    if (options.heartbeat !== undefined) _heartbeatMs = options.heartbeat
    if (options.timeout !== undefined) _timeoutMs = options.timeout

    // Restart heartbeat with new interval
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval)
      _heartbeatInterval = null
      startHeartbeat()
    }
  },

  /**
   * List all channels that currently have at least one tracked user.
   */
  getChannels(): Array<{ channel: string; userCount: number }> {
    const result: Array<{ channel: string; userCount: number }> = []
    for (const [channel, ch] of _channels) {
      if (ch.users.size > 0) {
        result.push({ channel, userCount: ch.users.size })
      }
    }
    return result
  },

  /**
   * Clear all presence state and stop the heartbeat timer. Useful for
   * testing and graceful shutdown.
   */
  reset(): void {
    _channels.clear()
    if (_heartbeatInterval) {
      clearInterval(_heartbeatInterval)
      _heartbeatInterval = null
    }
  },
}
