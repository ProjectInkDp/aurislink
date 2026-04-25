// src/core/WebSocketManager.ts
// Handles Lavalink v4 WebSocket connections and outbound events.

import { WebSocketServer, WebSocket } from 'ws'
import type http from 'node:http'
import type https from 'node:https'
import type { AurisConfig } from '../typings/index.js'
import type { SessionManager, Player } from './SessionManager.js'
import { log } from '../utils/logger.js'

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

  constructor(
    private config:  AurisConfig,
    private sm:      SessionManager,
  ) {}

  /** Attach to an existing HTTP/HTTPS server. */
  attach(server: http.Server | https.Server): void {
    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      // Auth
      const auth = req.headers['authorization']
      if (auth !== this.config.server.password) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        log('warn', 'WS', 'Rejected connection — bad password')
        return
      }

      const userId    = req.headers['user-id'] as string | undefined
      const clientName = req.headers['client-name'] as string | undefined

      if (!userId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        log('warn', 'WS', 'Rejected connection — missing User-Id header')
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const session  = this.sm.createSession()
        const client: Client = { sessionId: session.sessionId, ws, userId }
        this.clients.set(session.sessionId, client)

        log('info', 'WS', `Client connected: userId=${userId} name=${clientName ?? '?'} session=${session.sessionId}`)

        // Send ready event
        this._send(ws, { op: 'ready', resumed: false, sessionId: session.sessionId })

        ws.on('message', (data) => this._onMessage(session.sessionId, data.toString()))
        ws.on('close', (code, reason) => this._onClose(session.sessionId, code, reason.toString()))
        ws.on('error', (err) => log('error', 'WS', `Error on ${session.sessionId}: ${err.message}`))
      })
    })

    log('info', 'WS', 'WebSocket server attached')
  }

  // ── Inbound ─────────────────────────────────────────────────────────────────

  private _onMessage(sessionId: string, raw: string): void {
    try {
      const msg = JSON.parse(raw)
      log('debug', 'WS', `Message from ${sessionId}: ${JSON.stringify(msg)}`)
      // Lavalink v4 clients send voiceUpdate via REST, not WS — nothing to handle here yet
    } catch {
      log('warn', 'WS', `Non-JSON message from ${sessionId}`)
    }
  }

  private _onClose(sessionId: string, code: number, reason: string): void {
    log('info', 'WS', `Client disconnected: session=${sessionId} code=${code} reason=${reason || '—'}`)
    this.clients.delete(sessionId)
    this.sm.deleteSession(sessionId)
  }

  // ── Outbound helpers ─────────────────────────────────────────────────────────

  private _send(ws: WebSocket, payload: WsEvent): void {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }

  sendToSession(sessionId: string, payload: WsEvent): void {
    const client = this.clients.get(sessionId)
    if (client) this._send(client.ws, payload)
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
    this.sendToSession(player.sessionId, {
      op:      'event',
      type:    'TrackStartEvent',
      guildId: player.guildId,
      track:   player.track,
    })
  }

  emitTrackEnd(player: Player, reason: string): void {
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

  // ── Stats broadcast ──────────────────────────────────────────────────────────

  broadcastStats(): void {
    const sessions = this.sm.getAllSessions()
    let totalPlayers  = 0
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
