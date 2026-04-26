// src/sources/deezer.ts
// Deezer source — metadata search/resolve + optional full-stream decryption.
//
// Without ARL: search and resolve work via the public Deezer API (metadata only).
// With ARL + decryptionKey: full Blowfish-CBC stream decryption is available.
//
// Search prefixes: dzsearch:<query>
// URL patterns:   deezer.com/track|album|playlist|artist/<id>

import crypto from 'node:crypto'
import { PassThrough } from 'node:stream'
import type { Source, LoadResult, Track, TrackInfo, AurisConfig } from '../typings/index.js'
import { httpGet, httpGetJson } from '../utils/http.js'
import { encodeTrack } from '../utils/track.js'
import { log } from '../utils/logger.js'
import BlowfishCBC from '../decrypters/blowfish-cbc.js'

// Static IV used by Deezer's Blowfish-CBC chunk decryption scheme.
const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7])

const CHUNK_SIZE = 2048
const TRACK_CACHE_TTL = 4 * 60 * 60 * 1000   // 4 h
const CREDENTIAL_TTL = 24 * 60 * 60 * 1000   // 24 h

const ISRC_RE = /^(?:isrc:)?([A-Z]{2}-?[A-Z0-9]{3}-?\d{2}-?\d{5})$/i

const URL_RE = /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]+(?:-[a-z]+)?\/)?  (track|album|playlist|artist)\/(\d+)(?:\?.*)?$/

// ─── Internal types ───────────────────────────────────────────────────────────

interface DzTrack {
  id: number | string
  title?: string
  duration?: number | string
  link?: string
  artwork_url?: string
  isrc?: string
  artist?: { id?: number | string; name?: string; picture_xl?: string }
  album?: { id?: number | string; title?: string; cover_xl?: string; cover_big?: string; cover_medium?: string }
  readable?: boolean
  preview?: string
}

interface DzPlaylist {
  id: number | string
  title?: string
  tracklist?: string
  cover_xl?: string
  picture_xl?: string
  nb_tracks?: number
}

interface CachedStream {
  url: string
  format: 'mp3' | 'flac'
  expiresAt: number
}

interface GatewayTrack {
  SNG_ID?: string | number
  TRACK_TOKEN?: string
  FILESIZE?: string | number
  DURATION?: string | number
}

// ─── Source ───────────────────────────────────────────────────────────────────

export class DeezerSource implements Source {
  readonly name = 'deezer'
  readonly searchPrefixes = ['dzsearch']

  private cookie: string | null = null
  private csrfToken: string | null = null
  private licenseToken: string | null = null
  private streamCache = new Map<string, CachedStream>()
  private credentialExpiresAt = 0

  constructor(private config: AurisConfig) {}

  async setup(): Promise<boolean> {
    log('info', 'Deezer', 'Initializing Deezer source…')

    const arl = this.config.sources.deezer.arl
    const initialCookie = typeof arl === 'string' && arl.length > 0 ? `arl=${arl}` : ''

    const url = 'https://www.deezer.com/ajax/gw-light.php?method=deezer.getUserData&input=3&api_version=1.0&api_token='
    const res = await httpGet(url, {
      headers: initialCookie ? { Cookie: initialCookie } : {},
    })

    if (!res || res.status >= 400) {
      log('warn', 'Deezer', 'Could not reach Deezer gateway — metadata-only mode')
      return true  // still usable for public API search
    }

    let userData: Record<string, unknown> | null = null
    try { userData = JSON.parse(res.body) } catch { /* ignore */ }

    const results = (userData as { results?: Record<string, unknown> } | null)?.results
    if (!results) {
      log('warn', 'Deezer', 'getUserData returned no results — metadata-only mode')
      return true
    }

    const rawCookies = res.headers['set-cookie']
    const cookieStr = Array.isArray(rawCookies) ? rawCookies.join('; ') : (rawCookies ?? '')
    this.cookie = initialCookie ? (cookieStr ? `${initialCookie}; ${cookieStr}` : initialCookie) : cookieStr || null
    this.csrfToken = (results as { checkForm?: string }).checkForm ?? null
    this.licenseToken = ((results as { USER?: { OPTIONS?: { license_token?: string } } }).USER?.OPTIONS?.license_token) ?? null
    this.credentialExpiresAt = Date.now() + CREDENTIAL_TTL

    if (this.cookie && this.csrfToken && this.licenseToken) {
      log('info', 'Deezer', 'Gateway credentials loaded — full-stream mode active')
    } else {
      log('info', 'Deezer', 'Partial credentials — metadata-only mode')
    }

    return true
  }

  accepts(url: string): boolean {
    return URL_RE.test(url) || url.includes('link.deezer.com')
  }

  async load(url: string): Promise<LoadResult> {
    const match = URL_RE.exec(url)
    if (!match) return this._empty()

    const type = match[1] as 'track' | 'album' | 'playlist' | 'artist'
    const id = match[2]!

    const res = await httpGetJson<{ error?: { code?: number; message?: string }; tracklist?: string; data?: DzTrack[]; tracks?: { data?: DzTrack[] }; title?: string; cover_xl?: string; picture_xl?: string; name?: string } & DzTrack>(
      `https://api.deezer.com/2.0/${type}/${id}`
    )
    if (!res || res.error) return this._empty()

    if (type === 'track') {
      const track = this._buildTrack(res as unknown as DzTrack)
      return track ? { loadType: 'track', data: track } : this._empty()
    }

    if (type === 'album' || type === 'playlist') {
      if (!res.tracklist) return this._empty()
      const list = await httpGetJson<{ data?: DzTrack[] }>(`${res.tracklist}?limit=100`)
      const tracks = (list?.data ?? []).map(t => this._buildTrack(t)).filter(Boolean) as Track[]
      if (tracks.length === 0) return this._empty()
      return {
        loadType: type === 'album' ? 'playlist' : 'playlist',
        data: {
          info: { name: res.title ?? 'Deezer Collection', selectedTrack: 0 },
          pluginInfo: {},
          tracks,
        },
      }
    }

    if (type === 'artist') {
      const top = await httpGetJson<{ data?: DzTrack[] }>(`https://api.deezer.com/2.0/artist/${id}/top?limit=25`)
      const tracks = (top?.data ?? []).map(t => this._buildTrack(t)).filter(Boolean) as Track[]
      if (tracks.length === 0) return this._empty()
      return {
        loadType: 'playlist',
        data: {
          info: { name: `${(res as unknown as { name?: string }).name ?? 'Artist'}'s Top Tracks`, selectedTrack: 0 },
          pluginInfo: {},
          tracks,
        },
      }
    }

    return this._empty()
  }

  async search(query: string): Promise<LoadResult> {
    query = query.trim()
    if (!query) return this._empty()

    // ISRC lookup
    const isrcMatch = query.match(ISRC_RE)
    if (isrcMatch) {
      const isrc = isrcMatch[1]!.replace(/-/g, '').toUpperCase()
      const track = await httpGetJson<DzTrack & { error?: unknown }>(`https://api.deezer.com/2.0/track/isrc:${isrc}`)
      if (track && !track.error) {
        const built = this._buildTrack(track)
        return built ? { loadType: 'search', data: [built] } : this._empty()
      }
    }

    const res = await httpGetJson<{ data?: DzTrack[]; total?: number }>(`https://api.deezer.com/2.0/search/track?q=${encodeURIComponent(query)}`)
    const items = (res?.data ?? []).slice(0, this.config.maxSearchResults)
    if (items.length === 0) return this._empty()

    const tracks = items
      .filter(t => t.readable !== false)
      .map(t => this._buildTrack(t))
      .filter(Boolean) as Track[]

    return tracks.length > 0 ? { loadType: 'search', data: tracks } : this._empty()
  }

  // ─── Stream resolution (requires ARL + decryptionKey) ────────────────────

  async resolveStream(identifier: string): Promise<{ stream: PassThrough } | null> {
    if (!this.cookie || !this.csrfToken || !this.licenseToken) return null

    // Credential refresh
    if (Date.now() > this.credentialExpiresAt) await this.setup()

    const cached = this.streamCache.get(identifier)
    if (cached && cached.expiresAt > Date.now() + 10_000) {
      return this._decryptStream(identifier, cached.url)
    }

    // Fetch track token from gateway
    const gatewayUrl = `https://www.deezer.com/ajax/gw-light.php?method=song.getListData&input=3&api_version=1.0&api_token=${this.csrfToken}`
    const tokenRes = await httpGet(gatewayUrl, {
      method: 'POST',
      headers: { Cookie: this.cookie!, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sng_ids: [identifier] }),
    })
    if (!tokenRes) return null

    let tokenData: { results?: { data?: GatewayTrack[] } } | null = null
    try { tokenData = JSON.parse(tokenRes.body) } catch { return null }

    const trackInfo = tokenData?.results?.data?.[0]
    if (!trackInfo?.TRACK_TOKEN) return null

    // Fetch stream URL from media API
    const mediaRes = await httpGetJson<{ data?: Array<{ media?: Array<{ format?: string; sources?: Array<{ url?: string }> }> }> }>(
      'https://media.deezer.com/v1/get_url',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          license_token: this.licenseToken,
          media: [{
            type: 'FULL',
            formats: [
              { cipher: 'BF_CBC_STRIPE', format: 'FLAC' },
              { cipher: 'BF_CBC_STRIPE', format: 'MP3_256' },
              { cipher: 'BF_CBC_STRIPE', format: 'MP3_128' },
            ],
          }],
          track_tokens: [trackInfo.TRACK_TOKEN],
        }),
      }
    )

    const media = mediaRes?.data?.[0]?.media?.[0]
    const streamUrl = media?.sources?.[0]?.url
    if (!streamUrl) return null

    const format = (media?.format ?? '').startsWith('MP3') ? 'mp3' : 'flac'
    this.streamCache.set(identifier, { url: streamUrl, format, expiresAt: Date.now() + TRACK_CACHE_TTL })

    return this._decryptStream(identifier, streamUrl)
  }

  private _decryptStream(songId: string, url: string): { stream: PassThrough } | null {
    const key = this.config.sources.deezer.decryptionKey
    if (typeof key !== 'string' || key.length !== 16) {
      log('warn', 'Deezer', 'decryptionKey missing or not 16 chars — stream unavailable')
      return null
    }

    const trackKey = this._calculateKey(songId, key)
    const output = new PassThrough()
    const blowfish = new BlowfishCBC(trackKey)

    httpGet(url).then(res => {
      if (!res || res.status >= 400) {
        output.destroy(new Error(`Stream request failed (${res?.status ?? 'null'})`))
        return
      }

      const raw = Buffer.from(res.body, 'binary')
      let chunkIndex = 0
      let offset = 0

      while (offset + CHUNK_SIZE <= raw.length) {
        const block = raw.subarray(offset, offset + CHUNK_SIZE)
        if (chunkIndex % 3 === 0) {
          blowfish.setIv(IV)
          output.push(Buffer.from(blowfish.decode(block)))
        } else {
          output.push(block)
        }
        chunkIndex++
        offset += CHUNK_SIZE
      }

      if (offset < raw.length) output.push(raw.subarray(offset))
      output.end()
    }).catch(err => output.destroy(err as Error))

    return { stream: output }
  }

  private _calculateKey(songId: string, secret: string): Buffer {
    const hash = crypto.createHash('md5').update(String(songId), 'ascii').digest('hex')
    const key = Buffer.alloc(16)
    for (let i = 0; i < 16; i++) {
      key[i] = (hash.charCodeAt(i) ^ hash.charCodeAt(i + 16) ^ secret.charCodeAt(i))
    }
    return key
  }

  // ─── Track builder ────────────────────────────────────────────────────────

  private _buildTrack(t: DzTrack): Track | null {
    if (t.id === undefined || t.id === null) return null

    const dur = typeof t.duration === 'string' ? parseInt(t.duration, 10) : (t.duration ?? 0)
    const info: TrackInfo = {
      identifier: String(t.id),
      isSeekable: true,
      author: t.artist?.name?.trim() || 'Unknown Artist',
      length: isFinite(dur) ? dur * 1000 : 0,
      isStream: false,
      position: 0,
      title: t.title?.trim() || 'Unknown Title',
      uri: t.link || `https://www.deezer.com/track/${t.id}`,
      artworkUrl: t.album?.cover_xl ?? t.album?.cover_big ?? t.album?.cover_medium ?? null,
      isrc: t.isrc ?? null,
      sourceName: 'deezer',
    }

    const pluginInfo: Record<string, unknown> = {}
    if (t.album?.title?.trim()) pluginInfo.albumName = t.album.title.trim()
    if (t.album?.id) pluginInfo.albumUrl = `https://www.deezer.com/album/${t.album.id}`
    if (t.artist?.id) pluginInfo.artistUrl = `https://www.deezer.com/artist/${t.artist.id}`
    if (t.artist?.picture_xl) pluginInfo.artistArtworkUrl = t.artist.picture_xl
    if (t.preview) pluginInfo.previewUrl = t.preview

    return { encoded: encodeTrack(info), info, pluginInfo }
  }

  private _empty(): LoadResult {
    return { loadType: 'empty', data: {} }
  }
}
