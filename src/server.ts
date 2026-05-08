import http from 'node:http'
import type { AurisConfig, Source } from './typings/index.js'
import { log } from './shared/reporter.js'
import { createRouter } from './interface/router.js'
import { SessionManager } from './engine/SessionManager.js'
import GuardManager from './engine/Guard.js'
import type ContentManager from './engine/ContentManager.js'
import TrackCache from './engine/TrackCacheSQL.js'
import type Vault from './engine/Vault.js'
import { WebSocketManager } from './engine/WebSocketManager.js'
import { ConnectionMonitor } from './engine/ConnectionMonitor.js'
import { RateLimiter } from './shared/rateLimit.js'

export async function createServer(
  config: AurisConfig,
  sources: Map<string, Source>,
  lyricsManager?: ContentManager,
  trackCache?: TrackCache,
  tokenStore?: Vault
) {
  const sm = new SessionManager()
  const wsm = new WebSocketManager(config, sm)

  const dos = config.dosProtection?.enabled ? new GuardManager(config.dosProtection) : null

  // Fix #2: instantiate and pass RateLimiter so rate limiting from application.yml is enforced
  const rateLimiter = config.rateLimit?.enabled ? new RateLimiter(config.rateLimit) : undefined

  const router = createRouter(config, sources, sm, wsm, null, lyricsManager, dos, trackCache, tokenStore, rateLimiter)

  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    router(req, res).catch(err => {
      log('error', 'Server', `Unhandled error: ${err}`)
    })
  }

  const server = http.createServer(handler)
  wsm.mount(server)

  const monitor = new ConnectionMonitor(config.connection)
  monitor.start()

  await new Promise<void>(resolve => {
    server.listen(config.server.port, config.server.host, () => resolve())
  })

  log('info', 'Server', `Listening on http://${config.server.host}:${config.server.port}`)

  return { server, monitor }
}
