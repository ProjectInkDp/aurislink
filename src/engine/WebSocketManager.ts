// src/core/WebSocketManager.ts
// Handles Lavalink v4 WebSocket connections, session recovery, and outbound events.

import { WebSocketServer, WebSocket } from 'ws'
import type http from 'node:http'
import type https from 'node:https'
import type { AurisConfig } from '../typings/index.js'
import type { SessionManager, Player } from './SessionManager.js'
import { log } from '../shared/reporter.js'

// ─── Event types (server → client) ───────────────────────────────────────────

export type WsEvent =
  | { op: 'ready';        resumed: boolean; sessionId: string }
  | { op: 'playerUpdate'; guildId: string; state: { time: number; position: number; connected: boolean; ping: number } }
  | { op: 'stats';        players: number; playingPlayers: number; uptime: number; memory: MemoryStats; cpu: CpuStats; frameStats: null }
  | { op: 'event';        type: TrackEventType; guildId: string; [k: string]: unknown }

type TrackEventType = 'TrackStartEvent' | 'TrackEndEvent' | 'TrackExceptionEvent' | 'TrackStuckEvent' | 'WebSocketClosedEvent'

interface MemoryStats { free: number; used: number; allocated: number; reservable: number }
interface CpuStats   { cores: number; systemLoad: number; lavalinkLoad: number }

// ─── Connected client ─────────────────────────────────────────────────────────

interface Client {
  sessionId: string
  ws:        WebSocket
  userId:    string
}

// ─── WebSocketManager ─────────────────────────────────────────────────────────

export class WebSocketManager {
  private clients   = new Map<string, Client>()   // sessionId → client
  private startedAt = Date.now()

  // TrackStuck tracking: guildId → last known position
  private _stuckPositions = new Map<string, number>()

  constructor(
    private config: AurisConfig,
    private sm:     SessionManager,
  ) {}

  /** Attach to an existing HTTP/HTTPS server. */
  attach(server: http.Server | https.Server): void {
    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const auth = req.headers['authorization']
      if (auth !== this.config.server.password) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        log('warn', 'WS', 'Rejected connection — bad password')
        return
      }

      const userId     = req.headers['user-id']     as string | undefined
      const clientName = req.headers['client-name'] as string | undefined
      const sessionId  = req.headers['session-id']  as string | undefined

      if (!userId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        log('warn', 'WS', 'Rejected connection — missing User-Id header')
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        // Attempt session recovery if client provides a Session-Id header
        if (sessionId && this.sm.isSuspended(sessionId)) {
          this._handleRecovery(ws, sessionId, userId, clientName)
          return
        }

        // Fresh session
        const session = this.sm.createSession()
        const client: Client = { sessionId: session.sessionId, ws, userId }
        this.clients.set(session.sessionId, client)

        log('info', 'WS', `Client connected | userId=${userId} | name=${clientName ?? '?'} | session=${session.sessionId}`)

        this._send(ws, { op: 'ready', resumed: false, sessionId: session.sessionId })

        ws.on('message', (data) => this._onMessage(session.sessionId, data.toString()))
        ws.on('close',   (code, reason) => this._onClose(session.sessionId, code, reason.toString()))
        ws.on('error',   (err) => log('error', 'WS', `Error on ${session.sessionId}: ${err.message}`))
      })
    })

    log('info', 'WS', 'WebSocket server attached')
  }

  // ── Session Recovery ────────────────────────────────────────────────────────

  /**
   * Handles a client reconnecting to a previously suspended session.
   * Flushes all queued events back to the client.
   */
  private _handleRecovery(ws: WebSocket, sessionId: string, userId: string, clientName?: string): void {
    const session = this.sm.recover(sessionId)
    if (!session) {
      // Fallback: create a fresh session if recovery fails
      const fresh = this.sm.createSession()
      const client: Client = { sessionId: fresh.sessionId, ws, userId }
      this.clients.set(fresh.sessionId, client)
      this._send(ws, { op: 'ready', resumed: false, sessionId: fresh.sessionId })
      ws.on('message', (data) => this._onMessage(fresh.sessionId, data.toString()))
      ws.on('close',   (code, reason) => this._onClose(fresh.sessionId, code, reason.toString()))
      ws.on('error',   (err) => log('error', 'WS', `Error on ${fresh.sessionId}: ${err.message}`))
      return
    }

    // Re-register the client
    const client: Client = { sessionId, ws, userId }
    this.clients.set(sessionId, client)

    log('info', 'WS', `Session recovered | userId=${userId} | name=${clientName ?? '?'} | session=${sessionId}`)

    // Notify the client that the session was resumed
    this._send(ws, { op: 'ready', resumed: true, sessionId })

    // Flush all queued events
    const pending = this.sm.drainPendingEvents(sessionId)
    for (const raw of pending) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(raw)
      }
    }

    if (pending.length > 0) {
      log('debug', 'WS', `Flushed ${pending.length} pending event(s) to session ${sessionId}`)
    }

    ws.on('message', (data) => this._onMessage(sessionId, data.toString()))
    ws.on('close',   (code, reason) => this._onClose(sessionId, code, reason.toString()))
    ws.on('error',   (err) => log('error', 'WS', `Error on ${sessionId}: ${err.message}`))
  }

  // ── Inbound ─────────────────────────────────────────────────────────────────

  private _onMessage(sessionId: string, raw: string): void {
    try {
      const msg = JSON.parse(raw)
      log('debug', 'WS', `Message from ${sessionId}: ${JSON.stringify(msg)}`)
    } catch {
      log('warn', 'WS', `Non-JSON message from ${sessionId}`)
    }
  }

  private _onClose(sessionId: string, code: number, reason: string): void {
    log('info', 'WS', `Client disconnected | session=${sessionId} | code=${code} | reason=${reason || '—'}`)
    this.clients.delete(sessionId)

    // Try to suspend the session for recovery instead of destroying immediately
    const didSuspend = this.sm.suspend(sessionId)
    if (!didSuspend) {
      this.sm.deleteSession(sessionId)
    }
  }

  // ── Outbound helpers ─────────────────────────────────────────────────────────

  private _send(ws: WebSocket, payload: WsEvent): void {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }

  sendToSession(sessionId: string, payload: WsEvent): void {
    const client = this.clients.get(sessionId)
    if (client) {
      this._send(client.ws, payload)
      return
    }

    // If the session is suspended and resuming is enabled, queue the event
    if (this.sm.isSuspended(sessionId)) {
      this.sm.queueEvent(sessionId, JSON.stringify(payload))
    }
  }

  broadcast(payload: WsEvent): void {
    for (const client of this.clients.values()) {
      this._send(client.ws, payload)
    }
  }

  // ── Player events ────────────────────────────────────────────────────────────

  emitPlayerUpdate(player: Player): void {
    this.sendToSession(player.sessionId, {
      op:      'playerUpdate',
      guildId: player.guildId,
      state: {
        time:      Date.now(),
        position:  this.sm.getPosition(player),
        connected: player.state.connected,
        ping:      player.state.ping,
      },
    })
  }

  emitTrackStart(player: Player): void {
    if (!player.track) return
    this._stuckPositions.delete(player.guildId)
    this.sendToSession(player.sessionId, {
      op:      'event',
      type:    'TrackStartEvent',
      guildId: player.guildId,
      track:   player.track,
    })
  }

  emitTrackEnd(player: Player, reason: string): void {
    this._stuckPositions.delete(player.guildId)
    this.sendToSession(player.sessionId, {
      op:      'event',
      type:    'TrackEndEvent',
      guildId: player.guildId,
      track:   player.track,
      reason,
    })
  }

  emitTrackException(player: Player, error: string): void {
    this.sendToSession(player.sessionId, {
      op:      'event',
      type:    'TrackExceptionEvent',
      guildId: player.guildId,
      track:   player.track,
      exception: { message: error, severity: 'fault', cause: error },
    })
  }

  emitTrackStuck(player: Player, thresholdMs: number): void {
    log('warn', 'WS', `TrackStuck | guild=${player.guildId} | threshold=${thresholdMs}ms`)
    this.sendToSession(player.sessionId, {
      op:          'event',
      type:        'TrackStuckEvent',
      guildId:     player.guildId,
      track:       player.track,
      thresholdMs,
    })
  }

  // ── TrackStuck watchdog ──────────────────────────────────────────────────────

  startStuckWatchdog(intervalMs: number, thresholdMs: number): void {
    setInterval(() => {
      for (const session of this.sm.getAllSessions()) {
        for (const player of session.players.values()) {
          if (!player.track || player.paused) {
            this._stuckPositions.delete(player.guildId)
            continue
          }
          const pos  = this.sm.getPosition(player)
          const last = this._stuckPositions.get(player.guildId)

          if (last === undefined) {
            this._stuckPositions.set(player.guildId, pos)
            continue
          }

          if (pos === last) {
            this.emitTrackStuck(player, thresholdMs)
            this._stuckPositions.delete(player.guildId)
          } else {
            this._stuckPositions.set(player.guildId, pos)
          }
        }
      }
    }, thresholdMs).unref()
  }

  // ── Zombie player cleanup ────────────────────────────────────────────────────

  startZombieCleanup(zombieThresholdMs: number): void {
    setInterval(() => {
      for (const session of this.sm.getAllSessions()) {
        for (const player of session.players.values()) {
          // A zombie is a player with no voice connection and no active track
          if (!player.state.connected && !player.track) {
            const idleMs = Date.now() - player.state.time
            if (idleMs >= zombieThresholdMs) {
              log('warn', 'WS', `Zombie player removed | guild=${player.guildId} | idleMs=${idleMs}`)
              this.sm.deletePlayer(session.sessionId, player.guildId)
            }
          }
        }
      }
    }, zombieThresholdMs).unref()
  }

  // ── Stats broadcast ──────────────────────────────────────────────────────────

  broadcastStats(): void {
    const sessions = this.sm.getAllSessions()
    let totalPlayers = 0
    let playingPlayers = 0

    for (const s of sessions) {
      for (const p of s.players.values()) {
        totalPlayers++
        if (p.track && !p.paused) playingPlayers++
      }
    }

    const mem = process.memoryUsage()

    this.broadcast({
      op:            'stats',
      players:       totalPlayers,
      playingPlayers,
      uptime:        Date.now() - this.startedAt,
      memory: {
        free:       mem.heapTotal - mem.heapUsed,
        used:       mem.heapUsed,
        allocated:  mem.heapTotal,
        reservable: mem.rss,
      },
      cpu: {
        cores:        1,
        systemLoad:   0,
        lavalinkLoad: 0,
      },
      frameStats: null,
    })
  }
}
