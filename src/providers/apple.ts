// src/providers/apple.ts
// Apple Music source — metadata search/resolve via Amp-API.
//
// Strategy: Auto-scrapes the Apple Music web player to extract the developerToken.
// No user login required for metadata and search.

import type { Source, LoadResult, Track, TrackInfo, AurisConfig } from '../typings/index.js'
import { httpGet, httpGetJson } from '../shared/http.js'
import { encodeTrack } from '../shared/media.js'
import { log } from '../shared/reporter.js'

const APPLE_MUSIC_URL = 'https://music.apple.com/br/browse'
const AMP_API_URL = 'https://amp-api.music.apple.com/v1/catalog'
const TOKEN_RE = /["']developerToken["']\s*:\s*["']([^"']+)["']/

export class AppleMusicSource implements Source {
  readonly name = 'apple'
  readonly searchPrefixes = ['amsearch', 'apple']

  private developerToken: string | null = null
  private storefront = 'br'

  constructor(private config: AurisConfig) {}

  async setup(): Promise<boolean> {
    log('info', 'AppleMusic', 'Initializing Apple Music source…')
    return this._fetchDeveloperToken()
  }

  private async _fetchDeveloperToken(): Promise<boolean> {
    log('info', 'AppleMusic', 'Fetching developerToken from Apple Music…')
    const res = await httpGet(APPLE_MUSIC_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
      }
    })

    if (!res || res.status >= 400) {
      log('error', 'AppleMusic', `Failed to reach Apple Music (HTTP ${res?.status})`)
      return false
    }

    const match = res.body.match(TOKEN_RE)
    if (match?.[1]) {
      this.developerToken = match[1]
      log('info', 'AppleMusic', 'Successfully extracted developerToken')
      return true
    }

    log('error', 'AppleMusic', 'Could not find developerToken in page body')
    return false
  }

  accepts(url: string): boolean {
    return url.includes('music.apple.com')
  }

  async load(url: string): Promise<LoadResult> {
    // Basic implementation for URL loading (to be expanded)
    return this._empty()
  }

  async search(query: string): Promise<LoadResult> {
    if (!this.developerToken) {
      const ok = await this._fetchDeveloperToken()
      if (!ok) return this._empty()
    }

    const url = `${AMP_API_URL}/${this.storefront}/search?term=${encodeURIComponent(query)}&limit=${this.config.maxSearchResults}&types=songs`
    const res = await httpGetJson<{ results?: { songs?: { data: any[] } } }>(url, {
      headers: {
        'Authorization': `Bearer ${this.developerToken}`,
        'Origin': 'https://music.apple.com'
      }
    })

    const items = res?.results?.songs?.data ?? []
    if (items.length === 0) return this._empty()

    const tracks = items.map(item => this._buildTrack(item)).filter(Boolean) as Track[]
    return { loadType: 'search', data: tracks }
  }

  private _buildTrack(item: any): Track | null {
    const attrs = item.attributes
    if (!attrs) return null

    const info: TrackInfo = {
      identifier: item.id,
      isSeekable: true,
      author: attrs.artistName || 'Unknown Artist',
      length: attrs.durationInMillis || 0,
      isStream: false,
      position: 0,
      title: attrs.name || 'Unknown Title',
      uri: attrs.url,
      artworkUrl: attrs.artwork?.url?.replace('{w}', '600').replace('{h}', '600') || null,
      isrc: attrs.isrc || null,
      sourceName: 'apple',
    }

    return { encoded: encodeTrack(info), info, pluginInfo: {} }
  }

  private _empty(): LoadResult {
    return { loadType: 'empty', data: {} }
  }
}
