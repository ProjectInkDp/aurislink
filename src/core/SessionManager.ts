// src/core/SessionManager.ts
// Manages Lavalink v4 sessions and their players.

import { randomUUID } from 'node:crypto'
import { log } from '../utils/logger.js'
import type { Track } from '../typings/index.js'

// ─── Player state ─────────────────────────────────────────────────────────────

export interface Filters {
  volume?:      number
  equalizer?:   { band: number; gain: number }[]
  karaoke?:     { level?: number; monoLevel?: number; filterBand?: number; filterWidth?: number } | null
  timescale?:   { speed?: number; pitch?: number; rate?: number } | null
  tremolo?:     { frequency?: number; depth?: number } | null
  vibrato?:     { frequency?: number; depth?: number } | null
  rotation?:    { rotationHz?: number } | null
  distortion?:  { sinOffset?: number; sinScale?: number; cosOffset?: number; cosScale?: number; tanOffset?: number; tanScale?: number; offset?: number; scale?: number } | null
  channelMix?:  { leftToLeft?: number; leftToRight?: number; rightToLeft?: number; rightToRight?: number } | null
  lowPass?:     { smoothing?: number } | null
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

export interface Player {
  guildId:    string
  sessionId:  string
  track:      Track | null
  volume:     number
  paused:     boolean
  state:      PlayerState
  voice:      VoiceState
  filters:    Filters
  // Internal
  _startedAt: number   // Date.now() when track started
  _pausedAt:  number   // Date.now() when paused (0 if not paused)
}

// ─── Session ──────────────────────────────────────────────────────────────────

export interface Session {
  sessionId:        string
  resuming:         boolean
  resumingKey:      string | null
  timeout:          number
  connectedAt:      number
  players:          Map<string, Player>
}

// ─── SessionManager ───────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, Session>()

  // ── Sessions ────────────────────────────────────────────────────────────────

  createSession(): Session {
    const sessionId = randomUUID()
    const session: Session = {
      sessionId,
      resuming:    false,
      resumingKey: null,
      timeout:     60,
      connectedAt: Date.now(),
      players:     new Map(),
    }
    this.sessions.set(sessionId, session)
    log('info', 'SessionManager', `Session created: ${sessionId}`)
    return session
  }

  getSession(sessionId: string): Session | null {
    return this.sessions.get(sessionId) ?? null
  }

  deleteSession(sessionId: string): boolean {
    const had = this.sessions.has(sessionId)
    this.sessions.delete(sessionId)
    if (had) log('info', 'SessionManager', `Session deleted: ${sessionId}`)
    return had
  }

  updateSession(sessionId: string, resuming: boolean, timeout: number): Session | null {
    const s = this.sessions.get(sessionId)
    if (!s) return null
    s.resuming = resuming
    s.timeout  = timeout
    return s
  }

  getAllSessions(): Session[] {
    return [...this.sessions.values()]
  }

  // ── Players ─────────────────────────────────────────────────────────────────

  getOrCreatePlayer(sessionId: string, guildId: string): Player | null {
    const session = this.sessions.get(sessionId)
    if (!session) return null

    if (!session.players.has(guildId)) {
      const player: Player = {
        guildId,
        sessionId,
        track:     null,
        volume:    100,
        paused:    false,
        filters:   {},
        voice:     { token: '', endpoint: '', sessionId: '' },
        state:     { time: Date.now(), position: 0, connected: false, ping: -1 },
        _startedAt: 0,
        _pausedAt:  0,
      }
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
