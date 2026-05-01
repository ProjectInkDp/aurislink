// src/api/health.ts
// GET /v4/health — lightweight liveness check.
// Useful for Docker HEALTHCHECK, load balancers, and uptime monitors.
// Does not require Authorization.

import type http from 'node:http'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Read version once at startup
let _version = 'unknown'
try {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }
  _version = pkg.version
} catch { /* ignore */ }

export function handleHealth(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({
    status:  'ok',
    version: _version,
    uptime:  Math.floor(process.uptime()),
  }))
}
