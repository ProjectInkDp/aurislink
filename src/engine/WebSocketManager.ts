// src/engine/WebSocketManager.ts
// AurisLink Real-time Communication Gateway
// Manages WebSocket lifecycle, session restoration, and event dispatching.

import { WebSocketServer, WebSocket } from 'ws'
import type http from 'node:http'
import type https from 'node:https'
import type { AurisConfig } from '../typings/index.js'
import type { SessionManager, AurisPlayer } from './SessionManager.js'
import { log } from '../shared/reporter.js'

/**
 * Outbound message structure for Lavalink v4 protocol.
 */
export type GatewayPayload =
  | { op: 'ready';        resumed: boolean; sessionId: string }
  | { op: 'playerUpdate'; guildId: string; state: { time: number; position: number; connected: boolean; ping: number } }
  | { op: 'stats';        players: number; playingPlayers: number; uptime: number; memory: SystemMemory; cpu: SystemCpu; frameStats: null }
  | { op: 'event';        type: AudioEventType; guildId: string; [k: string]: unknown }

type AudioEventType = 'TrackStartEvent' | 'TrackEndEvent' | 'TrackExceptionEvent' | 'TrackStuckEvent' | 'WebSocketClosedEvent'

interface SystemMemory { free: number; used: number; allocated: number; reservable: number }
interface SystemCpu    { cores: number; systemLoad: number; lavalinkLoad: number }

/**
 * Internal representation of a connected gateway client.
 */
interface GatewayClient {
  sid:       string
  socket:    WebSocket
  uid:       string
}

export class WebSocketManager {
  private activeClients = new Map<string, GatewayClient>()
  private bootTime      = Date.now()
  private stallTracker  = new Map<string, number>()

  constructor(
    private config: AurisConfig,
    private orchestrator: SessionManager,
  ) {}

  /**
   * Integrates the WebSocket gateway with the provided HTTP/S server.
   */
  mount(server: http.Server | https.Server): void {
    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const token = req.headers['authorization']
      if (token !== this.config.server.password) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        log('warn', 'Gateway', 'Access denied: Invalid authorization token')
        return
      }

      const userId   = req.headers['user-id']     as string | undefined
      const agent    = req.headers['client-name'] as string | undefined
      const resumeId = req.headers['session-id']  as string | undefined

      if (!userId) {
        socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
        socket.destroy()
        log('warn', 'Gateway', 'Access denied: Missing User-Id')
        return
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        // Handle session restoration if requested
        if (resumeId && this.orchestrator.parkSession(resumeId)) {
          this._processRestoration(ws, resumeId, userId, agent)
          return
        }

        // Initialize fresh session
        const session = this.orchestrator.openSession()
        const client: GatewayClient = { sid: session.id, socket: ws, uid: userId }
        this.activeClients.set(session.id, client)

        log('info', 'Gateway', `Connection established | User: ${userId} | Agent: ${agent ?? 'Generic'} | SID: ${session.id}`)

        this._transmit(ws, { op: 'ready', resumed: false, sessionId: session.id })

        ws.on('message', (raw) => this._handleInbound(session.id, raw.toString()))
        ws.on('close',   (code, reason) => this._handleDisconnect(session.id, code, reason.toString()))
        ws.on('error',   (err) => log('error', 'Gateway', `Socket error [${session.id}]: ${err.message}`))
      })
    })

    log('info', 'Gateway', 'WebSocket gateway mounted successfully')
  }

  private _processRestoration(ws: WebSocket, sid: string, uid: string, agent?: string): void {
    const session = this.orchestrator.restoreSession(sid)
    
    if (!session) {
      // Fallback to new session if restoration fails
      const fresh = this.orchestrator.openSession()
      const client: GatewayClient = { sid: fresh.id, socket: ws, uid }
      this.activeClients.set(fresh.id, client)
      this._transmit(ws, { op: 'ready', resumed: false, sessionId: fresh.id })
      
      ws.on('message', (raw) => this._handleInbound(fresh.id, raw.toString()))
      ws.on('close',   (code, reason) => this._handleDisconnect(fresh.id, code, reason.toString()))
      ws.on('error',   (err) => log('error', 'Gateway', `Socket error [${fresh.id}]: ${err.message}`))
      return
    }

    const client: GatewayClient = { sid, socket: ws, uid }
    this.activeClients.set(sid, client)

    log('info', 'Gateway', `Session restored | User: ${uid} | Agent: ${agent ?? 'Generic'} | SID: ${sid}`)

    this._transmit(ws, { op: 'ready', resumed: true, sessionId: sid })

    // Flush buffered events
    const backlog = this.orchestrator.flushBacklog(sid)
    for (const data of backlog) {
      if (ws.readyState === WebSocket.OPEN) ws.send(data)
    }

    if (backlog.length > 0) {
      log('debug', 'Gateway', `Dispatched ${backlog.length} buffered events to SID: ${sid}`)
    }

    ws.on('message', (raw) => this._handleInbound(sid, raw.toString()))
    ws.on('close',   (code, reason) => this._handleDisconnect(sid, code, reason.toString()))
    ws.on('error',   (err) => log('error', 'Gateway', `Socket error [${sid}]: ${err.message}`))
  }

  private _handleInbound(sid: string, raw: string): void {
    try {
      const payload = JSON.parse(raw)
      log('debug', 'Gateway', `Inbound from ${sid}: ${JSON.stringify(payload)}`)
    } catch {
      log('warn', 'Gateway', `Malformed payload from ${sid}`)
    }
  }

  private _handleDisconnect(sid: string, code: number, reason: string): void {
    log('info', 'Gateway', `Connection closed | SID: ${sid} | Code: ${code} | Reason: ${reason || 'None'}`)
    this.activeClients.delete(sid)

    // Attempt to park the session for potential recovery
    const parked = this.orchestrator.parkSession(sid)
    if (!parked) {
      this.orchestrator.closeSession(sid)
    }
  }

  private _transmit(ws: WebSocket, payload: GatewayPayload): void {
    if (ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify(payload))
  }

  dispatch(sid: string, payload: GatewayPayload): void {
    const client = this.activeClients.get(sid)
    if (client) {
      this._transmit(client.socket, payload)
      return
    }

    // Buffer if session is in standby
    const session = this.orchestrator.findSession(sid)
    if (session?.isInactive) {
      this.orchestrator.bufferEvent(sid, JSON.stringify(payload))
    }
  }

  broadcast(payload: GatewayPayload): void {
    for (const client of this.activeClients.values()) {
      this._transmit(client.socket, payload)
    }
  }

  // ── Event Emitters ──────────────────────────────────────────────────────────

  pushPlayerUpdate(player: AurisPlayer): void {
    this.dispatch(player.parentSession, {
      op:      'playerUpdate',
      guildId: player.guildId,
      state: {
        time:      Date.now(),
        position:  this.orchestrator.computePosition(player),
        connected: player.liveState.active,
        ping:      player.liveState.latency,
      },
    })
  }

  pushTrackStart(player: AurisPlayer): void {
    if (!player.track) return
    this.stallTracker.delete(player.guildId)
    this.dispatch(player.parentSession, {
      op:      'event',
      type:    'TrackStartEvent',
      guildId: player.guildId,
      track:   player.track,
    })
  }

  pushTrackEnd(player: AurisPlayer, reason: string): void {
    this.stallTracker.delete(player.guildId)
    this.dispatch(player.parentSession, {
      op:      'event',
      type:    'TrackEndEvent',
      guildId: player.guildId,
      track:   player.track,
      reason,
    })
  }

  pushTrackException(player: AurisPlayer, error: string): void {
    this.dispatch(player.parentSession, {
      op:      'event',
      type:    'TrackExceptionEvent',
      guildId: player.guildId,
      track:   player.track,
      exception: { message: error, severity: 'fault', cause: error },
    })
  }

  pushTrackStuck(player: AurisPlayer, threshold: number): void {
    log('warn', 'Gateway', `Playback stalled | Guild: ${player.guildId} | Threshold: ${threshold}ms`)
    this.dispatch(player.parentSession, {
      op:          'event',
      type:        'TrackStuckEvent',
      guildId:     player.guildId,
      track:       player.track,
      thresholdMs: threshold,
    })
  }

  // ── Watchdogs ───────────────────────────────────────────────────────────────

  initStallWatchdog(interval: number, threshold: number): void {
    setInterval(() => {
      for (const session of this.orchestrator.listActive()) {
        for (const player of session.registry.values()) {
          if (!player.track || player.paused) {
            this.stallTracker.delete(player.guildId)
            continue
          }
          const pos  = this.orchestrator.computePosition(player)
          const last = this.stallTracker.get(player.guildId)

          if (last === undefined) {
            this.stallTracker.set(player.guildId, pos)
            continue
          }

          if (pos === last) {
            this.pushTrackStuck(player, threshold)
            this.stallTracker.delete(player.guildId)
          } else {
            this.stallTracker.set(player.guildId, pos)
          }
        }
      }
    }, threshold).unref()
  }

  initResourceCleanup(threshold: number): void {
    setInterval(() => {
      for (const session of this.orchestrator.listActive()) {
        for (const player of session.registry.values()) {
          if (!player.liveState.active && !player.track) {
            const idle = Date.now() - player.liveState.updatedAt
            if (idle >= threshold) {
              log('warn', 'Gateway', `Evicting idle player | Guild: ${player.guildId} | Idle: ${idle}ms`)
              this.orchestrator.evictPlayer(session.id, player.guildId)
            }
          }
        }
      }
    }, threshold).unref()
  }

  initStatsBroadcast(): void {
    setInterval(() => {
      const sessions = this.orchestrator.listActive()
      let total = 0
      let active = 0

      for (const s of sessions) {
        for (const p of s.registry.values()) {
          total++
          if (p.track && !p.paused) active++
        }
      }

      const usage = process.memoryUsage()

      this.broadcast({
        op:             'stats',
        players:        total,
        playingPlayers: active,
        uptime:         Date.now() - this.bootTime,
        memory: {
          free:       usage.heapTotal - usage.heapUsed,
          used:       usage.heapUsed,
          allocated:  usage.heapTotal,
          reservable: usage.rss,
        },
        cpu: {
          cores:        1,
          systemLoad:   0,
          lavalinkLoad: 0,
        },
        frameStats: null,
      })
    }, 60000).unref()
  }
}
