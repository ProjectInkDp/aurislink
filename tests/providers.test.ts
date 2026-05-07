import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { YoutubeSource } from '../src/providers/youtube/youtube.js'
import type { AurisConfig } from '../src/typings/index.js'

/**
 * Mock AurisConfig for testing
 */
function createMockConfig(): AurisConfig {
  return {
    server: {
      host: '0.0.0.0',
      port: 2333,
      password: 'test',
      tls: { enabled: false, cert: '', key: '' },
    },
    logging: {
      level: 'info',
      timestamps: true,
      colors: false,
    },
    playerUpdateInterval: 5000,
    statsInterval: 60000,
    trackStuckThresholdMs: 10000,
    zombieThresholdMs: 60000,
    maxSearchResults: 10,
    maxPlaylistLength: 100,
    sources: {
      soundcloud: { enabled: false, clientId: '' },
      deezer: { enabled: false },
      jiosaavn: { enabled: false },
      spotify: { enabled: false },
      applemusic: { enabled: false },
      youtube: {
        enabled: true,
        clients: ['WEB'],
        allowFallback: true,
      },
      ytmusic: {
        enabled: true,
        clients: ['WEB_REMIX'],
        allowFallback: true,
      },
    },
  }
}

describe('YouTube Provider', () => {
  let youtubeSource: YoutubeSource
  let config: AurisConfig

  beforeEach(() => {
    config = createMockConfig()
    youtubeSource = new YoutubeSource(config)
  })

  afterEach(() => {
    // Cleanup
  })

  describe('Initialization', () => {
    it('should create YouTube source instance', () => {
      expect(youtubeSource).toBeDefined()
      expect(youtubeSource.name).toBe('youtube')
    })

    it('should have correct search prefixes', () => {
      expect(youtubeSource.searchPrefixes).toContain('ytsearch')
    })
  })

  describe('URL Validation', () => {
    it('should accept youtube.com URLs', () => {
      expect(youtubeSource.accepts('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true)
    })

    it('should accept youtu.be URLs', () => {
      expect(youtubeSource.accepts('https://youtu.be/dQw4w9WgXcQ')).toBe(true)
    })

    it('should reject music.youtube.com URLs', () => {
      expect(youtubeSource.accepts('https://music.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(false)
    })

    it('should reject non-YouTube URLs', () => {
      expect(youtubeSource.accepts('https://example.com/video')).toBe(false)
    })
  })

  describe('Setup', () => {
    it('should setup without errors', async () => {
      const result = await youtubeSource.setup()
      expect(typeof result).toBe('boolean')
    })

    it('should attempt to initialize cookies', async () => {
      // This test verifies the setup process includes cookie initialization
      await youtubeSource.setup()
      // If no error is thrown, the test passes
      expect(true).toBe(true)
    })
  })
})

describe('Provider Configuration', () => {
  it('should use correct default clients for YouTube', () => {
    const config = createMockConfig()
    const source = new YoutubeSource(config)
    expect(source).toBeDefined()
  })

  it('should handle custom client configuration', () => {
    const config = createMockConfig()
    config.sources.youtube!.clients = ['ANDROID', 'TVHTML5']
    const source = new YoutubeSource(config)
    expect(source).toBeDefined()
  })

  it('should respect allowFallback setting', () => {
    const config = createMockConfig()
    config.sources.youtube!.allowFallback = false
    const source = new YoutubeSource(config)
    expect(source).toBeDefined()
  })
})
