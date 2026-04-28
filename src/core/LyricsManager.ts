// src/core/LyricsManager.ts
// AurisLink lyrics manager — tries each provider in order until one succeeds.

import { log } from '../utils/logger.js'
import type { TrackInfo, LyricsResult, AurisConfig } from '../typings/index.js'
import type TokenStore from './TokenStore.js'

import LRCLIBLyrics       from '../lyrics/lrclib.js'
import GeniusLyrics       from '../lyrics/genius.js'
import DeezerLyrics       from '../lyrics/deezer.js'
import YandexMusicLyrics  from '../lyrics/yandexmusic.js'
import MusixmatchLyrics   from '../lyrics/musixmatch.js'
import LetrasMusLyrics    from '../lyrics/letrasmus.js'

export interface LyricsProvider {
  setup(...args: unknown[]): Promise<boolean>
  getLyrics(trackInfo: TrackInfo): Promise<LyricsResult>
}

export class LyricsManager {
  private providers: LyricsProvider[] = []

  async setup(config?: AurisConfig, tokenStore?: TokenStore): Promise<void> {
    const yandexToken = (config as any)?.lyrics?.yandexmusic?.accessToken as string | undefined

    const candidates: Array<LyricsProvider | { provider: LyricsProvider; setupArgs: unknown[] }> = [
      new LRCLIBLyrics({}),
      new GeniusLyrics({}),
      new DeezerLyrics({}),
      new MusixmatchLyrics({ options: {}, credentialManager: { get: () => null, set: () => {} } }),
      new LetrasMusLyrics({}),
    ]

    // Add Yandex Music if a TokenStore is available — the provider uses it
    // to persist the OAuth token across restarts.
    if (tokenStore) {
      const ym = new YandexMusicLyrics(tokenStore)
      candidates.push({ provider: ym as unknown as LyricsProvider, setupArgs: [yandexToken] })
    }

    for (const entry of candidates) {
      const isWrapped = 'provider' in (entry as object)
      const provider  = isWrapped ? (entry as any).provider as LyricsProvider : entry as LyricsProvider
      const args      = isWrapped ? (entry as any).setupArgs as unknown[] : []

      try {
        const ok = await provider.setup(...args)
        if (ok) {
          this.providers.push(provider)
          log('info', 'Lyrics', `Provider ready: ${provider.constructor.name}`)
        }
      } catch (err) {
        log('warn', 'Lyrics', `${provider.constructor.name} setup failed: ${err}`)
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



