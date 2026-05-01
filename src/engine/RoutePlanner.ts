// src/core/RoutePlanner.ts
// AurisLink IP Route Planner — manages a pool of outbound IPs,
// rotating them automatically when one gets rate-limited or banned.
// Inspired by Lavalink's route planner concept, built from scratch.

import { log } from '../shared/reporter.js'

export type RoutePlannerStrategy = 'RotateOnBan' | 'LoadBalance' | 'NanoSwitch'

export interface FailingAddress {
  address: string
  failingSince: number
  failingTime: string
}

export interface RoutePlannerStatus {
  class: 'AurisRoutePlanner' | null
  details: {
    strategy: RoutePlannerStrategy
    ipBlock: { type: 'Inet4Address' | 'Inet6Address'; size: number }
    availableAddresses: number
    failingAddresses: FailingAddress[]
    currentAddress: string | null
  } | null
}

interface BanEntry {
  bannedAt: number
  expiresAt: number
}

export class RoutePlanner {
  readonly strategy: RoutePlannerStrategy
  readonly ipPool: string[]
  readonly cooldownMs: number

  private _currentIndex = 0
  private readonly _banned = new Map<string, BanEntry>()

  constructor(options: {
    ipPool: string[]
    strategy?: RoutePlannerStrategy
    cooldownMs?: number
  }) {
    this.ipPool = options.ipPool
    this.strategy = options.strategy ?? 'RotateOnBan'
    this.cooldownMs = options.cooldownMs ?? 600_000   // 10 minutes default
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  /** Returns the current active IP to use for outbound requests. */
  get currentAddress(): string | null {
    if (this.ipPool.length === 0) return null
    this._evictExpired()
    return this._pickAddress()
  }

  /** Call this when an IP gets a 429 or is otherwise blocked. */
  ban(address: string): void {
    const now = Date.now()
    this._banned.set(address, { bannedAt: now, expiresAt: now + this.cooldownMs })
    log('warn', 'RoutePlanner', `Banned ${address} for ${this.cooldownMs / 1000}s — rotating`)

    if (this.strategy === 'RotateOnBan' || this.strategy === 'NanoSwitch') {
      this._rotate()
    }
  }

  /** Manually unban a specific address. */
  freeAddress(address: string): boolean {
    const had = this._banned.has(address)
    this._banned.delete(address)
    if (had) log('info', 'RoutePlanner', `Manually freed ${address}`)
    return had
  }

  /** Unban all addresses. */
  freeAll(): void {
    const count = this._banned.size
    this._banned.clear()
    log('info', 'RoutePlanner', `Freed all ${count} banned address(es)`)
  }

  /** Serializable status for GET /v4/routeplanner/status */
  get status(): RoutePlannerStatus {
    if (this.ipPool.length === 0) {
      return { class: null, details: null }
    }

    this._evictExpired()
    const now = Date.now()

    const failingAddresses: FailingAddress[] = []
    for (const [address, entry] of this._banned) {
      if (entry.expiresAt > now) {
        failingAddresses.push({
          address,
          failingSince: entry.bannedAt,
          failingTime: new Date(entry.bannedAt).toISOString(),
        })
      }
    }

    const available = this.ipPool.filter(ip => !this._banned.has(ip))

    return {
      class: 'AurisRoutePlanner',
      details: {
        strategy: this.strategy,
        ipBlock: {
          type: this.ipPool[0]?.includes(':') ? 'Inet6Address' : 'Inet4Address',
          size: this.ipPool.length,
        },
        availableAddresses: available.length,
        failingAddresses,
        currentAddress: this.currentAddress,
      },
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private _evictExpired(): void {
    const now = Date.now()
    for (const [ip, entry] of this._banned) {
      if (entry.expiresAt <= now) {
        this._banned.delete(ip)
        log('debug', 'RoutePlanner', `Auto-unbanned ${ip} (cooldown expired)`)
      }
    }
  }

  private _pickAddress(): string {
    switch (this.strategy) {
      case 'LoadBalance': {
        // Always pick the available IP with fewest bans (simplest load balance)
        const available = this.ipPool.filter(ip => !this._banned.has(ip))
        if (available.length === 0) return this.ipPool[0]!
        return available[Math.floor(Math.random() * available.length)]!
      }
      case 'NanoSwitch':
      case 'RotateOnBan':
      default: {
        // Use current index, skip banned
        const start = this._currentIndex
        for (let i = 0; i < this.ipPool.length; i++) {
          const idx = (start + i) % this.ipPool.length
          const ip = this.ipPool[idx]!
          if (!this._banned.has(ip)) return ip
        }
        // All banned — return current anyway
        return this.ipPool[this._currentIndex % this.ipPool.length]!
      }
    }
  }

  private _rotate(): void {
    this._currentIndex = (this._currentIndex + 1) % this.ipPool.length
  }
}
