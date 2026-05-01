import type http from 'node:http'
import { sendJson, sendError } from './helpers.js'
import { decodeTrack, encodeTrack } from '../shared/media.js'

/**
 * GET /v4/decodetrack
 */
export function handleDecodeTrack(req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const encoded = url.searchParams.get('encodedTrack') || url.searchParams.get('track')
  if (!encoded) return sendError(res, 400, 'Bad Request', 'Missing encodedTrack query parameter')

  try {
    const info = decodeTrack(encoded)
    return sendJson(res, 200, { encoded, info })
  } catch (err) {
    return sendError(res, 400, 'Bad Request', 'Invalid encoded track')
  }
}

/**
 * POST /v4/decodetracks
 */
export async function handleDecodeTracks(req: http.IncomingMessage, res: http.ServerResponse) {
  return sendError(res, 501, 'Not Implemented', 'Batch decoding not yet restored')
}

/**
 * POST /v4/encodetrack
 */
export async function handleEncodeTrack(req: http.IncomingMessage, res: http.ServerResponse) {
  return sendError(res, 501, 'Not Implemented', 'Encoding not yet restored')
}

/**
 * POST /v4/encodetracks
 */
export async function handleEncodeTracks(req: http.IncomingMessage, res: http.ServerResponse) {
  return sendError(res, 501, 'Not Implemented', 'Batch encoding not yet restored')
}
