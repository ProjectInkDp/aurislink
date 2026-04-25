// src/api/tracks.ts
// GET /v4/decodetrack  — decode a single track
// POST /v4/decodetracks — decode multiple tracks
// POST /v4/encodetracks — encode multiple TrackInfo objects (AurisLink extension)

import type http from 'node:http'
import { decodeTrack, encodeTrack } from '../utils/track.js'
import { sendJson, sendError } from './helpers.js'

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// GET /v4/decodetrack?encodedTrack=...
export function handleDecodeTrack(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
  url:  URL,
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
