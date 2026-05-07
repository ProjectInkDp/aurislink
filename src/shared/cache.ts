import { log } from './reporter.js'

export interface CacheEntry<T> {
  value: T
  expiresAt: number
  hits: number
  createdAt: number
}

export interface CacheStats {
  totalEntries: number
  hits: number
  misses: number
  hitRate: number
  memoryUsage: number
}

/**
 * IntelligentCache
 * Generic cache system with TTL, statistics, and automatic cleanup
 */
export class IntelligentCache<T = any> {
  private _cache: Map<string, CacheEntry<T>> = new Map()
  private _stats = { hits: 0, misses: 0 }
  private _cleanupInterval: NodeJS.Timer | null = null
  private _ttl: number // milliseconds
  private _maxSize: number

  constructor(ttlSeconds: number = 3600, maxSize: number = 1000) {
    this._ttl = ttlSeconds * 1000
    this._maxSize = maxSize
    this._startCleanup()
  }

  /**
   * Get value from cache
   */
  get(key: string): T | null {
    const entry = this._cache.get(key)

    if (!entry) {
      this._stats.misses++
      return null
    }

    // Check if expired
    if (entry.expiresAt < Date.now()) {
      this._cache.delete(key)
      this._stats.misses++
      return null
    }

    // Hit!
    entry.hits++
    this._stats.hits++
    return entry.value
  }

  /**
   * Set value in cache
   */
  set(key: string, value: T): void {
    // Check if cache is full
    if (this._cache.size >= this._maxSize && !this._cache.has(key)) {
      this._evictLRU()
    }

    this._cache.set(key, {
      value,
      expiresAt: Date.now() + this._ttl,
      hits: 0,
      createdAt: Date.now(),
    })
  }

  /**
   * Check if key exists and is not expired
   */
  has(key: string): boolean {
    const entry = this._cache.get(key)
    if (!entry) return false
    if (entry.expiresAt < Date.now()) {
      this._cache.delete(key)
      return false
    }
    return true
  }

  /**
   * Delete specific key
   */
  delete(key: string): boolean {
    return this._cache.delete(key)
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this._cache.clear()
    this._stats = { hits: 0, misses: 0 }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const totalHits = this._stats.hits
    const totalMisses = this._stats.misses
    const total = totalHits + totalMisses

    return {
      totalEntries: this._cache.size,
      hits: totalHits,
      misses: totalMisses,
      hitRate: total > 0 ? (totalHits / total) * 100 : 0,
      memoryUsage: this._estimateMemoryUsage(),
    }
  }

  /**
   * Get all keys in cache
   */
  keys(): string[] {
    return Array.from(this._cache.keys())
  }

  /**
   * Get cache size
   */
  size(): number {
    return this._cache.size
  }

  /**
   * Cleanup expired entries
   */
  private _cleanup(): void {
    const now = Date.now()
    let removed = 0

    for (const [key, entry] of this._cache.entries()) {
      if (entry.expiresAt < now) {
        this._cache.delete(key)
        removed++
      }
    }

    if (removed > 0) {
      log('debug', 'Cache', `Cleaned up ${removed} expired entries`)
    }
  }

  /**
   * Evict Least Recently Used entry
   */
  private _evictLRU(): void {
    let lruKey: string | null = null
    let lruTime = Date.now()

    for (const [key, entry] of this._cache.entries()) {
      if (entry.createdAt < lruTime) {
        lruTime = entry.createdAt
        lruKey = key
      }
    }

    if (lruKey) {
      this._cache.delete(lruKey)
      log('debug', 'Cache', `Evicted LRU entry: ${lruKey}`)
    }
  }

  /**
   * Start automatic cleanup
   */
  private _startCleanup(): void {
    // Run cleanup every 5 minutes
    this._cleanupInterval = setInterval(() => {
      this._cleanup()
    }, 5 * 60 * 1000)

    // Allow process to exit even with interval running
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref()
    }
  }

  /**
   * Stop cleanup interval
   */
  destroy(): void {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval as any)
    }
    this.clear()
  }

  /**
   * Estimate memory usage (rough estimate)
   */
  private _estimateMemoryUsage(): number {
    let bytes = 0
    for (const [key, entry] of this._cache.entries()) {
      bytes += key.length * 2 // UTF-16
      bytes += JSON.stringify(entry.value).length
      bytes += 100 // overhead
    }
    return bytes
  }
}

/**
 * Search Results Cache
 * Specialized cache for search results
 */
export class SearchResultsCache {
  private _cache: IntelligentCache<any>

  constructor(ttlSeconds: number = 3600) {
    this._cache = new IntelligentCache(ttlSeconds, 500)
  }

  /**
   * Generate cache key from query and source
   */
  private _generateKey(query: string, source: string): string {
    return `search:${source}:${query.toLowerCase().trim()}`
  }

  /**
   * Get cached search results
   */
  get(query: string, source: string): any | null {
    return this._cache.get(this._generateKey(query, source))
  }

  /**
   * Cache search results
   */
  set(query: string, source: string, results: any): void {
    this._cache.set(this._generateKey(query, source), results)
  }

  /**
   * Check if results are cached
   */
  has(query: string, source: string): boolean {
    return this._cache.has(this._generateKey(query, source))
  }

  /**
   * Get statistics
   */
  getStats(): CacheStats {
    return this._cache.getStats()
  }

  /**
   * Clear cache
   */
  clear(): void {
    this._cache.clear()
  }

  /**
   * Destroy cache
   */
  destroy(): void {
    this._cache.destroy()
  }
}
