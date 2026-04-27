// src/server.ts
// AurisLink HTTP + WebSocket server — Lavalink v4 compatible.

import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import type { AurisConfig, Source } from './typings/index.js'
import { log } from './utils/logger.js'
import { createRouter } from './api/router.js'
import { SessionManager } from './core/SessionManager.js'
import { WebSocketManager } from './core/WebSocketManager.js'
import { RoutePlanner } from './core/RoutePlanner.js'

export async function createServer(config: AurisConfig, sources: Map<string, Source>) {
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

  const router = createRouter(config, sources, sm, wsm, rp)

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    router(req, res).catch(err => {
      log('error', 'Server', `Unhandled error: ${err}`)
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ status: 500, error: 'Internal Server Error', message: String(err) }))
      }
    })
  }

  let server: http.Server | https.Server

  if (config.server.tls.enabled) {
    server = https.createServer({
      cert: fs.readFileSync(config.server.tls.cert),
      key:  fs.readFileSync(config.server.tls.key),
    }, handler)
  } else {
    server = http.createServer(handler)
  }

  // Attach WebSocket
  wsm.attach(server)

  // Stats broadcast
  const statsMs = config.statsInterval ?? 60_000
  setInterval(() => wsm.broadcastStats(), statsMs).unref()

  // TrackStuck watchdog
  const stuckMs = config.trackStuckThresholdMs ?? 10_000
  wsm.startStuckWatchdog(stuckMs, stuckMs)

  // Zombie player cleanup
  const zombieMs = config.zombieThresholdMs ?? 60_000
  wsm.startZombieCleanup(zombieMs)

  await new Promise<void>(resolve => {
    server.listen(config.server.port, config.server.host, () => resolve())
  })

  const proto = config.server.tls.enabled ? 'https' : 'http'
  log('info', 'Server', `Listening on ${proto}://${config.server.host}:${config.server.port}`)

  return server
}
