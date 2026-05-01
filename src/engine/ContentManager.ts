import { log } from '../shared/reporter.js'
import type { TrackInfo, LyricsResult } from '../typings/index.js'
import DeezerLyrics from '../content/deezer.js'
import LRCLIBLyrics from '../content/lrclib.js'

/**
 * AurisLink Lyrics Manager
 * Coordinates multiple lyrics providers with a fallback mechanism.
 */
export default class ContentManager {
  private static instance: ContentManager
  private readonly providers: any[] = []

  private constructor() {
    this.providers = [
      new DeezerLyrics(),
      new LRCLIBLyrics({})
    ]
  }

  public static getInstance(): ContentManager {
    if (!ContentManager.instance) {
      ContentManager.instance = new ContentManager()
    }
    return ContentManager.instance
  }

  /**
   * Attempts to fetch lyrics from available providers in order.
   */
  public async getLyrics(trackInfo: TrackInfo): Promise<LyricsResult> {
    for (const provider of this.providers) {
      try {
        const result = await provider.getLyrics(trackInfo)
        if (result && result.loadType === 'lyrics') {
          return result
        }
      } catch (err) {
        log('warn', 'ContentManager', `Provider ${provider.constructor.name} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return { loadType: 'empty', data: {} }
  }
}
