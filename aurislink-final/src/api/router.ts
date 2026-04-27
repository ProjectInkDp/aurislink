// src/api/router.ts
// Router central — despacha para o handler correto baseado em método + path.
// Rotas de plugins são montadas dinamicamente e verificadas antes do 404.

import type http from 'node:http'
import type { AurisConfig, Source, LoadResult } from '../typings/index.js'
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
} from './players.js'
import { handleLyrics } from './lyrics.js'
import { handleMeaning } from './meaning.js'
import { getLoadedPlugins } from '../plugins/index.js'

const SESSION_RE = /^\/v4\/sessions\/([^/]+)$/
const PLAYERS_RE = /^\/v4\/sessions\/([^/]+)\/players$/
const PLAYER_RE  = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)$/
const LYRICS_RE  = /^\/v4\/sessions\/([^/]+)\/players\/([^/]+)\/track\/lyrics$/

// ─── Body reader util ─────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', () => resolve(''))
  })
}

// ─── Hook de TrackLoad de plugins ─────────────────────────────────────────────

/**
 * Passa o resultado de loadtracks por todos os hooks `onTrackLoad` dos plugins
 * na ordem em que foram registrados.
 */
async function applyTrackLoadHooks(identifier: string, result: LoadResult): Promise<LoadResult> {
  let current = result
  for (const { plugin } of getLoadedPlugins()) {
    if (!plugin.onTrackLoad) continue
    try {
      current = await plugin.onTrackLoad(identifier, current)
    } catch (err) {
      log('error', 'Router', `onTrackLoad hook falhou: ${err}`)
    }
  }
  return current
}

// ─── Factory do router ────────────────────────────────────────────────────────

export function createRouter(
  config: AurisConfig,
  sources: Map<string, Source>,
  sm: SessionManager,
  wsm: WebSocketManager,
) {
  return async function router(req: http.IncomingMessage, res: http.ServerResponse) {
    const url    = new URL(req.url ?? '/', `http://${req.headers.host}`)
    const method = req.method ?? 'GET'
    const path   = url.pathname

    log('debug', 'Router', `${method} ${path}`)

    if (path.startsWith('/v4')) {
      if (!requireAuth(req, res, config.server.password)) return
    }

    // ── Rotas nativas ─────────────────────────────────────────────────────────

    if (method === 'GET' && path === '/v4/info')
      return handleInfo(req, res)

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

    if (method === 'GET' && path === '/v4/loadtracks') {
      // Aplica hooks de plugin no resultado final
      const identifier = url.searchParams.get('identifier') ?? ''
      const rawResult  = await handleLoadTracks(req, res, url, sources, config, { dryRun: true })
      if (rawResult) {
        const hooked = await applyTrackLoadHooks(identifier, rawResult)
        return sendJson(res, 200, hooked)
      }
      return
    }

    if (method === 'GET'  && path === '/v4/meaning')      return handleMeaning(req, res, url, config.sources.lastfm?.apiKey)
    if (method === 'GET'  && path === '/v4/decodetrack')   return handleDecodeTrack(req, res, url)
    if (method === 'POST' && path === '/v4/decodetracks')  return handleDecodeTracks(req, res)
    if (method === 'POST' && path === '/v4/encodetrack')   return handleEncodeTrack(req, res)
    if (method === 'POST' && path === '/v4/encodetracks')  return handleEncodeTracks(req, res)

    let m = path.match(SESSION_RE)
    if (m) {
      const [, sessionId] = m
      if (method === 'PATCH') return handleUpdateSession(req, res, sessionId!, sm)
      return sendError(res, 405, 'Method Not Allowed', `${method} não permitido`)
    }

    m = path.match(PLAYERS_RE)
    if (m) {
      const [, sessionId] = m
      if (method === 'GET') return handleGetPlayers(req, res, sessionId!, sm)
      return sendError(res, 405, 'Method Not Allowed', `${method} não permitido`)
    }

    m = path.match(LYRICS_RE)
    if (m) {
      const [, sessionId, guildId] = m
      if (method === 'GET') return handleLyrics(req, res, sessionId!, guildId!, sm)
      return sendError(res, 405, 'Method Not Allowed', `${method} não permitido`)
    }

    m = path.match(PLAYER_RE)
    if (m) {
      const [, sessionId, guildId] = m
      if (method === 'GET')    return handleGetPlayer(req, res, sessionId!, guildId!, sm)
      if (method === 'PATCH')  return handleUpdatePlayer(req, res, sessionId!, guildId!, sm, wsm, sources, url)
      if (method === 'DELETE') return handleDeletePlayer(req, res, sessionId!, guildId!, sm, wsm)
      return sendError(res, 405, 'Method Not Allowed', `${method} não permitido`)
    }

    // ── Rotas de plugins ──────────────────────────────────────────────────────

    for (const { manifest, plugin } of getLoadedPlugins()) {
      if (!plugin.routes) continue
      for (const route of plugin.routes) {
        if (route.method !== method || route.path !== path) continue
        log('debug', 'Router', `Plugin "${manifest.name}" tratando ${method} ${path}`)
        try {
          await route.handler(req, res, { sm, wsm })
        } catch (err) {
          log('error', 'Router', `Erro na rota de plugin "${manifest.name}": ${err}`)
          if (!res.headersSent)
            sendError(res, 500, 'Internal Server Error', `Erro no plugin ${manifest.name}`)
        }
        return
      }
    }

    // ── 404 ───────────────────────────────────────────────────────────────────

    sendError(res, 404, 'Not Found', `Nenhuma rota para ${method} ${path}`)
  }
}
