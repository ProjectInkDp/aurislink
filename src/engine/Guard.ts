import { log } from '../shared/reporter.js'
import type { AurisDosConfig, ApiRequest, ApiGuardResult } from '../typings/config/dosProtection.js'

/**
 * AurisLink DoS Protection Manager
 * Implements a rolling window rate limiter to mitigate abusive traffic.
 * Config is read from application.yml (dosProtection section).
 */
export default class GuardManager {
  private readonly ipTracker: Map<string, { count: number; lastReset: number; blockedUntil: number; strikes: number }> = new Map()
  // Fix #5: read thresholds/mitigation from config instead of hardcoded values
  private readonly burstLimit:       number
  private readonly windowMs:         number
  private readonly blockDurationMs:  number
  private readonly backoffMultiplier: number
  private readonly maxBlockDurationMs: number
  private readonly trustProxy:       boolean
  private readonly ignorePaths:      string[]
  private readonly ignoreIps:        string[]

  constructor(config?: AurisDosConfig) {
    this.burstLimit          = config?.thresholds?.burstRequests    ?? 100
    this.windowMs            = config?.thresholds?.timeWindowMs     ?? 10_000
    this.blockDurationMs     = config?.mitigation?.blockDurationMs  ?? 30_000
    this.backoffMultiplier   = config?.mitigation?.backoffMultiplier ?? 2
    this.maxBlockDurationMs  = config?.mitigation?.maxBlockDurationMs ?? 600_000
    this.trustProxy          = config?.trustProxy                   ?? false
    this.ignorePaths         = config?.ignore?.paths                ?? []
    this.ignoreIps           = config?.ignore?.ips                  ?? []
    setInterval(() => this.cleanup(), 60_000).unref()
  }

  public check(req: ApiRequest): ApiGuardResult {
    const pathname = req.url?.split('?')[0] ?? '/'
    if (this.ignorePaths.some(p => pathname.startsWith(p))) return { allowed: true }

    const ip = this.resolveIp(req)
    if (!ip) return { allowed: true }
    if (this.ignoreIps.includes(ip)) return { allowed: true }

    const now = Date.now()
    let entry = this.ipTracker.get(ip)

    if (!entry) {
      entry = { count: 0, lastReset: now, blockedUntil: 0, strikes: 0 }
      this.ipTracker.set(ip, entry)
    }

    if (now < entry.blockedUntil) {
      return { allowed: false, status: 403, message: 'Rate limit exceeded. Temporarily blocked.' }
    }

    if (now - entry.lastReset > this.windowMs) {
      entry.count = 0
      entry.lastReset = now
    }

    entry.count++

    if (entry.count > this.burstLimit) {
      entry.strikes++
      const raw = this.blockDurationMs * Math.pow(this.backoffMultiplier, entry.strikes - 1)
      const duration = Math.min(raw, this.maxBlockDurationMs)
      entry.blockedUntil = now + duration
      log('warn', 'Guard', `IP ${ip} blocked for ${duration}ms (Strike ${entry.strikes})`)
      return { allowed: false, status: 403, message: 'Too many requests.' }
    }

    return { allowed: true }
  }

  private resolveIp(req: ApiRequest): string | null {
    const forwarded = req.headers['x-forwarded-for']
    const socket = req.socket?.remoteAddress
    const raw = this.trustProxy && typeof forwarded === 'string'
      ? forwarded.split(',')[0]?.trim()
      : socket
    return raw?.replace('::ffff:', '') || null
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.ipTracker.entries()) {
      if (now > entry.blockedUntil && now - entry.lastReset > this.windowMs * 10) {
        this.ipTracker.delete(ip)
      }
    }
  }
}
