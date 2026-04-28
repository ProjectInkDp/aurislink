// src/typings/trackCache.ts

/**
 * Entry stored inside the AurisLink track cache.
 *
 * @example
 * ```ts
 * const entry: TrackCacheEntry<string> = {
 *   value: 'https://cdn.example.com/track.opus',
 *   expiresAt: Date.now() + 3_600_000
 * }
 * ```
 * @public
 */
export interface TrackCacheEntry<T = unknown> {
  /** Cached payload for the resolved source/identifier pair. */
  value: T

  /** Expiry timestamp in ms, or null when the entry has no TTL. */
  expiresAt: number | null
}
