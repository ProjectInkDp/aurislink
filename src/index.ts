// src/index.ts — AurisLink entry point

import { existsSync }    from 'node:fs'
import { resolve }       from 'node:path'
import { pathToFileURL } from 'node:url'

import { initLogger, log }   from './utils/logger.js'
import { SoundCloudSource }  from './sources/soundcloud.js'
import { createServer }      from './server.js'
import type { AurisConfig, Source } from './typings/index.js'

// ── Config ────────────────────────────────────────────────────────────────────

const configPath = resolve(process.cwd(), 'config.ts')
const fallback   = resolve(process.cwd(), 'config.default.ts')

let config: AurisConfig
try {
  const target = existsSync(configPath) ? configPath : fallback
  const mod    = await import(pathToFileURL(target).href) as { default: AurisConfig }
  config       = mod.default
} catch (err) {
  console.error('[AurisLink] Failed to load config:', err)
  process.exit(1)
}

initLogger(config.logging)

log('info', 'AurisLink', '─────────────────────────────────────')
log('info', 'AurisLink', '  AurisLink v1.0.0 — starting up…')
log('info', 'AurisLink', '─────────────────────────────────────')

// ── Sources ───────────────────────────────────────────────────────────────────

const sources = new Map<string, Source>()

if (config.sources.soundcloud.enabled) {
  const sc = new SoundCloudSource({
    clientId:          config.sources.soundcloud.clientId || undefined,
    maxResults:        config.maxSearchResults,
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

// ── HTTP Server ───────────────────────────────────────────────────────────────

await createServer(config, sources)
