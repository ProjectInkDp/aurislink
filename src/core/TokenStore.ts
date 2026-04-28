// src/core/TokenStore.ts
// AurisLink encrypted token store — AES-256-GCM, atomic writes, TTL support.

import crypto from 'node:crypto'
import fs     from 'node:fs/promises'
import type {
  TokenEntry,
  TokenStorePayload,
  TokenStoreStats
} from '../typings/tokenStore.js'
import { log } from '../utils/logger.js'

// ─── Internal constants ───────────────────────────────────────────────────────

const AURIS_TOKEN_SALT       = 'aurislink-token-store'
const TOKEN_STORE_VERSION    = 1
const DEFAULT_STORE_PATH     = './.auris-cache/tokens.bin'
const DEFAULT_WRITE_DELAY_MS = 800
const DEFAULT_SWEEP_INTERVAL = 60_000  // 1 minute

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

// ─── TokenStore ───────────────────────────────────────────────────────────────

/**
 * AES-256-GCM encrypted store for external service tokens
 * (Spotify, Deezer, SoundCloud, etc.).
 *
 * Tokens are persisted to disk via atomic rename and automatically removed
 * when they expire. Writes are debounced to avoid hammering the filesystem.
 *
 * @example
 * ```ts
 * const tokens = new TokenStore(aurislink)
 * await tokens.load()
 *
 * tokens.set('spotify_access', accessToken, expiresInMs)
 * const token = tokens.get<string>('spotify_access')
 * ```
 * @public
 */
export default class TokenStore {
  private readonly ctx:         AurisContext
  private readonly secret:      string
  private          key:         Buffer
  private          legacyKey:   Buffer | null
  private readonly storePath:   string
  private readonly tmpPath:     string
  private readonly writeDelay:  number
  private          store:       Map<string, TokenEntry<unknown>>
  private          writeTimer:  NodeJS.Timeout | null
  private          sweepTimer:  NodeJS.Timeout | null
  private          writeTask:   Promise<void> | null
  private          writeQueued: boolean
  private          lastLoad:    number | null
  private          lastWrite:   number | null

  constructor(ctx: AurisContext) {
    this.ctx         = ctx
    this.secret      = this._readSecret(ctx.options)
    this.key         = this._deriveKey(this.secret)
    this.legacyKey   = null
    this.storePath   = DEFAULT_STORE_PATH
    this.tmpPath     = `${DEFAULT_STORE_PATH}.tmp`
    this.writeDelay  = DEFAULT_WRITE_DELAY_MS
    this.store       = new Map()
    this.writeTimer  = null
    this.sweepTimer  = null
    this.writeTask   = null
    this.writeQueued = false
    this.lastLoad    = null
    this.lastWrite   = null

    this.sweepTimer = setInterval(() => {
      const purged = this._sweep()
      if (purged > 0) this.persist()
    }, DEFAULT_SWEEP_INTERVAL)
    this.sweepTimer.unref?.()
  }

  // ─── Load from disk ─────────────────────────────────────────────────────────

  async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.storePath)
      if (raw.length < 32) return

      let payload: TokenStorePayload
      let migrated = false

      try {
        payload = this._decode(raw, this.key)
      } catch {
        payload  = this._decode(raw, this._getLegacyKey())
        migrated = true
      }

      this.store = new Map(Object.entries(payload.entries))
      const purged = this._sweep()
      if (purged > 0 || migrated) this.persist()

      this.lastLoad = Date.now()
      log('info', 'TokenStore', `Loaded ${this.store.size} tokens from disk.`)
    } catch (err) {
      if (errCode(err) !== 'ENOENT')
        log('error', 'TokenStore', `Failed to load tokens: ${errMsg(err)}`)
      this.store = new Map()
    }
  }

  // ─── Public access ───────────────────────────────────────────────────────────

  /**
   * Retrieves a token by identifier.
   * Returns null if missing or expired.
   */
  get<T = unknown>(id: string): T | null {
    const entry = this._validEntry(id)
    return entry ? (entry.value as T) : null
  }

  /**
   * Retrieves the full entry with time metadata.
   */
  getEntry<T = unknown>(id: string): TokenEntry<T> | null {
    const entry = this._validEntry(id)
    return entry ? { ...(entry as TokenEntry<T>) } : null
  }

  /**
   * Stores a token with an optional TTL.
   * @param ttlMs - Time-to-live in ms. 0 = no expiry.
   */
  set<T = unknown>(id: string, value: T, ttlMs = 0): void {
    const now     = Date.now()
    const current = this.store.get(id)
    this.store.set(id, {
      value,
      createdAt:   current?.createdAt ?? now,
      refreshedAt: now,
      expiresAt:   ttlMs > 0 ? now + ttlMs : null
    })
    this.persist()
  }

  /** Removes a token. Returns true if it existed. */
  delete(id: string): boolean {
    const existed = this.store.delete(id)
    if (existed) this.persist()
    return existed
  }

  /** Returns true if the token exists and has not expired. */
  has(id: string): boolean {
    return this._validEntry(id) !== null
  }

  /** Clears all stored tokens. */
  clear(): void {
    if (this.store.size === 0) return
    this.store.clear()
    this.persist()
  }

  /** Runtime statistics for the store. */
  stats(): TokenStoreStats {
    const now = Date.now()
    return {
      total:         this.store.size,
      expired:       this._countExpired(now),
      lastLoadedAt:  this.lastLoad  ?? undefined,
      lastWrittenAt: this.lastWrite ?? undefined
    }
  }

  // ─── Persistence ────────────────────────────────────────────────────────────

  /** Schedules a debounced disk write. */
  persist(): void {
    if (this.writeTimer) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null
      void this._flush()
    }, this.writeDelay)
  }

  /** Forces an immediate disk write, waiting for any in-flight save. */
  async persistNow(): Promise<void> {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer)
      this.writeTimer = null
    }
    try {
      this._sweep()
      await this._flush()
      log('debug', 'TokenStore', 'Force-flushed token store to disk.')
    } catch (err) {
      log('error', 'TokenStore', `Failed to force-flush: ${errMsg(err)}`)
    }
  }

  // ─── Private ─────────────────────────────────────────────────────────────────

  private _readSecret(options: Record<string, unknown>): string {
    const server = isObj((options as { server?: unknown }).server)
      ? (options as { server: Record<string, unknown> }).server
      : null
    const pwd = server && typeof server.password === 'string' ? server.password : null
    if (!pwd) throw new Error('[AurisLink] TokenStore requires server.password in config.')
    return pwd
  }

  private _deriveKey(secret: string): Buffer {
    return crypto
      .createHash('sha256')
      .update(`${AURIS_TOKEN_SALT}:${secret}`)
      .digest()
  }

  private _getLegacyKey(): Buffer {
    if (!this.legacyKey)
      this.legacyKey = crypto.scryptSync(this.secret, AURIS_TOKEN_SALT, 32)
    return this.legacyKey
  }

  private _validEntry(id: string): TokenEntry<unknown> | null {
    const entry = this.store.get(id)
    if (!entry) return null
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.store.delete(id)
      this.persist()
      return null
    }
    return entry
  }

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

  private _countExpired(now: number): number {
    let c = 0
    for (const e of this.store.values())
      if (e.expiresAt && now > e.expiresAt) c++
    return c
  }

  // Atomic write: write to .tmp then rename
  private async _flush(): Promise<void> {
    if (this.writeTask) {
      this.writeQueued = true
      await this.writeTask
      if (this.writeQueued) {
        this.writeQueued = false
        await this._flush()
      }
      return
    }

    const payload = this._buildPayload()
    this.writeTask = this._writeToDisk(payload)
    try {
      await this.writeTask
    } finally {
      this.writeTask = null
    }

    if (this.writeQueued) {
      this.writeQueued = false
      await this._flush()
    }
  }

  private async _writeToDisk(payload: TokenStorePayload): Promise<void> {
    const plain  = JSON.stringify(payload)
    const iv     = crypto.randomBytes(16)
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv)
    const body   = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
    const tag    = cipher.getAuthTag()
    const out    = Buffer.concat([iv, tag, body])

    await fs.mkdir('./.auris-cache', { recursive: true })
    try {
      await fs.writeFile(this.tmpPath, out)
      await fs.rename(this.tmpPath, this.storePath)
    } catch {
      // Fallback for filesystems that do not support atomic rename
      await fs.writeFile(this.storePath, out)
      try { await fs.unlink(this.tmpPath) } catch { /* ignore */ }
    }

    this.lastWrite = payload.writtenAt
  }

  private _buildPayload(): TokenStorePayload {
    return {
      version:   TOKEN_STORE_VERSION,
      writtenAt: Date.now(),
      entries:   Object.fromEntries(this.store)
    }
  }

  private _decode(data: Buffer, key: Buffer): TokenStorePayload {
    const iv        = data.subarray(0, 16)
    const tag       = data.subarray(16, 32)
    const encrypted = data.subarray(32)

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)

    const plain = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]).toString('utf8')

    return this._normalisePayload(JSON.parse(plain) as unknown)
  }

  private _normalisePayload(raw: unknown): TokenStorePayload {
    const now = Date.now()
    if (isObj(raw)) {
      const r = raw as Partial<TokenStorePayload>
      if (isObj(r.entries)) {
        return {
          version:   TOKEN_STORE_VERSION,
          writtenAt: typeof r.writtenAt === 'number' ? r.writtenAt : now,
          entries:   this._normaliseEntries(r.entries, now)
        }
      }
      return {
        version:   TOKEN_STORE_VERSION,
        writtenAt: now,
        entries:   this._normaliseEntries(raw as Record<string, unknown>, now)
      }
    }
    return { version: TOKEN_STORE_VERSION, writtenAt: now, entries: {} }
  }

  private _normaliseEntries(
    raw: Record<string, unknown>,
    fallback: number
  ): Record<string, TokenEntry<unknown>> {
    const out: Record<string, TokenEntry<unknown>> = {}
    for (const [k, v] of Object.entries(raw))
      out[k] = this._normaliseEntry(v, fallback)
    return out
  }

  private _normaliseEntry(raw: unknown, fallback: number): TokenEntry<unknown> {
    if (isObj(raw)) {
      const r = raw as Partial<TokenEntry<unknown>> & { value?: unknown }
      return {
        value:       Object.hasOwn(r, 'value') ? r.value : raw,
        createdAt:   typeof r.createdAt   === 'number' ? r.createdAt   : fallback,
        refreshedAt: typeof r.refreshedAt === 'number' ? r.refreshedAt : fallback,
        expiresAt:   typeof r.expiresAt   === 'number' && r.expiresAt > 0 ? r.expiresAt : null
      }
    }
    return { value: raw, createdAt: fallback, refreshedAt: fallback, expiresAt: null }
  }
}
