// ──────────────────────────────────────────────────────────────────────────────
// VibeKit Realtime — Enhanced Broadcast
// ──────────────────────────────────────────────────────────────────────────────

// ── Types ────────────────────────────────────────────────────────────────────

export type BroadcastCallback = (payload: BroadcastEvent) => void
export type ChannelAuthCallback = (channel: string, userId?: string) => boolean | Promise<boolean>

export interface BroadcastEvent {
  channel: string
  event: string
  payload: unknown
  timestamp: string
  senderId?: string
}

export interface BroadcastSubscriber {
  id: string
  channel: string
  event: string | null
  subscribedAt: string
}

interface SubscriptionEntry {
  id: string
  channel: string
  event: string | null
  callback: BroadcastCallback
  subscribedAt: string
}

// ── State ────────────────────────────────────────────────────────────────────

const _subscriptions: Map<string, SubscriptionEntry[]> = new Map()
const _channelAuth: Map<string, ChannelAuthCallback> = new Map()
let _subCounter = 0

function generateSubId(): string {
  return `sub_${++_subCounter}_${Date.now().toString(36)}`
}

// ── Module ───────────────────────────────────────────────────────────────────

export const broadcast = {
  /**
   * Broadcast an event with a payload to all subscribers of the given channel.
   * If an `event` filter was set during subscription, only matching
   * subscribers will receive the message.
   */
  async send(
    channel: string,
    event: string,
    payload: unknown,
    senderId?: string,
  ): Promise<number> {
    const subs = _subscriptions.get(channel)
    if (!subs || subs.length === 0) return 0

    const broadcastEvent: BroadcastEvent = {
      channel,
      event,
      payload,
      timestamp: new Date().toISOString(),
      senderId,
    }

    let delivered = 0
    for (const sub of subs) {
      if (sub.event === null || sub.event === event) {
        try {
          sub.callback(broadcastEvent)
          delivered++
        } catch {
          // Subscriber callback errors should not break the broadcast loop
        }
      }
    }
    return delivered
  },

  /**
   * Subscribe to events on a channel. If `event` is provided, only
   * messages of that event type are delivered. Pass `null` or omit to
   * receive all events.
   *
   * Returns a subscription ID that can be used with `unsubscribe`.
   */
  subscribe(
    channel: string,
    eventOrCallback: string | BroadcastCallback | null,
    callbackOrUndefined?: BroadcastCallback,
  ): string {
    let event: string | null = null
    let callback: BroadcastCallback

    if (typeof eventOrCallback === 'function') {
      callback = eventOrCallback
    } else {
      event = eventOrCallback
      if (!callbackOrUndefined) {
        throw new Error('A callback function is required when an event filter is provided.')
      }
      callback = callbackOrUndefined
    }

    const entry: SubscriptionEntry = {
      id: generateSubId(),
      channel,
      event,
      callback,
      subscribedAt: new Date().toISOString(),
    }

    if (!_subscriptions.has(channel)) {
      _subscriptions.set(channel, [])
    }
    _subscriptions.get(channel)!.push(entry)

    return entry.id
  },

  /**
   * Unsubscribe from a channel. If `subscriptionId` is provided, only
   * that specific subscription is removed. Otherwise all subscriptions
   * for the channel are cleared.
   */
  unsubscribe(channel: string, subscriptionId?: string): void {
    if (!subscriptionId) {
      _subscriptions.delete(channel)
      return
    }

    const subs = _subscriptions.get(channel)
    if (!subs) return

    const idx = subs.findIndex(s => s.id === subscriptionId)
    if (idx !== -1) subs.splice(idx, 1)
    if (subs.length === 0) _subscriptions.delete(channel)
  },

  /**
   * Get all current subscribers for a channel.
   */
  getSubscribers(channel: string): BroadcastSubscriber[] {
    const subs = _subscriptions.get(channel)
    if (!subs) return []
    return subs.map(s => ({
      id: s.id,
      channel: s.channel,
      event: s.event,
      subscribedAt: s.subscribedAt,
    }))
  },

  /**
   * Set an authorization callback for a channel. The callback receives
   * the channel name and optional userId; it should return `true` if
   * access is allowed.
   */
  setAuth(channel: string, authFn: ChannelAuthCallback): void {
    _channelAuth.set(channel, authFn)
  },

  /**
   * Remove the authorization callback for a channel.
   */
  removeAuth(channel: string): void {
    _channelAuth.delete(channel)
  },

  /**
   * Check whether a user is authorized for a given channel.
   */
  async checkAuth(channel: string, userId?: string): Promise<boolean> {
    const authFn = _channelAuth.get(channel)
    if (!authFn) return true
    return authFn(channel, userId)
  },

  /**
   * List all channels that have at least one active subscriber.
   */
  getChannels(): string[] {
    return [..._subscriptions.keys()]
  },

  /**
   * Clear all subscriptions and auth callbacks. Useful for testing.
   */
  reset(): void {
    _subscriptions.clear()
    _channelAuth.clear()
    _subCounter = 0
  },
}
