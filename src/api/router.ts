// src/api/router.ts
// Central request router — dispatches to the correct handler based on method + path.

import type http from 'node:http'
import type { AurisConfig, Source } from '../typings/index.js'
import type { SessionManager } from '../core/SessionManager.js'
import type { WebSocketManager } from '../core/WebSocketManager.js'
import { log } from '../utils/logger.js'
import { handleLoadTracks } from './loadtracks.js'
import { handleInfo } from './info.js'
import { sendJson, sendError, requireAuth } from './helpers.js'
import { handleDecodeTrack, handleDecodeTracks, handleEncodeTrack, handleEncodeTracks } from './tracks.js'
import {
  handleUpdateSession,
  handleGetPlayers,
  handleGetPlayer,
  handleUpdatePlayer,
  handleDeletePlayer,
  handleGetFilters,
} from './players.js'
import { handleLyrics } from './lyrics.js'
import { handleMeaning } from './meaning.js'
import { handleLoadChapters } from './chapters.js'
import { handleMetrics } from './metrics.js'

const SESSION_RE = /^\/v4\/sessions\/([^/]+)$/
const PLAYERS_RE = /^\/v4\/sessions\/([^/]+)\/players$/
const PLAYER_RE  = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)$/
const LYRICS_RE  = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/track\/lyrics$/
const FILTERS_RE = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/filters$/

export function createRouter(
  config: AurisConfig,
  sources: Map<string, Source>,
  sm: SessionManager,
  wsm: WebSocketManager,
) {
  return async function router(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    const path = url.pathname

    log('debug', 'Router', `${method} ${path}`)

    // Public endpoints — no auth required
    if (method === 'GET' && path === '/v4/metrics') return handleMetrics(req, res, sm)

    if (path.startsWith('/v4')) {
      if (!requireAuth(req, res, config.server.password)) return
    }

    if (method === 'GET' && path === '/v4/info') return handleInfo(req, res)

    // Lists all active sessions — useful to grab sessionId for testing
    if (method === 'GET' && path === '/v4/sessions') {
      const sessions = sm.getAllSessions().map(s => ({
        sessionId:   s.sessionId,
        resuming:    s.resuming,
        timeout:     s.timeout,
        connectedAt: s.connectedAt,
        players:     s.players.size,
      }))
      return sendJson(res, 200, sessions)
    }

    if (method === 'GET' && path === '/v4/stats') {
      const sessions = sm.getAllSessions()
      let totalPlayers = 0, playingPlayers = 0
      for (const s of sessions) {
        for (const p of s.players.values()) {
          totalPlayers++
          if (p.track && !p.paused) playingPlayers++
        }
      }
      const mem = process.memoryUsage()
      return sendJson(res, 200, {
        players: totalPlayers,
        playingPlayers,
        uptime: process.uptime() * 1000,
        memory: { free: mem.heapTotal - mem.heapUsed, used: mem.heapUsed, allocated: mem.heapTotal, reservable: mem.rss },
        cpu: { cores: 1, systemLoad: 0, lavalinkLoad: 0 },
        frameStats: null,
      })
    }

    if (method === 'GET' && path === '/v4/loadtracks') return handleLoadTracks(req, res, url, sources, config)
    if (method === 'GET' && path === '/v4/meaning') return handleMeaning(req, res, url, config.sources.lastfm?.apiKey)
    if (method === 'GET' && path === '/v4/loadchapters') return handleLoadChapters(req, res, url, config.sources.soundcloud.clientId)
    if (method === 'GET' && path === '/v4/decodetrack') return handleDecodeTrack(req, res, url)
    if (method === 'POST' && path === '/v4/decodetracks') return handleDecodeTracks(req, res)
    if (method === 'POST' && path === '/v4/encodetrack') return handleEncodeTrack(req, res)
    if (method === 'POST' && path === '/v4/encodetracks') return handleEncodeTracks(req, res)

    let m = path.match(SESSION_RE)
    if (m) {
      const [, sessionId] = m
      if (method === 'PATCH') return handleUpdateSession(req, res, sessionId!, sm)
      return sendError(res, 405, 'Method Not Allowed', `${method} not allowed`)
    }

    m = path.match(PLAYERS_RE)
    if (m) {
      const [, sessionId] = m
      if (method === 'GET') return handleGetPlayers(req, res, sessionId!, sm)
      return sendError(res, 405, 'Method Not Allowed', `${method} not allowed`)
    }

    m = path.match(LYRICS_RE)
    if (m) {
      const [, sessionId, guildId] = m
      if (method === 'GET') return handleLyrics(req, res, sessionId!, guildId!, sm)
      return sendError(res, 405, 'Method Not Allowed', `${method} not allowed`)
    }

    m = path.match(FILTERS_RE)
    if (m) {
      const [, sessionId, guildId] = m
      if (method === 'GET') return handleGetFilters(req, res, sessionId!, guildId!, sm)
      return sendError(res, 405, 'Method Not Allowed', `${method} not allowed`)
    }

    m = path.match(PLAYER_RE)
    if (m) {
      const [, sessionId, guildId] = m
      if (method === 'GET') return handleGetPlayer(req, res, sessionId!, guildId!, sm)
      if (method === 'PATCH') return handleUpdatePlayer(req, res, sessionId!, guildId!, sm, wsm, sources, url)
      if (method === 'DELETE') return handleDeletePlayer(req, res, sessionId!, guildId!, sm, wsm)
      return sendError(res, 405, 'Method Not Allowed', `${method} not allowed`)
    }

    sendError(res, 404, 'Not Found', `No route for ${method} ${path}`)
  }
}
