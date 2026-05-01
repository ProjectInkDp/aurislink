// src/core/SessionManager.ts
// Manages Lavalink v4 sessions, players, and graceful session recovery.

import { randomUUID } from 'node:crypto'
import { log } from '../shared/reporter.js'
import type { Track } from '../typings/index.js'
import { Player as AurisPlayer } from '@projectinkdp/auris-player'

// ─── Player state ─────────────────────────────────────────────────────────────

export interface Filters {
  volume?:      number
  equalizer?:   { band: number; gain: number }[]
  karaoke?:     { level?: number; monoLevel?: number; filterBand?: number; filterWidth?: number } | null
  timescale?:   { speed?: number; pitch?: number; rate?: number }
  tremolo?:     { frequency?: number; depth?: number }
  vibrato?:     { frequency?: number; depth?: number } | null
  rotation?:    { rotationHz?: number } | null
  distortion?:  { sinOffset?: number; sinScale?: number; cosOffset?: number; cosScale?: number; tanOffset?: number; tanScale?: number; offset?: number; scale?: number }
  channelMix?:  { leftToLeft?: number; leftToRight?: number; rightToLeft?: number; rightToRight?: number } | null
  lowPass?:     { smoothing?: number } | null
  echo?:        { delay?: number; feedback?: number; mix?: number } | null
  reverb?:      { mix?: number; roomSize?: number; damping?: number } | null
}

export interface PlayerState {
  time:      number   // unix ms
  position:  number   // track position ms
  connected: boolean
  ping:      number
}

export interface VoiceState {
  token:     string
  endpoint:  string
  sessionId: string
}

export interface Player extends AurisPlayer {
  sessionId:  string
  voice:      VoiceState
  filters:    Filters
  // Internal
  _startedAt: number   // Date.now() when track started
  _pausedAt:  number   // Date.now() when paused (0 if not paused)
  state:      PlayerState
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  sessionId:        string
  resuming:         boolean
  resumingKey:      string | null
  timeout:          number
  connectedAt:      number
  players:          Map<string, Player>
  // Session recovery fields
  suspended:        boolean
  pendingEvents:    string[]
  expiryTimer:      ReturnType<typeof setTimeout> | null
}

// ─── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  private sessions   = new Map<string, Session>()
  private suspended  = new Map<string, Session>()

  // ── Sessions ────────────────────────────────────────────────────────────────

  createSession(): Session {
    const sessionId = randomUUID()
    const session: Session = {
      sessionId,
      resuming:      false,
      resumingKey:   null,
      timeout:       60,
      connectedAt:   Date.now(),
      players:       new Map(),
      suspended:     false,
      pendingEvents: [],
      expiryTimer:   null,
    }
    this.sessions.set(sessionId, session)
    log('info', 'SessionManager', `Session created: ${sessionId}`)
    return session
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? this.suspended.get(sessionId) ?? null
  }

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.has(sessionId)
    this.sessions.delete(sessionId)
    if (had) log('info', 'SessionManager', `Session deleted: ${sessionId}`)
    return had
  }

  updateSession(sessionId: string, resuming: boolean, timeout: number): Session | null {
    const s = this.sessions.get(sessionId) ?? this.suspended.get(sessionId)
    if (!s) return null
    s.resuming = resuming
    s.timeout  = timeout
    log('debug', 'SessionManager', `Session ${sessionId} updated: resuming=${resuming}, timeout=${timeout}s`)
    return s
  }

  getAllSessions(): Session[] {
    return [...this.sessions.values()]
  }

  // ── Session Recovery ────────────────────────────────────────────────────────

  /**
   * Suspends a session for later recovery. The session is moved to the
   * suspended pool and a countdown starts. If the client does not reconnect
   * within the configured timeout, the session is permanently destroyed.
   */
  suspend(sessionId: string): boolean {
    // Prevent double-suspend
    if (this.suspended.has(sessionId)) {
      log('debug', 'SessionManager', `Session ${sessionId} already suspended, skipping.`)
      return false
    }

    const session = this.sessions.get(sessionId)
    if (!session) return false

    // Only suspend if the client opted into resuming
    if (!session.resuming) {
      log('debug', 'SessionManager', `Session ${sessionId} has resuming disabled, destroying immediately.`)
      this.sessions.delete(sessionId)
      return false
    }

    log('info', 'SessionManager', `Suspending session ${sessionId} — client has ${session.timeout}s to reconnect.`)

    this.sessions.delete(sessionId)
    session.suspended = true
    session.pendingEvents = []
    this.suspended.set(sessionId, session)

    // Start the expiry countdown
    session.expiryTimer = setTimeout(() => {
      log('info', 'SessionManager', `Session ${sessionId} expired after ${session.timeout}s without reconnection. Destroying.`)
      this.suspended.delete(sessionId)
      this._cleanupSession(session)
    }, session.timeout * 1000)

    return true
  }

  /**
   * Attempts to recover a suspended session. Returns the session if found
   * in the suspended pool, otherwise null. Clears the expiry timer and
   * moves the session back to the active pool.
   */
  recover(sessionId: string): Session | null {
    const session = this.suspended.get(sessionId)
    if (!session) return null

    log('info', 'SessionManager', `Recovering session ${sessionId} — flushing ${session.pendingEvents.length} queued event(s).`)

    // Cancel the expiry timer
    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer)
      session.expiryTimer = null
    }

    // Move back to active
    this.suspended.delete(sessionId)
    session.suspended = false
    this.sessions.set(sessionId, session)

    return session
  }

  /**
   * Checks whether a session is currently in the suspended pool awaiting
   * reconnection from the client.
   */
  isSuspended(sessionId: string): boolean {
    return this.suspended.has(sessionId)
  }

  /**
   * Queues a serialized event for a suspended session. Events are buffered
   * until the client reconnects and the session is recovered.
   */
  queueEvent(sessionId: string, event: string): boolean {
    const session = this.suspended.get(sessionId)
    if (!session) return false
    session.pendingEvents.push(event)
    return true
  }

  /**
   * Drains all pending events from a recovered session and returns them.
   * After calling this, the pending queue is empty.
   */
  drainPendingEvents(sessionId: string): string[] {
    const session = this.sessions.get(sessionId)
    if (!session || session.pendingEvents.length === 0) return []
    const events = [...session.pendingEvents]
    session.pendingEvents = []
    return events
  }

  /** Internal cleanup when a session expires without recovery. */
  private _cleanupSession(session: Session): void {
    if (session.expiryTimer) {
      clearTimeout(session.expiryTimer)
      session.expiryTimer = null
    }
    session.players.clear()
    session.pendingEvents = []
    log('debug', 'SessionManager', `Session ${session.sessionId} fully cleaned up.`)
  }

  // ── Players ─────────────────────────────────────────────────────────────────

  getOrCreatePlayer(sessionId: string, guildId: string): Player | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    if (!session.players.has(guildId)) {
      const player = new AurisPlayer(guildId) as Player
      player.sessionId = sessionId
      player.filters = {}
      player.voice = { token: '', endpoint: '', sessionId: '' }
      player.state = { time: Date.now(), position: 0, connected: false, ping: -1 }
      player._startedAt = 0
      player._pausedAt = 0
      
      session.players.set(guildId, player)
      log('info', 'SessionManager', `Player created: guild=${guildId} session=${sessionId}`)
    }

    return session.players.get(guildId)!
  }

  getPlayer(sessionId: string, guildId: string): Player | null {
    return this.sessions.get(sessionId)?.players.get(guildId) ?? null
  }

  getAllPlayers(sessionId: string): Player[] {
    return [...(this.sessions.get(sessionId)?.players.values() ?? [])]
  }

  deletePlayer(sessionId: string, guildId: string): boolean {
    const session = this.sessions.get(sessionId)
    if (!session) return false
    const had = session.players.delete(guildId)
    if (had) log('info', 'SessionManager', `Player deleted: guild=${guildId} session=${sessionId}`)
    return had
  }

  // ── Player helpers ──────────────────────────────────────────────────────────

  /** Returns the current live position of a player (accounts for paused state). */
  getPosition(player: Player): number {
    if (!player.track || player._startedAt === 0) return 0
    if (player.paused) return player._pausedAt > 0 ? player._pausedAt - player._startedAt : 0
    return Math.min(Date.now() - player._startedAt, player.track.info.length)
  }

  /** Serialise a player to Lavalink v4 REST format. */
  serializePlayer(player: Player): object {
    return {
      guildId:  player.guildId,
      track:    player.track,
      volume:   player.volume,
      paused:   player.paused,
      state: {
        time:      Date.now(),
        position:  this.getPosition(player),
        connected: player.state.connected,
        ping:      player.state.ping,
      },
      voice:   player.voice,
      filters: player.filters,
    }
  }
}
