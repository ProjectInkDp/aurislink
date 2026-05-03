// src/core/TrackCache.ts
// AurisLink encrypted track cache — AES-256-GCM, LRU eviction, disk persistence.

import crypto from 'node:crypto'
import fs     from 'node:fs/promises'
import type { TrackCacheEntry } from '../typings/trackCache.js'
import { log } from '../shared/reporter.js'

// ─── Internal constants ───────────────────────────────────────────────────────

const AURIS_CACHE_SALT = 'aurislink-track-cache'
const CACHE_STORE_VERSION = 1
const DEFAULT_CACHE_PATH = './.auris-cache/tracks.bin'
const DEFAULT_FLUSH_DELAY_MS = 4_000
const DEFAULT_TTL_MS = 1_000 * 60 * 60 * 6   // 6 hours
const DEFAULT_MAX_ENTRIES = 4_000
const DEFAULT_SWEEP_INTERVAL = 60_000                 // 1 minute

// ─── Type helpers ─────────────────────────────────────────────────────────────

type AurisContext = { options: Record<string, unknown> }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const errMsg = (e: unknown) =>
  e instanceof Error ? e.message : String(e ?? 'unknown error')

const errCode = (e: unknown): string | undefined => {
  if (!e || typeof e !== 'object' || !('code' in e)) return undefined
  const c = (e as NodeJS.ErrnoException).code
  return typeof c === 'string' ? c : undefined
}

// ─── TrackCache ───────────────────────────────────────────────────────────────

/**
 * AES-256-GCM encrypted cache for resolved track metadata and stream URLs.
 *
 * Persists to disk with debounced writes and purges expired entries automatically.
 * The encryption key is derived from `server.password` in the AurisLink config.
 *
 * @example
 * ```ts
 * const cache = new TrackCache(aurislink)
 * await cache.load()
 *
 * cache.set('deezer', '123456', resolvedData)
 * const hit = cache.get<ResolvedTrack>('deezer', '123456')
 * ```
 * @public
 */
export default class TrackCache {
  private readonly ctx:        AurisContext
  private readonly secret:     string
  private          key:        Buffer
  private          legacyKey:  Buffer | null
  private readonly cachePath:  string
  private readonly maxEntries: number
  private readonly sweepMs:    number
  private          store:      Map<string, TrackCacheEntry<unknown>>
  private          flushTimer: NodeJS.Timeout | null
  private          sweepTimer: NodeJS.Timeout | null

  constructor(ctx: AurisContext) {
    this.ctx        = ctx
    this.secret     = this._readSecret(ctx.options)
    this.key        = this._deriveKey(this.secret)
    this.legacyKey  = null
    this.cachePath  = DEFAULT_CACHE_PATH
    this.store      = new Map()
    this.flushTimer = null
    this.sweepTimer = null

    const { maxEntries, sweepMs } = this._readOptions(ctx.options)
    this.maxEntries = maxEntries
    this.sweepMs    = sweepMs

    this.sweepTimer = setInterval(() => {
      const expired = this._sweep()
      const evicted = this._evict()
      if (expired > 0 || evicted > 0) this.flush()
    }, this.sweepMs)
    this.sweepTimer.unref?.()
  }

  // ─── Load from disk ─────────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.cachePath)
      if (raw.length < 32) return

      let entries: Record<string, TrackCacheEntry<unknown>>
      let migrated = false

      try {
        entries = this._decode(raw, this.key)
      } catch {
        entries  = this._decode(raw, this._getLegacyKey())
        migrated = true
      }

      this.store = new Map(Object.entries(entries))

      const expired = this._sweep()
      const evicted = this._evict()
      if (expired > 0 || evicted > 0 || migrated) this.flush()

      log('info', 'TrackCache', `Loaded ${this.store.size} cached tracks from disk.`)
    } catch (err) {
      if (errCode(err) !== 'ENOENT')
        log('error', 'TrackCache', `Failed to load cache: ${errMsg(err)}`)
      this.store = new Map()
    }
  }

  // ─── Public access ───────────────────────────────────────────────────────────

  /**
   * Retrieves a track by source + identifier pair.
   * Returns null if not found or expired.
   */
  get<T = unknown>(source: string, identifier: string): T | null {
    const key = `${source}:${identifier}`
    const entry = this.store.get(key)
    if (!entry) return null

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(key)
      this.flush()
      return null
    }

    // LRU: move to tail on access
    this.store.delete(key)
    this.store.set(key, entry)
    return entry.value as T
  }

  /**
   * Stores a resolved track with an optional TTL.
   * @param ttlMs - Time-to-live in ms. Defaults to 6 hours.
   */
  set<T = unknown>(
    source:     string,
    identifier: string,
    value:      T,
    ttlMs:      number = DEFAULT_TTL_MS
  ): void {
    const key = `${source}:${identifier}`
    this.store.delete(key)
    this.store.set(key, {
      value,
      expiresAt: ttlMs > 0 ? Date.now() + ttlMs : null
    })
    this._evict()
    this.flush()
  }

  /** Removes a specific entry. Returns true if it existed. */
  delete(source: string, identifier: string): boolean {
    const removed = this.store.delete(`${source}:${identifier}`)
    if (removed) this.flush()
    return removed
  }

  /** Returns true if the entry exists and has not expired. */
  has(source: string, identifier: string): boolean {
    return this.get(source, identifier) !== null
  }

  /** Total entries held in memory (may include not-yet-swept expired ones). */
  get size(): number {
    return this.store.size
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  /** Schedules a debounced disk write (4 s delay). */
  flush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      void this.flushNow()
    }, DEFAULT_FLUSH_DELAY_MS)
  }

  /** Forces an immediate disk write. */
  async flushNow(): Promise<void> {
    try {
      const plain = JSON.stringify({
        version:   CACHE_STORE_VERSION,
        writtenAt: Date.now(),
        entries:   Object.fromEntries(this.store)
      })

      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
      const payload = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()

      await fs.mkdir('./.auris-cache', { recursive: true })
      await fs.writeFile(this.cachePath, Buffer.concat([iv, tag, payload]))
    } catch (err) {
      log('error', 'TrackCache', `Failed to write cache to disk: ${errMsg(err)}`)
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private _readOptions(options: Record<string, unknown>) {
    const block = isObj((options as { trackCache?: unknown }).trackCache)
      ? (options as { trackCache: Record<string, unknown> }).trackCache
      : null

    const maxEntries = (() => {
      const v = block?.maxEntries
      return typeof v === 'number' && Number.isFinite(v)
        ? Math.max(100, Math.floor(v))
        : DEFAULT_MAX_ENTRIES
    })()

    const sweepMs = (() => {
      const v = block?.sweepIntervalMs
      return typeof v === 'number' && Number.isFinite(v)
        ? Math.max(5_000, Math.floor(v))
        : DEFAULT_SWEEP_INTERVAL
    })()

    return { maxEntries, sweepMs }
  }

  private _readSecret(options: Record<string, unknown>): string {
    const server = isObj((options as { server?: unknown }).server)
      ? (options as { server: Record<string, unknown> }).server
      : null
    const pwd = server && typeof server.password === 'string' ? server.password : null
    if (!pwd) throw new Error('[AurisLink] TrackCache requires server.password in config.')
    return pwd
  }

  private _deriveKey(secret: string): Buffer {
    return crypto
      .createHash('sha256')
      .update(`${AURIS_CACHE_SALT}:${secret}`)
      .digest()
  }

  private _getLegacyKey(): Buffer {
    if (!this.legacyKey)
      this.legacyKey = crypto.scryptSync(this.secret, AURIS_CACHE_SALT, 32)
    return this.legacyKey
  }

  private _decode(data: Buffer, key: Buffer): Record<string, TrackCacheEntry<unknown>> {
    const iv = data.subarray(0, 16)
    const tag = data.subarray(16, 32)
    const encrypted = data.subarray(32)

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)

    const plain = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8')

    return this._normalise(JSON.parse(plain) as unknown)
  }

  private _normalise(raw: unknown): Record<string, TrackCacheEntry<unknown>> {
    if (!isObj(raw)) return {}
    // Supports both versioned payload { entries: {...} } and legacy direct dump
    const source = isObj((raw as { entries?: unknown }).entries)
      ? (raw as { entries: Record<string, unknown> }).entries
      : (raw as Record<string, unknown>)
    const out: Record<string, TrackCacheEntry<unknown>> = {}
    for (const [k, v] of Object.entries(source))
      out[k] = this._normaliseEntry(v)
    return out
  }

  private _normaliseEntry(raw: unknown): TrackCacheEntry<unknown> {
    if (isObj(raw)) {
      const r = raw as Partial<TrackCacheEntry<unknown>> & { value?: unknown }
      return {
        value:     Object.hasOwn(r, 'value') ? r.value : raw,
        expiresAt: typeof r.expiresAt === 'number' ? r.expiresAt : null
      }
    }
    return { value: raw, expiresAt: null }
  }

  /** Purges all expired entries. Returns the number removed. */
  private _sweep(): number {
    const now = Date.now()
    let count = 0
    for (const [k, e] of this.store.entries()) {
      if (e.expiresAt && now > e.expiresAt) {
        this.store.delete(k)
        count++
      }
    }
    return count
  }

  /** Evicts the oldest entries when store exceeds maxEntries. */
  private _evict(): number {
    if (this.store.size <= this.maxEntries) return 0
    let removed = 0
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (!oldest) break
      this.store.delete(oldest)
      removed++
    }
    return removed
  }
}
