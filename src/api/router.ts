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
import { handleHealth } from './health.js'
import { handleVersion } from './version.js'
import { handleLyricsSubscribe } from './lyricsSubscribe.js'
import { handleRoutePlannerStatus, handleRoutePlannerFreeAddress, handleRoutePlannerFreeAll } from './routePlanner.js'
import type { RoutePlanner } from '../core/RoutePlanner.js'
import { checkRateLimit, getClientIp } from '../utils/rateLimit.js'
import type TrackCache from '../core/TrackCache.js'
import type TokenStore from '../core/TokenStore.js'

const SESSION_RE = /^\/v4\/sessions\/([^/]+)$/
const PLAYERS_RE = /^\/v4\/sessions\/([^/]+)\/players$/
const PLAYER_RE  = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)$/
const LYRICS_RE  = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/track\/lyrics$/
const LYRICS_SUB_RE = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/lyrics\/subscribe$/
const FILTERS_RE = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/filters$/

export function createRouter(
  config: AurisConfig,
  sources: Map<string, Source>,
  sm: SessionManager,
  wsm: WebSocketManager,
  rp: RoutePlanner | null = null,
  lyricsManager?: import('../core/LyricsManager.js').LyricsManager,
  dos?: import('../core/DosProtection.js').default | null,
  trackCache?: TrackCache,
  tokenStore?: TokenStore
) {
  return async function router(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    const path = url.pathname

    log('info', 'Router', `→ ${method} ${path}`)

    // Public endpoints — no auth required
    if (method === 'GET' && path === '/v4/health') return handleHealth(req, res)
    if (method === 'GET' && path === '/v4/metrics') return handleMetrics(req, res, sm)
    if (method === 'GET' && path === '/v4/version') return handleVersion(req, res)

    // Rate limiting — 120 requests per minute per IP
    const clientIp = getClientIp(req as any)
    if (!checkRateLimit(clientIp, 120)) {
      res.writeHead(429, { 'content-type': 'application/json', 'retry-after': '60' })
      res.end(JSON.stringify({ status: 429, error: 'Too Many Requests', message: 'Rate limit exceeded. Try again in 60 seconds.' }))
      return
    }

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
      const mem  = process.memoryUsage()
      const cpu  = process.cpuUsage()
      // Event-loop lag: sampled continuously by the metrics module via setImmediate
      // We re-derive a fresh sample here for the REST response.
      const lagStart = process.hrtime.bigint()
      await new Promise<void>(r => setImmediate(r))
      const eventLoopLagMs = Number(process.hrtime.bigint() - lagStart) / 1_000_000

      return sendJson(res, 200, {
        players:       totalPlayers,
        playingPlayers,
        uptime:        process.uptime() * 1000,
        memory: {
          free:       mem.heapTotal - mem.heapUsed,
          used:       mem.heapUsed,
          allocated:  mem.heapTotal,
          reservable: mem.rss,
          external:   mem.external,
        },
        cpu: {
          cores:      require('os').cpus().length,
          userUsage:  cpu.user,
          sysUsage:   cpu.system,
          systemLoad: 0,
          lavalinkLoad: 0,
        },
        eventLoopLagMs: parseFloat(eventLoopLagMs.toFixed(3)),
        frameStats: {
          sent:    0,
          nulled:  0,
          deficit: 0,
        },
        node: {
          version:  process.version,
          platform: process.platform,
          arch:     process.arch,
        },
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

    m = path.match(LYRICS_SUB_RE)
    if (m) {
      const [, sessionId, guildId] = m
      if (method === 'GET') return handleLyricsSubscribe(req, res, sessionId!, guildId!, sm)
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

    if (path === '/v4/routeplanner/status' && method === 'GET') return handleRoutePlannerStatus(req, res, rp)
    if (path === '/v4/routeplanner/free/address' && method === 'POST') return handleRoutePlannerFreeAddress(req, res, rp)
    if (path === '/v4/routeplanner/free/all' && method === 'POST') return handleRoutePlannerFreeAll(req, res, rp)

    sendError(res, 404, 'Not Found', `No route for ${method} ${path}`)
  }
}
