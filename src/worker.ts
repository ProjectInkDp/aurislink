// src/worker.ts
// AurisLink lightweight worker — runs source operations (search, load, lyrics)
// in a dedicated process so heavy HTTP I/O never blocks the main audio loop.
//
// Architecture (simple, no cluster module required):
//   Main process  →  spawns one WorkerProcess via child_process.fork()
//   WorkerProcess →  handles source.load() / source.search() calls
//   IPC channel   →  JSON messages { id, type, payload } both directions
//
// This is intentionally minimal: one worker, one IPC channel.
// No dynamic scaling — AurisLink is designed for single-node / Termux use.

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fork, type ChildProcess } from 'node:child_process'
import { log } from './utils/logger.js'
import type { AurisConfig, Source } from './typings/index.js'

// ─── Message types ───────────────────────────────────────────────────────────

export type WorkerRequest =
  | { id: string; type: 'search';  source: string; query: string }
  | { id: string; type: 'load';    source: string; url: string }

export type WorkerResponse =
  | { id: string; ok: true;  data: unknown }
  | { id: string; ok: false; error: string }

// ─── WorkerClient (used by main process) ─────────────────────────────────────

export class WorkerClient {
  private child: ChildProcess | null = null
  private pending = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private counter = 0

  constructor(private readonly workerPath: string) {}

  start(): void {
    this.child = fork(this.workerPath, [], {
      execArgv: ['--import', 'tsx'],
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    })

    this.child.on('message', (msg: WorkerResponse) => {
      const pending = this.pending.get(msg.id)
      if (!pending) return
      this.pending.delete(msg.id)
      if (msg.ok) pending.resolve(msg.data)
      else pending.reject(new Error(msg.error))
    })

    this.child.on('exit', (code, signal) => {
      log('warn', 'Worker', `Worker exited (code=${code} signal=${signal}) — restarting…`)
      // Reject all in-flight requests
      for (const [, p] of this.pending) p.reject(new Error('Worker crashed'))
      this.pending.clear()
      // Restart after a short delay
      setTimeout(() => this.start(), 1_000)
    })

    log('info', 'Worker', `Source worker started (pid=${this.child.pid})`)
  }

  send(req: Omit<WorkerRequest, 'id'>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error('Worker not running'))
      const id = String(++this.counter)
      this.pending.set(id, { resolve, reject })
      this.child.send({ ...req, id } satisfies WorkerRequest)
      // Timeout after 15 s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id)
          reject(new Error(`Worker timeout for request ${id}`))
        }
      }, 15_000)
    })
  }

  stop(): void {
    this.child?.kill('SIGTERM')
    this.child = null
  }
}

// ─── WorkerProcess (runs inside the forked child) ────────────────────────────

export async function runWorkerProcess(): Promise<void> {
  // Load config + sources (same as main, but in a separate process)
  const configPath = resolve(process.cwd(), 'config.ts')
  const fallback   = resolve(process.cwd(), 'config.default.ts')

  let config: AurisConfig
  try {
    const target = existsSync(configPath) ? configPath : fallback
    const mod = await import(pathToFileURL(target).href) as { default: AurisConfig }
    config = mod.default
  } catch (err) {
    process.send?.({ id: '__boot__', ok: false, error: `Config load failed: ${err}` })
    process.exit(1)
  }

  // Lazy-load sources
  const { SoundCloudSource } = await import('./sources/soundcloud.js')
  const { DeezerSource }     = await import('./sources/deezer.js')
  const { JioSaavnSource }   = await import('./sources/jiosaavn.js')
  const { SpotifySource }    = await import('./sources/spotify.js')

  const sources = new Map<string, Source>()

  if (config.sources.soundcloud.enabled) {
    const sc = new SoundCloudSource({ clientId: config.sources.soundcloud.clientId || undefined, maxResults: config.maxSearchResults, maxPlaylistLength: config.maxPlaylistLength })
    if (await sc.setup()) sources.set('soundcloud', sc)
  }
  if (config.sources.deezer.enabled) {
    const dz = new DeezerSource(config)
    if (await dz.setup()) sources.set('deezer', dz)
  }
  if (config.sources.jiosaavn.enabled) {
    const js = new JioSaavnSource(config)
    if (await js.setup()) sources.set('jiosaavn', js)
  }
  if (config.sources.spotify?.enabled) {
    const sp = new SpotifySource(config)
    if (await sp.setup()) sources.set('spotify', sp)
  }

  process.on('message', async (msg: WorkerRequest) => {
    const { id, type } = msg
    const src = sources.get(msg.source)
    if (!src) {
      process.send?.({ id, ok: false, error: `Unknown source: ${msg.source}` } satisfies WorkerResponse)
      return
    }
    try {
      let data: unknown
      if (type === 'search') data = await src.search(msg.query)
      else                   data = await src.load(msg.url)
      process.send?.({ id, ok: true, data } satisfies WorkerResponse)
    } catch (err) {
      process.send?.({ id, ok: false, error: String(err) } satisfies WorkerResponse)
    }
  })

  log('info', 'Worker', 'Source worker ready')
}

// ─── Entry: if invoked directly as child process ─────────────────────────────
if (process.send !== undefined) {
  // We are the forked child
  runWorkerProcess().catch(err => {
    console.error('[Worker] Fatal:', err)
    process.exit(1)
  })
}
