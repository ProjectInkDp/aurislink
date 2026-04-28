// src/api/version.ts
// GET /v4/version — Returns AurisLink runtime version details as JSON.
//
// Unlike the plain-text approach used by some other servers, AurisLink returns
// a structured JSON object so clients can inspect individual semver components
// and runtime info without string-parsing.

import type http from 'node:http'
import { sendJson } from './helpers.js'

const AURIS_VERSION = '1.5.0'
const [MAJOR, MINOR, PATCH] = AURIS_VERSION.split('.').map(Number)

const VERSION_PAYLOAD = {
  aurislink:  AURIS_VERSION,
  semver: {
    major: MAJOR,
    minor: MINOR,
    patch: PATCH,
  },
  node:     process.version,
  platform: process.platform,
  arch:     process.arch,
  builtAt:  new Date().toISOString(),
} as const

/**
 * Handles `GET /v4/version` requests.
 *
 * Returns a JSON object with the current AurisLink version string, its broken-
 * down semver components, and Node.js runtime metadata. The response is
 * generated once at module load time so it is zero-allocation per request.
 */
export function handleVersion(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
): void {
  sendJson(res, 200, VERSION_PAYLOAD)
}
