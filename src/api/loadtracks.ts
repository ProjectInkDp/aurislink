// src/api/loadtracks.ts — GET /v4/loadtracks

import type http from 'node:http'
import type { AurisConfig, Source } from '../typings/index.js'
import { log } from '../utils/logger.js'
import { sendJson, sendError } from './helpers.js'

// Matches "scsearch:query", "ytsearch:query", etc.
const PREFIX_RE = /^([a-z]+)search:(.+)$/i

export async function handleLoadTracks(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
  url:  URL,
  sources: Map<string, Source>,
  config:  AurisConfig,
) {
  const identifier = url.searchParams.get('identifier')?.trim()

  if (!identifier) {
    return sendError(res, 400, 'Bad Request', 'Missing identifier query parameter')
  }

  log('info', 'LoadTracks', `identifier: ${identifier}`)

  try {
    // ── Search prefix (e.g. scsearch:lofi) ───────────────────────────────────
    const prefixMatch = identifier.match(PREFIX_RE)
    if (prefixMatch) {
      const prefix = prefixMatch[1]!.toLowerCase() + 'search'
      const query  = prefixMatch[2]!.trim()

      for (const source of sources.values()) {
        if (source.searchPrefixes.includes(prefix)) {
          const result = await source.search(query)
          return sendJson(res, 200, result)
        }
      }

      log('warn', 'LoadTracks', `No source found for prefix: ${prefix}`)
      return sendJson(res, 200, { loadType: 'empty', data: {} })
    }

    // ── Direct URL ────────────────────────────────────────────────────────────
    for (const source of sources.values()) {
      if (source.accepts(identifier)) {
        const result = await source.load(identifier)
        return sendJson(res, 200, result)
      }
    }

    log('warn', 'LoadTracks', `No source accepts: ${identifier}`)
    return sendJson(res, 200, { loadType: 'empty', data: {} })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log('error', 'LoadTracks', `Unhandled error: ${msg}`)
    return sendJson(res, 200, {
      loadType: 'error',
      data: { message: msg, severity: 'fault', cause: 'LoadTracks' },
    })
  }
}
