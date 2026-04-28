// src/core/LyricsManager.ts
// AurisLink lyrics manager — tries each provider in order until one succeeds.

import { log } from '../utils/logger.js'
import type { TrackInfo, LyricsResult } from '../typings/index.js'

import LRCLIBLyrics  from '../lyrics/lrclib.js'
import GeniusLyrics  from '../lyrics/genius.js'
import DeezerLyrics  from '../lyrics/deezer.js'

export interface LyricsProvider {
  setup(): Promise<boolean>
  getLyrics(trackInfo: TrackInfo): Promise<LyricsResult>
}

export class LyricsManager {
  private providers: LyricsProvider[] = []

  async setup(): Promise<void> {
    const candidates: LyricsProvider[] = [
      new LRCLIBLyrics({}),
      new GeniusLyrics({}),
      new DeezerLyrics({}),
    ]

    for (const provider of candidates) {
      const ok = await provider.setup()
      if (ok) {
        this.providers.push(provider)
        log('info', 'Lyrics', `Provider ready: ${provider.constructor.name}`)
      }
    }

    log('info', 'Lyrics', `${this.providers.length} provider(s) active`)
  }

  async getLyrics(trackInfo: TrackInfo): Promise<LyricsResult> {
    for (const provider of this.providers) {
      try {
        const result = await provider.getLyrics(trackInfo)
        if (result.loadType === 'lyrics') return result
      } catch (err) {
        log('warn', 'Lyrics', `${provider.constructor.name} failed: ${err}`)
      }
    }
    return { loadType: 'empty', data: {} }
  }
}
