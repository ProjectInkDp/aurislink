// src/engine/SessionManager.ts
// AurisLink Session & Player Orchestrator
// Handles the lifecycle of Lavalink v4 sessions and their associated audio players.

import { randomUUID } from 'node:crypto'
import { log } from '../shared/reporter.js'
import type { Track } from '../typings/index.js'
import { Player as AurisCore } from '@projectinkdp/auris-player'

/**
 * Represents the DSP filter configuration for a player.
 * Aligned with Lavalink v4 specification.
 */
export interface AudioFilters {
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

export interface PlaybackState {
  updatedAt: number   // Epoch ms
  position:  number   // Current offset in ms
  active:    boolean
  latency:   number
}

export interface VoiceConnection {
  token:     string
  endpoint:  string
  sessionId: string
}

/**
 * Extended Player class for AurisLink internal management.
 */
export interface AurisPlayer extends AurisCore {
  parentSession: string
  voiceLink:     VoiceConnection
  dsp:           AudioFilters
  _tsStart:      number   // Timestamp when playback began
  _tsPause:      number   // Timestamp when paused (0 if active)
  liveState:     PlaybackState
}

/**
 * A client session containing multiple players and recovery data.
 */
export interface AurisSession {
  id:               string
  isResuming:       boolean
  recoveryKey:      string | null
  gracePeriod:      number
  createdAt:        number
  registry:         Map<string, AurisPlayer>
  isInactive:       boolean
  backlog:          string[]
  cleanupTask:      ReturnType<typeof setTimeout> | null
}

export class SessionManager {
  private activePool   = new Map<string, AurisSession>()
  private standbyPool  = new Map<string, AurisSession>()

  /**
   * Initializes a new session with a unique identifier.
   */
  openSession(): AurisSession {
    const id = randomUUID()
    const session: AurisSession = {
      id,
      isResuming:    false,
      recoveryKey:   null,
      gracePeriod:   60,
      createdAt:     Date.now(),
      registry:      new Map(),
      isInactive:    false,
      backlog:       [],
      cleanupTask:   null,
    }
    this.activePool.set(id, session)
    log('info', 'SessionManager', `New session registered: ${id}`)
    return session
  }

  /**
   * Locates a session in either the active or standby pools.
   */
  findSession(id: string): AurisSession | null {
    return this.activePool.get(id) ?? this.standbyPool.get(id) ?? null
  }

  /**
   * Removes a session and its associated resources.
   */
  closeSession(id: string): boolean {
    const exists = this.activePool.has(id)
    this.activePool.delete(id)
    if (exists) log('info', 'SessionManager', `Session terminated: ${id}`)
    return exists
  }

  /**
   * Updates session parameters for resumption.
   */
  configureResumption(id: string, enabled: boolean, timeout: number): AurisSession | null {
    const session = this.findSession(id)
    if (!session) return null
    session.isResuming = enabled
    session.gracePeriod = timeout
    log('debug', 'SessionManager', `Session ${id} config: resume=${enabled}, timeout=${timeout}s`)
    return session
  }

  /**
   * Returns all currently active sessions.
   */
  listActive(): AurisSession[] {
    return Array.from(this.activePool.values())
  }

  /**
   * Moves a session to standby mode, allowing for later recovery.
   */
  parkSession(id: string): boolean {
    if (this.standbyPool.has(id)) return false

    const session = this.activePool.get(id)
    if (!session) return false

    if (!session.isResuming) {
      log('debug', 'SessionManager', `Session ${id} not configured for resume, purging.`)
      this.activePool.delete(id)
      return false
    }

    log('info', 'SessionManager', `Parking session ${id} (Standby: ${session.gracePeriod}s)`)

    this.activePool.delete(id)
    session.isInactive = true
    session.backlog = []
    this.standbyPool.set(id, session)

    session.cleanupTask = setTimeout(() => {
      log('info', 'SessionManager', `Standby expired for ${id}. Cleaning up.`)
      this.standbyPool.delete(id)
      this._finalizePurge(session)
    }, session.gracePeriod * 1000)

    return true
  }

  /**
   * Restores a parked session to the active pool.
   */
  restoreSession(id: string): AurisSession | null {
    const session = this.standbyPool.get(id)
    if (!session) return null

    log('info', 'SessionManager', `Restoring session ${id} (Backlog: ${session.backlog.length} items)`)

    if (session.cleanupTask) {
      clearTimeout(session.cleanupTask)
      session.cleanupTask = null
    }

    this.standbyPool.delete(id)
    session.isInactive = false
    this.activePool.set(id, session)

    return session
  }

  /**
   * Buffers an event for a parked session.
   */
  bufferEvent(id: string, data: string): boolean {
    const session = this.standbyPool.get(id)
    if (!session) return false
    session.backlog.push(data)
    return true
  }

  /**
   * Retrieves and clears the event backlog for a session.
   */
  flushBacklog(id: string): string[] {
    const session = this.activePool.get(id)
    if (!session || session.backlog.length === 0) return []
    const items = [...session.backlog]
    session.backlog = []
    return items
  }

  private _finalizePurge(session: AurisSession): void {
    if (session.cleanupTask) {
      clearTimeout(session.cleanupTask)
      session.cleanupTask = null
    }
    session.registry.clear()
    session.backlog = []
    log('debug', 'SessionManager', `Resources released for session ${session.id}`)
  }

  // ── Player Management ───────────────────────────────────────────────────────

  acquirePlayer(sessionId: string, guildId: string): AurisPlayer | null {
    const session = this.activePool.get(sessionId)
    if (!session) return null

    let player = session.registry.get(guildId)
    if (!player) {
      player = new AurisCore(guildId) as AurisPlayer
      player.parentSession = sessionId
      player.dsp = {}
      player.voiceLink = { token: '', endpoint: '', sessionId: '' }
      player.liveState = { updatedAt: Date.now(), position: 0, active: false, latency: -1 }
      player._tsStart = 0
      player._tsPause = 0
      
      session.registry.set(guildId, player)
      log('info', 'SessionManager', `Player spawned: guild=${guildId} session=${sessionId}`)
    }

    return player
  }

  fetchPlayer(sessionId: string, guildId: string): AurisPlayer | null {
    return this.activePool.get(sessionId)?.registry.get(guildId) ?? null
  }

  listPlayers(sessionId: string): AurisPlayer[] {
    return Array.from(this.activePool.get(sessionId)?.registry.values() ?? [])
  }

  evictPlayer(sessionId: string, guildId: string): boolean {
    const session = this.activePool.get(sessionId)
    if (!session) return false
    const removed = session.registry.delete(guildId)
    if (removed) log('info', 'SessionManager', `Player evicted: guild=${guildId} session=${sessionId}`)
    return removed
  }

  /**
   * Calculates the precise playback position.
   */
  computePosition(player: AurisPlayer): number {
    if (!player.track || player._tsStart === 0) return 0
    if (player.paused) return player._tsPause > 0 ? player._tsPause - player._tsStart : 0
    return Math.min(Date.now() - player._tsStart, player.track.info.length)
  }

  /**
   * Maps internal player state to Lavalink v4 API format.
   */
  exportPlayer(player: AurisPlayer): object {
    return {
      guildId:  player.guildId,
      track:    player.track,
      volume:   player.volume,
      paused:   player.paused,
      state: {
        time:      Date.now(),
        position:  this.computePosition(player),
        connected: player.liveState.active,
        ping:      player.liveState.latency,
      },
      voice:   player.voiceLink,
      filters: player.dsp,
    }
  }
}
