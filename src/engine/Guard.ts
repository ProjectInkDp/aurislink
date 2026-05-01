import { log } from '../shared/reporter.js'
import type { ApiRequest, ApiGuardResult } from '../typings/config/dosProtection.js'

/**
 * AurisLink DoS Protection Manager
 * Implements a rolling window rate limiter to mitigate abusive traffic.
 */
export default class GuardManager {
  private readonly ipTracker: Map<string, { count: number; lastReset: number; blockedUntil: number; strikes: number }> = new Map()
  private readonly config = {
    burstLimit: 60,
    windowMs: 10000,
    blockDurationMs: 30000,
    maxStrikes: 5
  }

  constructor() {
    setInterval(() => this.cleanup(), 60000).unref()
  }

  /**
   * Checks if a request should be allowed based on IP rate limits.
   */
  public check(req: ApiRequest): ApiGuardResult {
    const ip = this.resolveIp(req)
    if (!ip) return { allowed: true }

    const now = Date.now()
    let entry = this.ipTracker.get(ip)

    if (!entry) {
      entry = { count: 0, lastReset: now, blockedUntil: 0, strikes: 0 }
      this.ipTracker.set(ip, entry)
    }

    if (now < entry.blockedUntil) {
      return { allowed: false, status: 403, message: 'Rate limit exceeded. Temporarily blocked.' }
    }

    if (now - entry.lastReset > this.config.windowMs) {
      entry.count = 0
      entry.lastReset = now
    }

    entry.count++

    if (entry.count > this.config.burstLimit) {
      entry.strikes++
      const duration = this.config.blockDurationMs * Math.pow(2, Math.min(entry.strikes, this.config.maxStrikes) - 1)
      entry.blockedUntil = now + duration
      log('warn', 'Guard', `IP ${ip} blocked for ${duration}ms (Strike ${entry.strikes})`)
      return { allowed: false, status: 403, message: 'Too many requests.' }
    }

    return { allowed: true }
  }

  private resolveIp(req: ApiRequest): string | null {
    const forwarded = req.headers['x-forwarded-for']
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0] : req.socket?.remoteAddress
    return ip?.replace('::ffff:', '') || null
  }

  private cleanup(): void {
    const now = Date.now()
    for (const [ip, entry] of this.ipTracker.entries()) {
      if (now > entry.blockedUntil && now - entry.lastReset > this.config.windowMs * 10) {
        this.ipTracker.delete(ip)
      }
    }
  }
}
