import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import { IntelligentCache, SearchResultsCache } from '../src/shared/cache.js'

describe('IntelligentCache', () => {
  let cache: IntelligentCache<string>

  beforeEach(() => {
    cache = new IntelligentCache(1, 100) // 1 second TTL
  })

  afterEach(() => {
    cache.destroy()
  })

  describe('Basic Operations', () => {
    it('should set and get values', () => {
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')
    })

    it('should return null for missing keys', () => {
      expect(cache.get('nonexistent')).toBeNull()
    })

    it('should check if key exists', () => {
      cache.set('key1', 'value1')
      expect(cache.has('key1')).toBe(true)
      expect(cache.has('nonexistent')).toBe(false)
    })

    it('should delete keys', () => {
      cache.set('key1', 'value1')
      expect(cache.delete('key1')).toBe(true)
      expect(cache.get('key1')).toBeNull()
    })

    it('should clear all entries', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.clear()
      expect(cache.size()).toBe(0)
    })
  })

  describe('TTL Expiration', () => {
    it('should expire entries after TTL', async () => {
      cache = new IntelligentCache(0.1, 100) // 100ms TTL
      cache.set('key1', 'value1')
      expect(cache.get('key1')).toBe('value1')

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 150))

      expect(cache.get('key1')).toBeNull()
    })

    it('should return null for expired entries', async () => {
      cache = new IntelligentCache(0.05, 100) // 50ms TTL
      cache.set('key1', 'value1')

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(cache.has('key1')).toBe(false)
    })
  })

  describe('Statistics', () => {
    it('should track cache hits', () => {
      cache.set('key1', 'value1')
      cache.get('key1')
      cache.get('key1')

      const stats = cache.getStats()
      expect(stats.hits).toBe(2)
      expect(stats.misses).toBe(0)
    })

    it('should track cache misses', () => {
      cache.get('nonexistent')
      cache.get('nonexistent')

      const stats = cache.getStats()
      expect(stats.misses).toBe(2)
      expect(stats.hits).toBe(0)
    })

    it('should calculate hit rate', () => {
      cache.set('key1', 'value1')
      cache.get('key1')
      cache.get('key1')
      cache.get('nonexistent')

      const stats = cache.getStats()
      expect(stats.hitRate).toBeCloseTo(66.67, 1)
    })

    it('should report cache size', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      expect(cache.size()).toBe(2)
    })
  })

  describe('LRU Eviction', () => {
    it('should evict LRU entry when cache is full', () => {
      cache = new IntelligentCache(3600, 2) // Max 2 entries
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      cache.set('key3', 'value3') // Should evict key1

      expect(cache.has('key1')).toBe(false)
      expect(cache.has('key2')).toBe(true)
      expect(cache.has('key3')).toBe(true)
    })
  })

  describe('Keys Listing', () => {
    it('should return all keys', () => {
      cache.set('key1', 'value1')
      cache.set('key2', 'value2')
      const keys = cache.keys()
      expect(keys).toContain('key1')
      expect(keys).toContain('key2')
      expect(keys.length).toBe(2)
    })
  })
})

describe('SearchResultsCache', () => {
  let cache: SearchResultsCache

  beforeEach(() => {
    cache = new SearchResultsCache(3600)
  })

  afterEach(() => {
    cache.destroy()
  })

  describe('Search Caching', () => {
    it('should cache search results by query and source', () => {
      const results = { data: ['track1', 'track2'] }
      cache.set('test query', 'youtube', results)

      expect(cache.get('test query', 'youtube')).toEqual(results)
    })

    it('should differentiate between sources', () => {
      const resultsYT = { data: ['yt-track'] }
      const resultsSC = { data: ['sc-track'] }

      cache.set('test', 'youtube', resultsYT)
      cache.set('test', 'soundcloud', resultsSC)

      expect(cache.get('test', 'youtube')).toEqual(resultsYT)
      expect(cache.get('test', 'soundcloud')).toEqual(resultsSC)
    })

    it('should be case-insensitive for queries', () => {
      const results = { data: ['track1'] }
      cache.set('Test Query', 'youtube', results)

      expect(cache.get('test query', 'youtube')).toEqual(results)
      expect(cache.get('TEST QUERY', 'youtube')).toEqual(results)
    })

    it('should check if results are cached', () => {
      cache.set('test', 'youtube', { data: [] })
      expect(cache.has('test', 'youtube')).toBe(true)
      expect(cache.has('other', 'youtube')).toBe(false)
    })

    it('should report statistics', () => {
      cache.set('test1', 'youtube', { data: [] })
      cache.set('test2', 'youtube', { data: [] })

      const stats = cache.getStats()
      expect(stats.totalEntries).toBe(2)
    })

    it('should clear cache', () => {
      cache.set('test', 'youtube', { data: [] })
      cache.clear()
      expect(cache.has('test', 'youtube')).toBe(false)
    })
  })
})
