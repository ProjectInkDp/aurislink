// src/api/players.ts
// REST handlers for /v4/sessions/:sessionId and /v4/sessions/:sessionId/players/:guildId

import type http from 'node:http'
import type { SessionManager } from '../core/SessionManager.js'
import type { WebSocketManager } from '../core/WebSocketManager.js'
import type { Filters } from '../core/SessionManager.js'
import type { Source } from '../typings/index.js'
import { decodeTrack } from '../utils/track.js'
import { sendJson, sendError } from './helpers.js'
import { log } from '../utils/logger.js'
import { applyFilters, activeFilterNames } from '../filters/FilterChain.js'

// ─── Body reader ──────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function parseBody<T>(req: http.IncomingMessage, res: http.ServerResponse): Promise<T | null> {
  try {
    const raw = await readBody(req)
    if (!raw.trim()) return {} as T
    return JSON.parse(raw) as T
  } catch {
    sendError(res, 400, 'Bad Request', 'Invalid JSON body')
    return null
  }
}

// ─── PATCH /v4/sessions/:sessionId ───────────────────────────────────────────

export async function handleUpdateSession(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string,
  sm: SessionManager,
) {
  const body = await parseBody<{ resuming?: boolean; timeout?: number }>(req, res)
  if (body === null) return

  const session = sm.updateSession(sessionId, body.resuming ?? false, body.timeout ?? 60)
  if (!session) return sendError(res, 404, 'Not Found', `Session ${sessionId} not found`)

  sendJson(res, 200, { resuming: session.resuming, timeout: session.timeout })
}

// ─── GET /v4/sessions/:sessionId/players ─────────────────────────────────────

export function handleGetPlayers(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
  sessionId: string,
  sm:   SessionManager,
) {
  const session = sm.getSession(sessionId)
  if (!session) return sendError(res, 404, 'Not Found', `Session ${sessionId} not found`)

  const players = sm.getAllPlayers(sessionId).map(p => sm.serializePlayer(p))
  sendJson(res, 200, players)
}

// ─── GET /v4/sessions/:sessionId/players/:guildId ────────────────────────────

export function handleGetPlayer(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
  sessionId: string,
  guildId:   string,
  sm:        SessionManager,
) {
  const player = sm.getPlayer(sessionId, guildId)
  if (!player) return sendError(res, 404, 'Not Found', `Player for guild ${guildId} not found`)

  sendJson(res, 200, sm.serializePlayer(player))
}

// ─── PATCH /v4/sessions/:sessionId/players/:guildId ──────────────────────────

export async function handleUpdatePlayer(
  req:       http.IncomingMessage,
  res:       http.ServerResponse,
  sessionId: string,
  guildId:   string,
  sm:        SessionManager,
  wsm:       WebSocketManager,
  sources:   Map<string, Source>,
  url:       URL,
) {
  const noReplace = url.searchParams.get('noReplace') === 'true'

  const body = await parseBody<{
    track?:   { encoded?: string | null; identifier?: string } | null
    volume?:  number
    paused?:  boolean
    filters?: Filters
    voice?:   { token: string; endpoint: string; sessionId: string }
    position?: number
    endTime?:  number
  }>(req, res)
  if (body === null) return

  const session = sm.getSession(sessionId)
  if (!session) return sendError(res, 404, 'Not Found', `Session ${sessionId} not found`)

  const player = sm.getOrCreatePlayer(sessionId, guildId)!

  // ── Voice state ──
  if (body.voice) {
    player.voice = body.voice
    player.state.connected = !!(body.voice.token && body.voice.endpoint)
    log('info', 'Players', `Voice state updated for guild=${guildId}`)
  }

  // ── Volume (player-level, Lavalink compat — 0–1000) ──
  if (body.volume !== undefined) {
    player.volume = Math.max(0, Math.min(1000, body.volume))
  }

  // ── Paused ──
  if (body.paused !== undefined) {
    if (body.paused && !player.paused) {
      player._pausedAt = Date.now()
    } else if (!body.paused && player.paused) {
      if (player._pausedAt > 0 && player._startedAt > 0) {
        player._startedAt += Date.now() - player._pausedAt
      }
      player._pausedAt = 0
    }
    player.paused = body.paused
  }

  // ── Filters — merge e loga quais ficaram ativos ──
  if (body.filters !== undefined) {
    player.filters = { ...player.filters, ...body.filters }
    const active = activeFilterNames(player.filters)
    log('info', 'Players', `Filters updated guild=${guildId} active=[${active.join(', ') || 'none'}]`)
  }

  // ── Track ──
  if (body.track !== undefined) {
    if (noReplace && player.track) {
      return sendJson(res, 200, sm.serializePlayer(player))
    }

    if (body.track === null || body.track.encoded === null) {
      if (player.track) wsm.emitTrackEnd(player, 'stopped')
      player.track     = null
      player._startedAt = 0
      player._pausedAt  = 0
    } else if (body.track.encoded) {
      try {
        const info = decodeTrack(body.track.encoded)
        player.track      = { encoded: body.track.encoded, info, pluginInfo: {} }
        player._startedAt = Date.now()
        player._pausedAt  = 0
        player.paused     = false
        wsm.emitTrackStart(player)
        log('info', 'Players', `Track started: "${info.title}" guild=${guildId}`)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return sendError(res, 400, 'Bad Request', `Invalid track encoding: ${msg}`)
      }
    } else if (body.track.identifier) {
      let found = false
      for (const source of sources.values()) {
        if (source.accepts(body.track.identifier)) {
          try {
            const result = await source.load(body.track.identifier)
            if (result.loadType === 'track') {
              const track = result.data as import('../typings/index.js').Track
              player.track      = track
              player._startedAt = Date.now()
              player._pausedAt  = 0
              player.paused     = false
              wsm.emitTrackStart(player)
              log('info', 'Players', `Track started via identifier: "${track.info.title}" guild=${guildId}`)
              found = true
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            log('warn', 'Players', `Source load error: ${msg}`)
          }
          break
        }
      }
      if (!found) {
        return sendError(res, 400, 'Bad Request', `No source found for identifier: ${body.track.identifier}`)
      }
    }
  }

  // ── Seek ──
  if (body.position !== undefined && player.track) {
    const seekTo = Math.max(0, Math.min(body.position, player.track.info.length))
    player._startedAt = Date.now() - seekTo
    player._pausedAt  = 0
    log('info', 'Players', `Seek to ${seekTo}ms guild=${guildId}`)
  }

  wsm.emitPlayerUpdate(player)
  sendJson(res, 200, sm.serializePlayer(player))
}

// ─── DELETE /v4/sessions/:sessionId/players/:guildId ─────────────────────────

export function handleDeletePlayer(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
  sessionId: string,
  guildId:   string,
  sm:        SessionManager,
  wsm:       WebSocketManager,
) {
  const player = sm.getPlayer(sessionId, guildId)
  if (player?.track) wsm.emitTrackEnd(player, 'stopped')

  const deleted = sm.deletePlayer(sessionId, guildId)
  if (!deleted) return sendError(res, 404, 'Not Found', `Player for guild ${guildId} not found`)

  res.writeHead(204)
  res.end()
}

// ─── GET /v4/sessions/:sessionId/players/:guildId/filters ────────────────────
// Test endpoint — returns active filters + applies pipeline to a silent buffer.

export function handleGetFilters(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
  sessionId: string,
  guildId:   string,
  sm:        SessionManager,
) {
  const player = sm.getPlayer(sessionId, guildId)
  if (!player) return sendError(res, 404, 'Not Found', `Player for guild ${guildId} not found`)

  // Run a tiny silent PCM buffer through the pipeline to confirm no crash
  const testChunk = Buffer.alloc(512, 0)
  let pipelineOk = true
  let pipelineError = ''
  try {
    applyFilters(testChunk, player.filters)
  } catch (err) {
    pipelineOk   = false
    pipelineError = err instanceof Error ? err.message : String(err)
  }

  sendJson(res, 200, {
    guildId,
    filters:      player.filters,
    activeFilters: activeFilterNames(player.filters),
    pipelineOk,
    pipelineError: pipelineOk ? null : pipelineError,
  })
}
