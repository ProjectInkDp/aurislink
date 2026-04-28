// src/utils/rateLimit.ts
// Simple in-memory per-IP rate limiter using a sliding window counter.
// No external dependencies — fits AurisLink's zero-dep philosophy.

interface Bucket {
  count:     number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

// Clean up stale buckets every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now()
  for (const [ip, bucket] of buckets) {
    if (now - bucket.windowStart > 60_000) buckets.delete(ip)
  }
}, 5 * 60_000).unref()

/**
 * Returns true if the request should be allowed, false if rate limited.
 *
 * @param ip       Client IP address
 * @param limit    Max requests allowed per window
 * @param windowMs Window size in milliseconds (default: 60 000)
 */
export function checkRateLimit(ip: string, limit: number, windowMs = 60_000): boolean {
  const now = Date.now()
  const bucket = buckets.get(ip)

  if (!bucket || now - bucket.windowStart >= windowMs) {
    // New window
    buckets.set(ip, { count: 1, windowStart: now })
    return true
  }

  if (bucket.count >= limit) return false

  bucket.count++
  return true
}

/**
 * Extract the real client IP, respecting X-Forwarded-For when behind a proxy.
 */
export function getClientIp(req: { socket: { remoteAddress?: string }; headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers['x-forwarded-for']
  if (forwarded) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0]
    return first?.trim() ?? '0.0.0.0'
  }
  return req.socket.remoteAddress ?? '0.0.0.0'
}
