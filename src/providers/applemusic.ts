// src/providers/applemusic.ts
// AurisLink Apple Music Source Manager
// Implements track, album, and playlist loading via Apple Music's public web API.

import { log } from '../shared/reporter.js'
import { httpGet, httpGetJson } from '../shared/http.js'
import { encodeTrack } from '../shared/media.js'
import type { Source, LoadResult, Track, TrackInfo, AurisConfig } from '../typings/index.js'

const APPLE_MUSIC_API = 'https://amp-api.music.apple.com/v1'
const SEARCH_PREFIXES = ['amsearch', 'applesearch']

export class AppleMusicSource implements Source {
  public readonly name = 'applemusic'
  public readonly searchPrefixes = SEARCH_PREFIXES

  private token: string | null = null
  private tokenExpiry = 0

  constructor(private config: AurisConfig) {}

  async setup(): Promise<boolean> {
    if (!this.config.sources.applemusic?.enabled) return false
    log('info', 'AppleMusic', 'Apple Music source initialized')
    return true
  }

  accepts(url: string): boolean {
    return (
      url.includes('music.apple.com') ||
      SEARCH_PREFIXES.some(p => url.startsWith(p))
    )
  }

  async load(url: string): Promise<LoadResult> {
    try {
      if (url.startsWith('amsearch:') || url.startsWith('apple:')) {
        const query = url.split(':').slice(1).join(':')
        return this.search(query)
      }

      const parsed = new URL(url)
      const path = parsed.pathname
      const parts = path.split('/').filter(Boolean)

      const market = parts[0] || 'br'
      const type = parts[1]
      const id = parts[parts.length - 1]

      if (type === 'album') return this._loadAlbum(market, id)
      if (type === 'playlist') return this._loadPlaylist(market, id)
      if (type === 'song' || type === 'track') return this._loadTrack(market, id)

      return _empty()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return _error(`Failed to load Apple Music URL: ${msg}`, 'common')
    }
  }

  async search(query: string): Promise<LoadResult> {
    const market = this.config.sources.applemusic?.market?.toLowerCase() || 'br'
    const limit = this.config.maxSearchResults || 10
    
    const token = await this._getGuestToken()
    if (!token) return _error('Failed to obtain Apple Music guest token', 'fault')

    const url = `${APPLE_MUSIC_API}/catalog/${market}/search?term=${encodeURIComponent(query)}&limit=${limit}&types=songs`
    const res = await httpGetJson<any>(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://music.apple.com' } })

    const items = res?.results?.songs?.data || []
    if (items.length === 0) return _empty()

    const tracks = items.map((it: any) => this._buildTrack(it)).filter(Boolean) as Track[]
    return { loadType: 'search', data: tracks }
  }

  private async _loadTrack(market: string, id: string): Promise<LoadResult> {
    const token = await this._getGuestToken()
    if (!token) return _error('Failed to obtain Apple Music guest token', 'fault')

    const url = `${APPLE_MUSIC_API}/catalog/${market}/songs/${id}`
    const res = await httpGetJson<any>(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://music.apple.com' } })

    const data = res?.data?.[0]
    if (!data) return _empty()

    const track = this._buildTrack(data)
    return track ? { loadType: 'track', data: track } : _empty()
  }

  private async _loadAlbum(market: string, id: string): Promise<LoadResult> {
    const token = await this._getGuestToken()
    if (!token) return _error('Failed to obtain Apple Music guest token', 'fault')

    const url = `${APPLE_MUSIC_API}/catalog/${market}/albums/${id}`
    const res = await httpGetJson<any>(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://music.apple.com' } })

    const album = res?.data?.[0]
    if (!album) return _empty()

    const tracks = album.relationships?.tracks?.data?.map((it: any) => this._buildTrack(it)).filter(Boolean) || []
    return {
      loadType: 'playlist',
      data: {
        info: { name: album.attributes.name, selectedTrack: -1 },
        pluginInfo: {},
        tracks
      }
    }
  }

  private async _loadPlaylist(market: string, id: string): Promise<LoadResult> {
    const token = await this._getGuestToken()
    if (!token) return _error('Failed to obtain Apple Music guest token', 'fault')

    const url = `${APPLE_MUSIC_API}/catalog/${market}/playlists/${id}`
    const res = await httpGetJson<any>(url, { headers: { Authorization: `Bearer ${token}`, Origin: 'https://music.apple.com' } })

    const playlist = res?.data?.[0]
    if (!playlist) return _empty()

    const tracks = playlist.relationships?.tracks?.data?.map((it: any) => this._buildTrack(it)).filter(Boolean) || []
    return {
      loadType: 'playlist',
      data: {
        info: { name: playlist.attributes.name, selectedTrack: -1 },
        pluginInfo: {},
        tracks
      }
    }
  }

  private _buildTrack(data: any): Track | null {
    if (!data?.attributes) return null
    const attr = data.attributes
    const info: TrackInfo = {
      identifier: data.id,
      isSeekable: true,
      author: attr.artistName,
      length: attr.durationInMillis || 0,
      isStream: false,
      position: 0,
      title: attr.name,
      uri: attr.url,
      artworkUrl: attr.artwork?.url?.replace('{w}', '500').replace('{h}', '500') || null,
      isrc: attr.isrc || null,
      sourceName: 'applemusic'
    }
    return { encoded: encodeTrack(info), info, pluginInfo: {} }
  }

  private async _getGuestToken(): Promise<string | null> {
    if (this.token && Date.now() < this.tokenExpiry) return this.token

    try {
      const res = await httpGet('https://music.apple.com/br/new')
      if (!res) return null
      
      const jsMatch = /\/assets\/index~[a-z0-9]+\.js/.exec(res.body)
      if (jsMatch) {
        const jsUrl = `https://music.apple.com${jsMatch[0]}`
        const jsRes = await httpGet(jsUrl)
        if (jsRes) {
          const tokenMatch = /ey[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(jsRes.body)
          if (tokenMatch) {
            this.token = tokenMatch[0]
            this.tokenExpiry = Date.now() + 3600000
            return this.token
          }
        }
      }
      
      log('warn', 'AppleMusic', 'Failed to scrape guest token')
      return null
    } catch (err) {
      log('error', 'AppleMusic', `Token fetch error: ${err}`)
      return null
    }
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
function _error(message: string, severity: 'common' | 'suspicious' | 'fault'): LoadResult {
  return { loadType: 'error', data: { message, severity, cause: 'AppleMusic' } }
}
