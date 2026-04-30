// src/server.ts
// AurisLink HTTP + WebSocket server — Lavalink v4 compatible.

import http from 'node:http'
import https from 'node:https'
import http2 from 'node:http2'
import fs from 'node:fs'
import type { AurisConfig, Source } from './typings/index.js'
import { log } from './utils/logger.js'
import { createRouter } from './api/router.js'
import { SessionManager } from './core/SessionManager.js'
import DosProtectionManager from './core/DosProtection.js'
import type { LyricsManager } from './core/LyricsManager.js'
import TrackCache from './core/TrackCacheSQL.js'
import type TokenStore from './core/TokenStore.js'
import { WebSocketManager } from './core/WebSocketManager.js'
import { RoutePlanner } from './core/RoutePlanner.js'
import { ConnectionMonitor } from './core/ConnectionMonitor.js'
import { RateLimiter } from './utils/rateLimit.js'

export async function createServer(
  config:       AurisConfig,
  sources:      Map<string, Source>,
  lyricsManager?: LyricsManager,
  trackCache?:  TrackCache,
  tokenStore?:  TokenStore
) {
  const sm  = new SessionManager()
  const wsm = new WebSocketManager(config, sm)

  // Boot route planner if configured
  const rp = config.routePlanner?.enabled && config.routePlanner.ipPool.length > 0
    ? new RoutePlanner({
        ipPool:     config.routePlanner.ipPool,
        strategy:   config.routePlanner.strategy,
        cooldownMs: config.routePlanner.cooldownMs,
      })
    : null

  if (rp) log('info', 'RoutePlanner', `Active — ${rp.ipPool.length} IP(s) — strategy: ${rp.strategy}`)

  const dos = config.dosProtection?.enabled !== false
    ? new DosProtectionManager({ options: { dosProtection: config.dosProtection as any } })
    : null

  if (dos) log('info', 'DosProtection', 'Active')

  // Boot rate limiter — enabled by default, opt-out via config.rateLimit.enabled = false
  const rateLimiter = config.rateLimit?.enabled !== false
    ? new RateLimiter(config.rateLimit)
    : null

  const router = createRouter(config, sources, sm, wsm, rp, lyricsManager, dos, trackCache, tokenStore, rateLimiter ?? undefined)

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    router(req, res).catch(err => {
      log('error', 'Server', `Unhandled error: ${err}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 500, error: 'Internal Server Error', message: String(err) }))
      }
    })
  }

  let server: http.Server | https.Server | http2.Http2SecureServer

  const http2Enabled = config.server.http2?.enabled ?? false
  const tlsEnabled   = config.server.tls.enabled

  if (http2Enabled && tlsEnabled) {
    // HTTP/2 requires TLS in browsers, but Node supports h2c too.
    // We use the compatibility layer so existing http.IncomingMessage handlers still work.
    server = http2.createSecureServer(
      {
        cert:          fs.readFileSync(config.server.tls.cert),
        key:           fs.readFileSync(config.server.tls.key),
        allowHTTP1:    true,  // graceful fallback for HTTP/1.1 clients (e.g. wscat)
      },
      handler as any,
    ) as unknown as http2.Http2SecureServer
    log('info', 'Server', 'HTTP/2 + TLS enabled (HTTP/1.1 fallback active)')
  } else if (tlsEnabled) {
    server = https.createServer(
      {
        cert: fs.readFileSync(config.server.tls.cert),
        key:  fs.readFileSync(config.server.tls.key),
      },
      handler,
    )
    log('info', 'Server', 'HTTPS / TLS enabled')
  } else {
    server = http.createServer(handler)
  }

  // Attach WebSocket
  wsm.attach(server as http.Server)

  // Stats broadcast
  const statsMs = config.statsInterval ?? 60_000
  setInterval(() => wsm.broadcastStats(), statsMs).unref()

  // TrackStuck watchdog
  const stuckMs = config.trackStuckThresholdMs ?? 10_000
  wsm.startStuckWatchdog(stuckMs, stuckMs)

  // Zombie player cleanup
  const zombieMs = config.zombieThresholdMs ?? 60_000
  wsm.startZombieCleanup(zombieMs)

  // Connection health monitor
  const monitor = new ConnectionMonitor(config.connection)
  monitor.start()

  await new Promise<void>(resolve => {
    server.listen(config.server.port, config.server.host, () => resolve())
  })

  const proto = http2Enabled && tlsEnabled ? 'https (h2)' : tlsEnabled ? 'https' : 'http'
  log('info', 'Server', `Listening on ${proto}://${config.server.host}:${config.server.port}`)

  return { server, monitor }
}
