// src/utils/rateLimit.ts
// Multi-scope sliding-window rate limiter for AurisLink.
// Tracks limits independently per: global, IP, User-Id header, and Guild-Id (from URL).
// Emits X-RateLimit-* response headers so clients can back off gracefully.
// Zero external dependencies — pure Node.js, fits AurisLink's zero-dep philosophy.

import type http from 'node:http'
import { log } from './reporter.js'
import type { AurisRateLimitConfig, AurisRateLimitResult, AurisRateLimitScope } from '../typings/index.js'

// ─── Internal types ───────────────────────────────────────────────────────────

interface ScopeEntry {
  /** Timestamps of each request within the current window (circular-ish array). */
  timestamps: number[]
  /** Index of the oldest valid timestamp (avoids repeated splice). */
  head: number
  /** Last time this entry was touched — used for idle eviction. */
  lastSeen: number
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Required<AurisRateLimitConfig> = {
  enabled:    true,
  trustProxy: false,
  maxEntries: 8_000,
  global:    { maxRequests: 2_000, windowMs: 60_000 },
  perIp:     { maxRequests: 120,   windowMs: 60_000 },
  perUserId: { maxRequests: 60,    windowMs: 60_000 },
  perGuildId:{ maxRequests: 30,    windowMs: 60_000 },
  ignorePaths: ['/v4/health', '/v4/metrics', '/v4/version'],
}

// Cleanup runs every 30 s to evict idle entries.
const CLEANUP_INTERVAL_MS = 30_000

// ─── RateLimiter class ────────────────────────────────────────────────────────

/**
 * Multi-scope rate limiter that enforces independent limits for:
 * global traffic, per-IP, per-User-Id header, and per-Guild-Id (from URL path).
 *
 * Uses a true sliding window: timestamps are stored per bucket and pruned
 * as they age out of the configured window, giving accurate per-second fairness.
 *
 * @example
 * ```ts
 * const limiter = new RateLimiter(config.rateLimit)
 * const result = limiter.check(req)
 * if (!result.allowed) { res.writeHead(429); res.end(); return }
 * applyRateLimitHeaders(res, result)
 * ```
 */
export class RateLimiter {
  private readonly cfg: Required<AurisRateLimitConfig>
  private readonly store = new Map<string, ScopeEntry>()
  private readonly timer: NodeJS.Timeout

  constructor(config?: Partial<AurisRateLimitConfig>) {
    this.cfg = this._merge(config)
    this.timer = setInterval(() => this._evict(), CLEANUP_INTERVAL_MS)
    this.timer.unref()
    log(
      'info',
      'RateLimiter',
      `Active — global:${this.cfg.global.maxRequests}/win  ip:${this.cfg.perIp.maxRequests}/win  user:${this.cfg.perUserId.maxRequests}/win  guild:${this.cfg.perGuildId.maxRequests}/win`,
    )
  }

  /**
   * Evaluates all applicable scopes for the incoming request.
   * Returns the most-restrictive allowed result, or the first rejection found.
   */
  check(req: http.IncomingMessage): AurisRateLimitResult {
    if (!this.cfg.enabled) return { allowed: true }

    const pathname = this._pathname(req)
    if (this.cfg.ignorePaths.some(p => pathname.startsWith(p))) return { allowed: true }

    const now = Date.now()
    const ip = this._resolveIp(req)
    const userId = this._header(req, 'user-id')
    const guildId = this._guildFromPath(pathname)

    // Global scope — reject immediately if exceeded
    const globalResult = this._checkScope('global', 'all', this.cfg.global, now)
    if (!globalResult.allowed) {
      log('warn', 'RateLimiter', `Global limit exceeded (ip=${ip ?? 'unknown'})`)
      return globalResult
    }

    let tightest: AurisRateLimitResult = globalResult

    if (ip) {
      const ipResult = this._checkScope('ip', ip, this.cfg.perIp, now)
      if (!ipResult.allowed) {
        log('warn', 'RateLimiter', `IP limit exceeded — ${ip}`)
        return ipResult
      }
      tightest = this._tighter(tightest, ipResult)
    }

    if (userId) {
      const userResult = this._checkScope('user', userId, this.cfg.perUserId, now)
      if (!userResult.allowed) {
        log('warn', 'RateLimiter', `User-Id limit exceeded — ${userId} (ip=${ip ?? 'unknown'})`)
        return userResult
      }
      tightest = this._tighter(tightest, userResult)
    }

    if (guildId) {
      const guildResult = this._checkScope('guild', guildId, this.cfg.perGuildId, now)
      if (!guildResult.allowed) {
        log('warn', 'RateLimiter', `Guild-Id limit exceeded — ${guildId} (ip=${ip ?? 'unknown'})`)
        return guildResult
      }
      tightest = this._tighter(tightest, guildResult)
    }

    return tightest
  }

  /** Stops the cleanup timer and clears all state. */
  destroy(): void {
    clearInterval(this.timer)
    this.store.clear()
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Checks and increments a single scope bucket using a true sliding window.
   * Each request timestamp is stored; timestamps older than windowMs are pruned.
   */
  private _checkScope(
    type: AurisRateLimitScope,
    id: string,
    rule: { maxRequests: number; windowMs: number },
    now: number,
  ): AurisRateLimitResult {
    const key = `${type}:${id}`
    const entry = this._bucket(key, now)
    const cutoff = now - rule.windowMs

    // Advance head past expired timestamps
    while (entry.head < entry.timestamps.length) {
      if ((entry.timestamps[entry.head] ?? 0) <= cutoff) entry.head++
      else break
    }

    // Compact the array when head has drifted far enough to avoid unbounded growth
    if (entry.head > 512 || entry.head > entry.timestamps.length / 2) {
      entry.timestamps = entry.timestamps.slice(entry.head)
      entry.head = 0
    }

    const active = entry.timestamps.length - entry.head
    const limit = Math.max(1, rule.maxRequests)
    const oldest = entry.timestamps[entry.head] ?? now
    const reset = oldest + rule.windowMs

    if (active >= limit) {
      return { allowed: false, limit, remaining: 0, reset, scope: type }
    }

    entry.timestamps.push(now)
    entry.lastSeen = now

    return {
      allowed:   true,
      limit,
      remaining: Math.max(0, limit - active - 1),
      reset,
      scope:     type,
    }
  }

  /** Returns the result with fewer remaining requests (most restrictive). */
  private _tighter(a: AurisRateLimitResult, b: AurisRateLimitResult): AurisRateLimitResult {
    if (a.remaining === undefined) return b
    if (b.remaining === undefined) return a
    return b.remaining < a.remaining ? b : a
  }

  /** Gets or creates a scope bucket. */
  private _bucket(key: string, now: number): ScopeEntry {
    const existing = this.store.get(key)
    if (existing) return existing
    const entry: ScopeEntry = { timestamps: [], head: 0, lastSeen: now }
    this.store.set(key, entry)
    return entry
  }

  /**
   * Evicts idle entries to keep memory bounded.
   * An entry is considered idle after 3x the longest configured window.
   */
  private _evict(): void {
    const now = Date.now()
    const longestWindow = Math.max(
      this.cfg.global.windowMs,
      this.cfg.perIp.windowMs,
      this.cfg.perUserId.windowMs,
      this.cfg.perGuildId.windowMs,
    )
    const idleThreshold = longestWindow * 3

    for (const [key, entry] of this.store) {
      if (now - entry.lastSeen > idleThreshold) this.store.delete(key)
    }

    // Hard cap: evict oldest-seen entries when store exceeds the limit
    const max = this.cfg.maxEntries
    if (this.store.size <= max) return

    const sorted = [...this.store.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)
    const overflow = this.store.size - max
    for (let i = 0; i < overflow; i++) {
      const pair = sorted[i]
      if (pair) this.store.delete(pair[0])
    }
  }

  /** Resolves the real client IP, honouring X-Forwarded-For when trustProxy is on. */
  private _resolveIp(req: http.IncomingMessage): string | null {
    const socket = (req.socket as { remoteAddress?: string })?.remoteAddress
    const fwd = this._header(req, 'x-forwarded-for')
    const raw = this.cfg.trustProxy && fwd ? fwd.split(',')[0]?.trim() : socket ?? fwd
    return this._normaliseIp(raw)
  }

  /** Strips IPv4-mapped IPv6 prefixes and brackets for consistent keys. */
  private _normaliseIp(raw: string | undefined): string | null {
    if (!raw) return null
    let ip = raw.trim()
    if (!ip) return null
    if (ip.startsWith('::ffff:')) ip = ip.slice(7)
    if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1)
    // host:port — keep only the host part
    const colonCount = ip.split(':').length - 1
    if (colonCount === 1 && ip.includes('.')) ip = ip.split(':')[0] ?? ip
    return ip || null
  }

  /** Extracts a single header value as a string. */
  private _header(req: http.IncomingMessage, name: string): string | undefined {
    const raw = req.headers[name] ?? req.headers[name.toLowerCase()]
    if (Array.isArray(raw)) return raw[0]
    return raw
  }

  /** Extracts the pathname from the request URL. */
  private _pathname(req: http.IncomingMessage): string {
    try {
      return new URL(req.url ?? '/', `http://${req.headers.host}`).pathname
    } catch {
      return req.url?.split('?')[0] ?? '/'
    }
  }

  /** Extracts a Guild-Id from a Lavalink v4 player path. */
  private _guildFromPath(pathname: string): string | null {
    const match = pathname.match(/\/v4\/sessions\/[^\/]+\/players\/([^\/]+)/)
    return match?.[1] ?? null
  }

  /** Merges user config with defaults. */
  private _merge(cfg?: Partial<AurisRateLimitConfig>): Required<AurisRateLimitConfig> {
    if (!cfg) return { ...DEFAULT_CONFIG }
    return {
      enabled:     cfg.enabled     ?? DEFAULT_CONFIG.enabled,
      trustProxy:  cfg.trustProxy  ?? DEFAULT_CONFIG.trustProxy,
      maxEntries:  cfg.maxEntries  ?? DEFAULT_CONFIG.maxEntries,
      global:      { ...DEFAULT_CONFIG.global,     ...(cfg.global     ?? {}) },
      perIp:       { ...DEFAULT_CONFIG.perIp,      ...(cfg.perIp      ?? {}) },
      perUserId:   { ...DEFAULT_CONFIG.perUserId,  ...(cfg.perUserId  ?? {}) },
      perGuildId:  { ...DEFAULT_CONFIG.perGuildId, ...(cfg.perGuildId ?? {}) },
      ignorePaths: cfg.ignorePaths ?? DEFAULT_CONFIG.ignorePaths,
    }
  }
}

// ─── Response header helper ───────────────────────────────────────────────────

/**
 * Writes X-RateLimit-* headers onto the response so clients can track their quota.
 * Call this after every successful check() to inform the client of remaining capacity.
 */
export function applyRateLimitHeaders(res: http.ServerResponse, result: AurisRateLimitResult): void {
  if (result.limit     !== undefined) res.setHeader('X-RateLimit-Limit',     String(result.limit))
  if (result.remaining !== undefined) res.setHeader('X-RateLimit-Remaining', String(result.remaining))
  if (result.reset     !== undefined) res.setHeader('X-RateLimit-Reset',     String(Math.ceil(result.reset / 1_000)))
  if (result.scope     !== undefined) res.setHeader('X-RateLimit-Scope',     result.scope)
}
