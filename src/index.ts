import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse } from 'yaml'

import { initLogger, log } from './shared/reporter.js'
import { SoundCloudSource } from './providers/soundcloud.js'
import { DeezerSource } from './providers/deezer.js'
import { JioSaavnSource } from './providers/jiosaavn.js'
import { AurisSpotifySource } from './providers/spotify.js'
import { AppleMusicSource } from './providers/applemusic.js'
import { YoutubeSource } from './providers/youtube/youtube.js'
import { YoutubeMusicSource } from './providers/youtube/music.js'
import { createServer } from './server.js'
import ContentManager from './engine/ContentManager.js'
import { PluginManager } from './engine/PluginManager.js'
import TrackCache from './engine/TrackCacheSQL.js'
import Vault from './engine/Vault.js'
import type { AurisConfig, Source } from './typings/index.js'

const configPath = resolve(process.cwd(), 'application.yml')
const fallback = resolve(process.cwd(), 'application.example.yml')

let config: AurisConfig
try {
  const target = existsSync(configPath) ? configPath : fallback
  const file = readFileSync(target, 'utf8')
  config = parse(file) as AurisConfig
} catch (err) {
  console.error('[AurisLink] Failed to load config:', err)
  process.exit(1)
}

initLogger(config.logging)

const pluginManager = new PluginManager(config)
await pluginManager.setup()

log('info', 'AurisLink', '─────────────────────────────────────')
log('info', 'AurisLink', '  AurisLink v1.7.0 — starting up…')
log('info', 'AurisLink', '─────────────────────────────────────')

const ctx = { options: config as unknown as Record<string, unknown> }
const trackCache = new TrackCache(ctx)
await trackCache.load()

const tokenStore = new Vault(config.server.password)

const sources = new Map<string, Source>()

const sc = new SoundCloudSource()
if (await sc.setup()) sources.set('soundcloud', sc)

const dz = new DeezerSource(config)
if (await dz.setup()) sources.set('deezer', dz)

const js = new JioSaavnSource(config)
if (await js.setup()) sources.set('jiosaavn', js)

const sp = new AurisSpotifySource(config)
if (await sp.setup()) sources.set('spotify', sp)

const am = new AppleMusicSource(config)
if (await am.setup()) sources.set('applemusic', am)

if (config.sources.youtube?.enabled) {
  const yt = new YoutubeSource()
  if (await yt.setup()) sources.set('youtube', yt)
  
  const ytm = new YoutubeMusicSource()
  if (await ytm.setup()) sources.set('ytmusic', ytm)
}

const lyricsManager = ContentManager.getInstance()

const { server, monitor } = await createServer(config, sources, lyricsManager, trackCache, tokenStore)

async function shutdown(signal: string) {
  log('info', 'AurisLink', `Received ${signal} — shutting down gracefully…`)
  process.exit(0)
}

process.once('SIGINT',  () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))
