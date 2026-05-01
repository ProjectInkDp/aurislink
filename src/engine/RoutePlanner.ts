// src/engine/RoutePlanner.ts
// AurisLink Advanced IP Route Planner
// Manages outbound IP rotation with exclusive NanoSwitch latency-based strategy.

import { log } from '../shared/reporter.js'
import { execSync } from 'node:child_process'

export type RoutePlannerStrategy = 'RotateOnBan' | 'LoadBalance' | 'NanoSwitch'

export interface FailingAddress {
  address: string
  failingSince: number
  failingTime: string
}

export interface RoutePlannerStatus {
  class: 'AurisRoutePlanner'
  details: {
    strategy: RoutePlannerStrategy
    ipBlock: { type: 'Inet4Address' | 'Inet6Address'; size: number }
    availableAddresses: number
    failingAddresses: FailingAddress[]
    currentAddress: string | null
    latencyStats?: Record<string, number>
  }
}

interface BanEntry {
  bannedAt: number
  expiresAt: number
}

/**
 * RoutePlanner: Manages IP rotation for outbound requests.
 * Features the exclusive NanoSwitch strategy for latency-optimized routing.
 */
export class RoutePlanner {
  readonly strategy: RoutePlannerStrategy
  readonly ipPool: string[]
  readonly cooldownMs: number

  private _currentIndex = 0
  private readonly _banned = new Map<string, BanEntry>()
  private readonly _latencyMap = new Map<string, number>()

  constructor(options: {
    ipPool: string[]
    strategy?: RoutePlannerStrategy
    cooldownMs?: number
  }) {
    this.ipPool = options.ipPool
    this.strategy = options.strategy ?? 'RotateOnBan'
    this.cooldownMs = options.cooldownMs ?? 600_000

    if (this.strategy === 'NanoSwitch') {
      this._startLatencyMonitor()
    }
  }

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
        latencyStats: this.strategy === 'NanoSwitch' ? Object.fromEntries(this._latencyMap) : undefined
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
    if (this.strategy === 'NanoSwitch') {
      return this._getLowestLatencyAddress()
    }

    if (this.strategy === 'LoadBalance') {
      const available = this.ipPool.filter(ip => !this._banned.has(ip))
      if (available.length === 0) return this.ipPool[0]!
      return available[Math.floor(Math.random() * available.length)]!
    }

    // Default: RotateOnBan
    const start = this._currentIndex
    for (let i = 0; i < this.ipPool.length; i++) {
      const idx = (start + i) % this.ipPool.length
      const ip = this.ipPool[idx]!
      if (!this._banned.has(ip)) return ip
    }
    return this.ipPool[this._currentIndex % this.ipPool.length]!
  }

  private _getLowestLatencyAddress(): string {
    let bestIp = this.ipPool[0]!
    let minLatency = Infinity

    for (const ip of this.ipPool) {
      if (this._banned.has(ip)) continue
      const lat = this._latencyMap.get(ip) ?? 999
      if (lat < minLatency) {
        minLatency = lat
        bestIp = ip
      }
    }
    return bestIp
  }

  private _startLatencyMonitor(): void {
    setInterval(() => {
      for (const ip of this.ipPool) {
        try {
          const start = Date.now()
          execSync(`ping -c 1 -W 1 ${ip} > /dev/null 2>&1`)
          this._latencyMap.set(ip, Date.now() - start)
        } catch {
          this._latencyMap.set(ip, 999)
        }
      }
    }, 60000).unref()
  }

  private _rotate(): void {
    this._currentIndex = (this._currentIndex + 1) % this.ipPool.length
  }
}
