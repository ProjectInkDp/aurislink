import type http from 'node:http'
import type { AurisConfig, Source } from '../typings/index.js'
import type { SessionManager } from '../engine/SessionManager.js'
import type { WebSocketManager } from '../engine/WebSocketManager.js'
import { log } from '../shared/reporter.js'
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
import { handleDashboard } from './dashboard.js'
import type { RoutePlanner } from '../engine/RoutePlanner.js'
import { RateLimiter, applyRateLimitHeaders } from '../shared/rateLimit.js'
import type TrackCache from '../engine/TrackCacheSQL.js'
import type Vault from '../engine/Vault.js'
import type ContentManager from '../engine/ContentManager.js'
import type GuardManager from '../engine/Guard.js'

const SESSION_RE = /^\/v4\/sessions\/([^/]+)$/
const PLAYERS_RE = /^\/v4\/sessions\/([^/]+)\/players$/
const PLAYER_RE = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)$/
const LYRICS_RE = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/track\/lyrics$/
const LYRICS_SUB_RE = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/lyrics\/subscribe$/
const FILTERS_RE = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/filters$/

export function createRouter(
  config: AurisConfig,
  sources: Map<string, Source>,
  sm: SessionManager,
  wsm: WebSocketManager,
  rp: RoutePlanner | null = null,
  lyricsManager?: ContentManager,
  dos?: GuardManager | null,
  trackCache?: TrackCache,
  tokenStore?: Vault,
  rateLimiter?: RateLimiter,
) {
  return async function router(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    const path = url.pathname

    log('info', 'Router', `→ ${method} ${path}`)

    if (method === 'GET' && path === '/v4/health') return handleHealth(req, res)
    if (method === 'GET' && path === '/v4/metrics') return handleMetrics(req, res, sm)
    if (method === 'GET' && path === '/v4/version') return handleVersion(req, res)
    if (method === 'GET' && path === '/v4/dashboard') return handleDashboard(req, res, sm)

    if (rateLimiter) {
      const rl = rateLimiter.check(req)
      if (!rl.allowed) {
        const retryAfter = rl.reset ? String(Math.max(1, Math.ceil((rl.reset - Date.now()) / 1_000))) : '60'
        res.writeHead(429, { 'content-type': 'application/json', 'retry-after': retryAfter })
        applyRateLimitHeaders(res, rl)
        res.end(JSON.stringify({ status: 429, error: 'Too Many Requests', message: `Rate limit exceeded. Retry after ${retryAfter}s.` }))
        return
      }
      applyRateLimitHeaders(res, rl)
    }

    if (path.startsWith('/v4')) {
      if (!requireAuth(req, res, config.server.password)) return
    }

    if (method === 'GET' && path === '/v4/info') return handleInfo(req, res)

    if (method === 'GET' && path === '/v4/loadtracks') return handleLoadTracks(req, res, url, sources, config)
    if (method === 'GET' && path === '/v4/decodetrack') return handleDecodeTrack(req, res, url)
    if (method === 'POST' && path === '/v4/decodetracks') return handleDecodeTracks(req, res)
    if (method === 'POST' && path === '/v4/encodetrack') return handleEncodeTrack(req, res)
    if (method === 'POST' && path === '/v4/encodetracks') return handleEncodeTracks(req, res)

    if (method === 'GET' && path === '/v4/meaning') return handleMeaning(req, res, url, config.sources.lastfm?.apiKey)

    // Session & Player routes
    let match: RegExpMatchArray | null

    if ((match = path.match(SESSION_RE))) {
      if (method === 'PATCH') return handleUpdateSession(req, res, match[1]!, sm)
    }

    if ((match = path.match(PLAYERS_RE))) {
      if (method === 'GET') return handleGetPlayers(req, res, match[1]!, sm)
    }

    if ((match = path.match(PLAYER_RE))) {
      const sessionId = match[1]!
      const guildId = match[2]!
      if (method === 'GET') return handleGetPlayer(req, res, sessionId, guildId, sm)
      if (method === 'PATCH') return handleUpdatePlayer(req, res, sessionId, guildId, sm, wsm, sources, url)
      if (method === 'DELETE') return handleDeletePlayer(req, res, sessionId, guildId, sm, wsm)
    }

    if ((match = path.match(FILTERS_RE))) {
      if (method === 'GET') return handleGetFilters(req, res, match[1]!, match[2]!, sm)
    }

    sendError(res, 404, 'Not Found', `No route for ${method} ${path}`)
  }
}
