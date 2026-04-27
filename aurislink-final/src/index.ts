// src/index.ts

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { initLogger, log } from './utils/logger.js'
import { SoundCloudSource } from './sources/soundcloud.js'
import { DeezerSource } from './sources/deezer.js'
import { createServer } from './server.js'
import { loadPlugins, setupPlugins, shutdownPlugins, getLoadedPlugins } from './plugins/index.js'
import type { AurisConfig, Source } from './typings/index.js'

const configPath = resolve(process.cwd(), 'config.ts')
const fallback   = resolve(process.cwd(), 'config.default.ts')

let config: AurisConfig
try {
  const target = existsSync(configPath) ? configPath : fallback
  const mod = await import(pathToFileURL(target).href) as { default: AurisConfig }
  config = mod.default
} catch (err) {
  console.error('[AurisLink] Falha ao carregar config:', err)
  process.exit(1)
}

initLogger(config.logging)

log('info', 'AurisLink', '─────────────────────────────────────')
log('info', 'AurisLink', '  AurisLink v1.1.0 — iniciando…')
log('info', 'AurisLink', '─────────────────────────────────────')

// ─── Plugins ──────────────────────────────────────────────────────────────────

await loadPlugins(config)
await setupPlugins(config)

const loadedPlugins = getLoadedPlugins()
if (loadedPlugins.length > 0) {
  log('info', 'AurisLink', `${loadedPlugins.length} plugin(s) ativo(s): ${loadedPlugins.map(p => p.manifest.name).join(', ')}`)
}

// ─── Sources nativas ──────────────────────────────────────────────────────────

const sources = new Map<string, Source>()

if (config.sources.soundcloud.enabled) {
  const sc = new SoundCloudSource({
    clientId:        config.sources.soundcloud.clientId || undefined,
    maxResults:      config.maxSearchResults,
    maxPlaylistLength: config.maxPlaylistLength,
  })
  const ok = await sc.setup()
  if (ok) {
    sources.set('soundcloud', sc)
    log('info', 'AurisLink', 'SoundCloud source pronta')
  } else {
    log('warn', 'AurisLink', 'SoundCloud source falhou na inicialização — ignorada')
  }
}

if (config.sources.deezer.enabled) {
  const dz = new DeezerSource(config)
  const ok = await dz.setup()
  if (ok) {
    sources.set('deezer', dz)
    log('info', 'AurisLink', 'Deezer source pronta')
  } else {
    log('warn', 'AurisLink', 'Deezer source falhou na inicialização — ignorada')
  }
}

// ─── Sources de plugins ───────────────────────────────────────────────────────

for (const { manifest, plugin } of loadedPlugins) {
  if (!plugin.sources) continue
  for (const src of plugin.sources) {
    if (sources.has(src.name)) {
      log('warn', 'AurisLink', `Plugin "${manifest.name}" tentou registrar source "${src.name}" já existente — ignorada`)
      continue
    }
    sources.set(src.name, src)
    log('info', 'AurisLink', `Source "${src.name}" registrada por "${manifest.name}"`)
  }
}

// ─── Servidor ─────────────────────────────────────────────────────────────────

await createServer(config, sources)

// ─── Shutdown gracioso ────────────────────────────────────────────────────────

async function gracefulShutdown(signal: string) {
  log('info', 'AurisLink', `Recebido ${signal} — encerrando…`)
  await shutdownPlugins()
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT',  () => gracefulShutdown('SIGINT'))
