// src/api/tracks.ts
// GET  /v4/decodetrack   — decode a single encoded track
// POST /v4/decodetracks  — decode multiple encoded tracks (batch)
// POST /v4/encodetrack   — encode a TrackInfo object into a Lavalink v4 string
// POST /v4/encodetracks  — encode multiple TrackInfo objects (batch)

import type http from 'node:http'
import { decodeTrack, encodeTrack } from '../utils/track.js'
import { sendJson, sendError } from './helpers.js'
import type { TrackInfo } from '../typings/index.js'

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// GET /v4/decodetrack?encodedTrack=...
export function handleDecodeTrack(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
) {
  const encoded = url.searchParams.get('encodedTrack')
  if (!encoded) return sendError(res, 400, 'Bad Request', 'Missing encodedTrack query parameter')

  try {
    const info = decodeTrack(encoded)
    sendJson(res, 200, { encoded, info, pluginInfo: {} })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendError(res, 400, 'Bad Request', `Failed to decode track: ${msg}`)
  }
}

// POST /v4/decodetracks — body: string[]
export async function handleDecodeTracks(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let body: string[]
  try {
    const raw = await readBody(req)
    body = JSON.parse(raw)
    if (!Array.isArray(body)) throw new Error('Expected array')
  } catch {
    return sendError(res, 400, 'Bad Request', 'Body must be a JSON array of encoded track strings')
  }

  const result = body.map(encoded => {
    try {
      const info = decodeTrack(encoded)
      return { encoded, info, pluginInfo: {} }
    } catch {
      return null
    }
  }).filter(Boolean)

  sendJson(res, 200, result)
}

// POST /v4/encodetrack — body: TrackInfo
export async function handleEncodeTrack(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let info: TrackInfo
  try {
    const raw = await readBody(req)
    info = JSON.parse(raw) as TrackInfo
    if (!info || typeof info.title !== 'string') throw new Error('Invalid TrackInfo')
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return sendError(res, 400, 'Bad Request', `Invalid body: ${msg}`)
  }

  try {
    const encoded = encodeTrack(info)
    sendJson(res, 200, { encoded, info, pluginInfo: {} })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    sendError(res, 400, 'Bad Request', `Failed to encode track: ${msg}`)
  }
}

// POST /v4/encodetracks — body: TrackInfo[]
export async function handleEncodeTracks(
  req: http.IncomingMessage,
  res: http.ServerResponse,
) {
  let body: TrackInfo[]
  try {
    const raw = await readBody(req)
    body = JSON.parse(raw)
    if (!Array.isArray(body)) throw new Error('Expected array')
  } catch {
    return sendError(res, 400, 'Bad Request', 'Body must be a JSON array of TrackInfo objects')
  }

  const result = body.map(info => {
    try {
      const encoded = encodeTrack(info)
      return { encoded, info, pluginInfo: {} }
    } catch {
      return null
    }
  }).filter(Boolean)

  sendJson(res, 200, result)
}
