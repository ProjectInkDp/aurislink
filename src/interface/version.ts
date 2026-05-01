// src/api/version.ts
// GET /v4/version — Returns AurisLink runtime version details as JSON.

import type http from 'node:http'
import { sendJson } from './helpers.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Load version from package.json
let pkgVersion = '1.6.1-dev'
try {
  const pkgPath = join(process.cwd(), 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkgVersion = pkg.version
} catch {
  // Fallback
}

const [MAJOR, MINOR, PATCH] = pkgVersion.split('-')[0].split('.').map(v => parseInt(v, 10) || 0)

/**
 * Handles `GET /v4/version` requests.
 */
export function handleVersion(
  _req: http.IncomingMessage,
  res:  http.ServerResponse,
): void {
  const payload = {
    aurislink: pkgVersion,
    semver: {
      major: MAJOR,
      minor: MINOR,
      patch: PATCH,
    },
    node:     process.version,
    platform: process.platform,
    arch:     process.arch,
    builtAt:  new Date().toISOString(),
  }

  sendJson(res, 200, payload)
}
