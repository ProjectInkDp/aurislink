// src/core/TrackCacheSQL.ts
// SQLite-backed track cache with statistics, blacklist, and automatic cleanup.
// Replaces the binary file-based cache with a proper relational database.

import Database from 'better-sqlite3'
import path from 'node:path'
import type { TrackCacheEntry } from '../typings/trackCache.js'
import { log } from '../shared/reporter.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_DB_PATH = './.auris-cache/tracks.db'
const DEFAULT_TTL_MS = 1_000 * 60 * 60 * 6 // 6 hours
const DEFAULT_MAX_ENTRIES = 4_000
const DEFAULT_SWEEP_INTERVAL = 60_000 // 1 minute

// ─── Type helpers ─────────────────────────────────────────────────────────────

type AurisContext = { options: Record<string, unknown> }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// ─── TrackCacheSQL ────────────────────────────────────────────────────────────

/**
 * SQLite-backed cache for resolved track metadata with statistics and blacklist.
 *
 * Stores tracks in a relational database with automatic expiry cleanup,
 * LRU eviction, hit/miss tracking, and optional blacklist support.
 *
 * @example
 * ```ts
 * const cache = new TrackCacheSQL(aurislink)
 * await cache.load()
 *
 * cache.set('deezer', '123456', resolvedData)
 * const hit = cache.get<ResolvedTrack>('deezer', '123456')
 * const stats = cache.getStats()
 * ```
 * @public
 */
export default class TrackCacheSQL {
  private readonly ctx: AurisContext
  private readonly dbPath: string
  private readonly maxEntries: number
  private readonly sweepMs: number
  private db: Database.Database | null
  private sweepTimer: NodeJS.Timeout | null
  private stats: {
    hits: number
    misses: number
    sets: number
    deletes: number
  }

  constructor(ctx: AurisContext) {
    this.ctx = ctx
    this.dbPath = DEFAULT_DB_PATH
    this.maxEntries = this._readMaxEntries(ctx.options)
    this.sweepMs = this._readSweepInterval(ctx.options)
    this.db = null
    this.sweepTimer = null
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0 }
  }

  // ─── Initialization ───────────────────────────────────────────────────────────

  /**
   * Opens the SQLite database and creates tables if needed.
   * Must be called before any get/set operations.
   */
  async load(): Promise<void> {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath)
      const fs = await import('node:fs/promises')
      await fs.mkdir(dir, { recursive: true })

      // Open database
      this.db = new Database(this.dbPath)
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = NORMAL')

      // Create tables
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS tracks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          identifier TEXT NOT NULL,
          value TEXT NOT NULL,
          expires_at INTEGER,
          created_at INTEGER NOT NULL,
          accessed_at INTEGER NOT NULL,
          access_count INTEGER DEFAULT 1,
          UNIQUE(source, identifier)
        );

        CREATE INDEX IF NOT EXISTS idx_expires_at ON tracks(expires_at);
        CREATE INDEX IF NOT EXISTS idx_accessed_at ON tracks(accessed_at);
        CREATE INDEX IF NOT EXISTS idx_source_id ON tracks(source, identifier);

        CREATE TABLE IF NOT EXISTS blacklist (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          source TEXT NOT NULL,
          identifier TEXT NOT NULL,
          reason TEXT,
          created_at INTEGER NOT NULL,
          UNIQUE(source, identifier)
        );

        CREATE INDEX IF NOT EXISTS idx_blacklist_source_id ON blacklist(source, identifier);
      `)

      // Start cleanup timer
      this.sweepTimer = setInterval(() => this._sweep(), this.sweepMs)
      this.sweepTimer.unref?.()

      // Initial cleanup
      this._sweep()

      const count = this._getTrackCount()
      log('info', 'TrackCacheSQL', `Loaded with ${count} cached tracks from SQLite`)
    } catch (err) {
      log('error', 'TrackCacheSQL', `Failed to load: ${err instanceof Error ? err.message : String(err)}`)
      throw err
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────────

  /**
   * Retrieves a track by source + identifier.
   * Returns null if not found, expired, or blacklisted.
   * Updates access timestamp for LRU tracking.
   */
  get<T = unknown>(source: string, identifier: string): T | null {
    if (!this.db) return null

    // Check blacklist first
    if (this._isBlacklisted(source, identifier)) {
      this.stats.misses++
      return null
    }

    try {
      const stmt = this.db.prepare(`
        SELECT value, expires_at FROM tracks
        WHERE source = ? AND identifier = ?
      `)
      const row = stmt.get(source, identifier) as { value: string; expires_at: number | null } | undefined

      if (!row) {
        this.stats.misses++
        return null
      }

      // Check expiry
      if (row.expires_at && Date.now() > row.expires_at) {
        this._deleteTrack(source, identifier)
        this.stats.misses++
        return null
      }

      // Update access time for LRU
      const updateStmt = this.db.prepare(`
        UPDATE tracks
        SET accessed_at = ?, access_count = access_count + 1
        WHERE source = ? AND identifier = ?
      `)
      updateStmt.run(Date.now(), source, identifier)

      this.stats.hits++
      return JSON.parse(row.value) as T
    } catch (err) {
      log('warn', 'TrackCacheSQL', `Failed to get track: ${err instanceof Error ? err.message : String(err)}`)
      this.stats.misses++
      return null
    }
  }

  /**
   * Stores a resolved track with optional TTL.
   * @param ttlMs - Time-to-live in ms. Defaults to 6 hours.
   */
  set<T = unknown>(
    source: string,
    identifier: string,
    value: T,
    ttlMs: number = DEFAULT_TTL_MS
  ): void {
    if (!this.db) return

    try {
      const now = Date.now()
      const expiresAt = ttlMs > 0 ? now + ttlMs : null
      const valueStr = JSON.stringify(value)

      const stmt = this.db.prepare(`
        INSERT INTO tracks (source, identifier, value, expires_at, created_at, accessed_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(source, identifier) DO UPDATE SET
          value = excluded.value,
          expires_at = excluded.expires_at,
          accessed_at = excluded.accessed_at,
          access_count = 1
      `)

      stmt.run(source, identifier, valueStr, expiresAt, now, now)
      this.stats.sets++
      this._evictIfNeeded()
    } catch (err) {
      log('warn', 'TrackCacheSQL', `Failed to set track: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Removes a specific entry. Returns true if it existed.
   */
  delete(source: string, identifier: string): boolean {
    if (!this.db) return false
    const deleted = this._deleteTrack(source, identifier)
    if (deleted) this.stats.deletes++
    return deleted
  }

  /**
   * Returns true if the entry exists and has not expired.
   */
  has(source: string, identifier: string): boolean {
    return this.get(source, identifier) !== null
  }

  /**
   * Returns the total number of non-expired tracks in the cache.
   */
  get size(): number {
    if (!this.db) return 0
    return this._getTrackCount()
  }

  /**
   * Returns cache statistics (hits, misses, sets, deletes).
   */
  getStats() {
    return {
      ...this.stats,
      hitRate: this.stats.hits + this.stats.misses > 0
        ? (this.stats.hits / (this.stats.hits + this.stats.misses) * 100).toFixed(2) + '%'
        : 'N/A',
      size: this.size,
    }
  }

  /**
   * Adds a track to the blacklist (prevents future retrieval).
   */
  blacklist(source: string, identifier: string, reason?: string): void {
    if (!this.db) return

    try {
      const stmt = this.db.prepare(`
        INSERT OR IGNORE INTO blacklist (source, identifier, reason, created_at)
        VALUES (?, ?, ?, ?)
      `)
      stmt.run(source, identifier, reason || null, Date.now())
      this._deleteTrack(source, identifier)
    } catch (err) {
      log('warn', 'TrackCacheSQL', `Failed to blacklist track: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Removes a track from the blacklist.
   */
  unblacklist(source: string, identifier: string): boolean {
    if (!this.db) return false

    try {
      const stmt = this.db.prepare('DELETE FROM blacklist WHERE source = ? AND identifier = ?')
      const result = stmt.run(source, identifier)
      return (result.changes ?? 0) > 0
    } catch (err) {
      log('warn', 'TrackCacheSQL', `Failed to unblacklist track: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /**
   * Closes the database connection.
   */
  close(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    if (this.db) {
      try {
        this.db.close()
      } catch (err) {
        log('warn', 'TrackCacheSQL', `Failed to close database: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    this.db = null
  }

  // ─── Private helpers ───────────────────────────────────────────────────────────

  private _readMaxEntries(options: Record<string, unknown>): number {
    const block = isObj((options as { trackCache?: unknown }).trackCache)
      ? (options as { trackCache: Record<string, unknown> }).trackCache
      : null

    const v = block?.maxEntries
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.max(100, Math.floor(v))
      : DEFAULT_MAX_ENTRIES
  }

  private _readSweepInterval(options: Record<string, unknown>): number {
    const block = isObj((options as { trackCache?: unknown }).trackCache)
      ? (options as { trackCache: Record<string, unknown> }).trackCache
      : null

    const v = block?.sweepIntervalMs
    return typeof v === 'number' && Number.isFinite(v)
      ? Math.max(5_000, Math.floor(v))
      : DEFAULT_SWEEP_INTERVAL
  }

  private _getTrackCount(): number {
    if (!this.db) return 0
    try {
      const stmt = this.db.prepare('SELECT COUNT(*) as count FROM tracks WHERE expires_at IS NULL OR expires_at > ?')
      const row = stmt.get(Date.now()) as { count: number } | undefined
      return row?.count ?? 0
    } catch {
      return 0
    }
  }

  private _isBlacklisted(source: string, identifier: string): boolean {
    if (!this.db) return false
    try {
      const stmt = this.db.prepare('SELECT 1 FROM blacklist WHERE source = ? AND identifier = ? LIMIT 1')
      return stmt.get(source, identifier) !== undefined
    } catch {
      return false
    }
  }

  private _deleteTrack(source: string, identifier: string): boolean {
    if (!this.db) return false
    try {
      const stmt = this.db.prepare('DELETE FROM tracks WHERE source = ? AND identifier = ?')
      const result = stmt.run(source, identifier)
      return (result.changes ?? 0) > 0
    } catch {
      return false
    }
  }

  /**
   * Sweeps expired entries and evicts oldest if over maxEntries.
   */
  private _sweep(): void {
    if (!this.db) return

    try {
      // Delete expired entries
      const deleteStmt = this.db.prepare('DELETE FROM tracks WHERE expires_at IS NOT NULL AND expires_at < ?')
      const deleted = deleteStmt.run(Date.now()).changes ?? 0

      // Delete old blacklist entries (older than 30 days)
      const deleteBlacklistStmt = this.db.prepare('DELETE FROM blacklist WHERE created_at < ?')
      deleteBlacklistStmt.run(Date.now() - 30 * 24 * 60 * 60 * 1000)

      if (deleted > 0) {
        log('debug', 'TrackCacheSQL', `Swept ${deleted} expired tracks`)
      }

      this._evictIfNeeded()
    } catch (err) {
      log('warn', 'TrackCacheSQL', `Sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  /**
   * Evicts oldest entries (by LRU) if cache exceeds maxEntries.
   */
  private _evictIfNeeded(): void {
    if (!this.db) return

    try {
      const count = this._getTrackCount()
      if (count <= this.maxEntries) return

      const toEvict = count - this.maxEntries
      const stmt = this.db.prepare(`
        DELETE FROM tracks WHERE id IN (
          SELECT id FROM tracks
          ORDER BY accessed_at ASC
          LIMIT ?
        )
      `)
      const result = stmt.run(toEvict)
      if ((result.changes ?? 0) > 0) {
        log('debug', 'TrackCacheSQL', `Evicted ${result.changes} oldest tracks (LRU)`)
      }
    } catch (err) {
      log('warn', 'TrackCacheSQL', `Eviction failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}
