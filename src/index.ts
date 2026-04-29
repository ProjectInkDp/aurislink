// src/index.ts

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { initLogger, log } from './utils/logger.js'
import { SoundCloudSource } from './sources/soundcloud.js'
import { DeezerSource } from './sources/deezer.js'
import { JioSaavnSource } from './sources/jiosaavn.js'
import { AurisSpotifySource } from './sources/spotify.js'
import { createServer } from './server.js'
import { LyricsManager } from './core/LyricsManager.js'
import TrackCache from './core/TrackCache.js'
import TokenStore from './core/TokenStore.js'
import type { AurisConfig, Source } from './typings/index.js'

const configPath = resolve(process.cwd(), 'config.ts')
const fallback = resolve(process.cwd(), 'config.default.ts')

let config: AurisConfig
try {
  const target = existsSync(configPath) ? configPath : fallback
  const mod = await import(pathToFileURL(target).href) as { default: AurisConfig }
  config = mod.default
} catch (err) {
  console.error('[AurisLink] Failed to load config:', err)
  process.exit(1)
}

initLogger(config.logging)

log('info', 'AurisLink', '─────────────────────────────────────')
log('info', 'AurisLink', '  AurisLink v1.6.0 — starting up…')
log('info', 'AurisLink', '─────────────────────────────────────')

// ─── Cluster guard ──────────────────────────────────────────────────────────
// Full multi-worker cluster is planned; for now the source worker (worker.ts)
// is always a single forked process. Log the resolved state so operators know
// what is active.
if (config.cluster?.enabled) {
  const workers = config.cluster.workers === 0
    ? '(auto — os.cpus().length)'
    : String(config.cluster.workers)
  log('info', 'AurisLink', `Cluster enabled — source workers: ${workers}`)
  log('info', 'AurisLink', `  commandTimeout=${config.cluster.commandTimeoutMs}ms  fastTimeout=${config.cluster.fastCommandTimeoutMs}ms`)
  if (config.cluster.hibernation.enabled) {
    log('info', 'AurisLink', `  Worker hibernation active — idle timeout ${config.cluster.hibernation.timeoutMs / 1000}s`)
  }
} else {
  log('debug', 'AurisLink', 'Cluster disabled — sources run in single source worker process')
}

// ─── Cache + Token store ────────────────────────────────────────────────────
const ctx = { options: config as unknown as Record<string, unknown> }

const trackCache = new TrackCache(ctx)
await trackCache.load()

const tokenStore = new TokenStore(ctx)
await tokenStore.load()

const sources = new Map<string, Source>()

if (config.sources.soundcloud.enabled) {
  const sc = new SoundCloudSource({
    clientId: config.sources.soundcloud.clientId || undefined,
    maxResults: config.maxSearchResults,
    maxPlaylistLength: config.maxPlaylistLength,
  })
  const ok = await sc.setup()
  if (ok) {
    sources.set('soundcloud', sc)
    log('info', 'AurisLink', 'SoundCloud source ready')
  } else {
    log('warn', 'AurisLink', 'SoundCloud source failed to initialise — skipped')
  }
}

if (config.sources.deezer.enabled) {
  const dz = new DeezerSource(config)
  const ok = await dz.setup()
  if (ok) {
    sources.set('deezer', dz)
    log('info', 'AurisLink', 'Deezer source ready')
  } else {
    log('warn', 'AurisLink', 'Deezer source failed to initialise — skipped')
  }
}

if (config.sources.jiosaavn.enabled) {
  const js = new JioSaavnSource(config)
  const ok = await js.setup()
  if (ok) {
    sources.set('jiosaavn', js)
    log('info', 'AurisLink', 'JioSaavn source ready')
  } else {
    log('warn', 'AurisLink', 'JioSaavn source failed to initialise — skipped')
  }
}

if (config.sources.spotify?.enabled) {
  const sp = new AurisSpotifySource(config)
  const ok = await sp.setup()
  if (ok) {
    sources.set('spotify', sp)
    log('info', 'AurisLink', 'Spotify source ready')
  } else {
    log('warn', 'AurisLink', 'Spotify source failed to initialise — skipped')
  }
}

const lyricsManager = new LyricsManager()
await lyricsManager.setup(config, tokenStore)

const { server, monitor } = await createServer(config, sources, lyricsManager, trackCache, tokenStore)

// ─── Graceful shutdown ──────────────────────────────────────────────────────
// Inspired by Lavalink's clean session teardown on process exit.
// Closes the HTTP server and all active WebSocket connections before exiting
// so clients detect the disconnect immediately instead of timing out.

async function shutdown(signal: string) {
  log('info', 'AurisLink', `Received ${signal} — shutting down gracefully…`)

  const forceExitTimer = setTimeout(() => {
    log('warn', 'AurisLink', 'Graceful shutdown timeout — forcing exit')
    process.exit(1)
  }, 5_000)
  forceExitTimer.unref()

  try {
    monitor.stop()
    await Promise.all([
      trackCache.flushNow(),
      tokenStore.persistNow(),
    ])
    await new Promise<void>((resolve, reject) => {
      server.close(err => err ? reject(err) : resolve())
    })
    log('info', 'AurisLink', 'HTTP server closed — goodbye!')
  } catch (err) {
    log('error', 'AurisLink', `Error during shutdown: ${err}`)
  } finally {
    clearTimeout(forceExitTimer)
    process.exit(0)
  }
}

process.once('SIGINT',  () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGHUP',  () => shutdown('SIGHUP'))
