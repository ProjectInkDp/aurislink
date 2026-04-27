// src/sources/jiosaavn.ts
// JioSaavn source — metadata search/resolve + direct stream via DES/ECB decryption.
//
// No account or API key required. Uses JioSaavn's public api.php endpoint
// with country-code spoofing (cc=in) to bypass region checks on metadata.
//
// Search prefixes: jssearch:<query>
// URL patterns:   jiosaavn.com/song|album|artist|featured|s/playlist/<id>

import type { Source, LoadResult, Track, TrackInfo, AurisConfig } from '../typings/index.js'
import { httpGet } from '../utils/http.js'
import { encodeTrack } from '../utils/track.js'
import { log } from '../utils/logger.js'
import { decryptJioSaavnUrl } from '../decrypters/des-ecb.js'

const API_BASE = 'https://www.jiosaavn.com/api.php'

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

// Matches: /song/, /album/, /artist/, /featured/, /s/playlist/
const URL_RE = /^https?:\/\/(?:www\.)?jiosaavn\.com\/(song|album|artist|featured|s\/playlist)\/[^/]+\/([A-Za-z0-9_,|-]+)/

const HTML_ENTITY_RE = /&(?:quot|amp|apos);/g
const ENTITY_MAP: Record<string, string> = {
  '&quot;': '"',
  '&amp;': '&',
  '&apos;': "'",
}

const STREAM_CACHE_TTL = 2 * 60 * 60 * 1000  // 2 h
const DEFAULT_PLAYLIST_LIMIT = 50
const DEFAULT_ARTIST_LIMIT = 20

// ─── Internal types ───────────────────────────────────────────────────────────

interface JsSongPayload {
  id?: string | number
  title?: string
  song?: string
  duration?: string | number
  perma_url?: string
  image?: string
  primary_artists?: string
  singers?: string
  encrypted_media_url?: string
  '320kbps'?: string | boolean
  more_info?: {
    duration?: string | number
    music?: string
    artistMap?: {
      primary_artists?: Array<{ name?: string }>
      artists?: Array<{ name?: string }>
    }
  }
}

interface JsSearchResponse {
  results?: JsSongPayload[]
}

interface JsSongDetailsResponse {
  songs?: JsSongPayload[]
  [key: string]: unknown
}

interface JsWebApiResponse {
  title?: string
  name?: string
  songs?: JsSongPayload[]
  list?: JsSongPayload[]
  topSongs?: JsSongPayload[]
}

interface CachedStream {
  url: string
  expiresAt: number
}

// ─── Source ───────────────────────────────────────────────────────────────────

export class JioSaavnSource implements Source {
  readonly name = 'jiosaavn'
  readonly searchPrefixes = ['jssearch']

  private streamCache = new Map<string, CachedStream>()
  private playlistLoadLimit: number
  private artistLoadLimit: number
  private secretKey: string

  constructor(private config: AurisConfig) {
    const js = config.sources.jiosaavn
    this.playlistLoadLimit = js.playlistLoadLimit ?? DEFAULT_PLAYLIST_LIMIT
    this.artistLoadLimit   = js.artistLoadLimit   ?? DEFAULT_ARTIST_LIMIT
    this.secretKey         = js.secretKey         ?? '38346591'
  }

  async setup(): Promise<boolean> {
    log('info', 'JioSaavn', 'Initializing JioSaavn source…')

    const res = await this._apiGet({ __call: 'search.getResults', q: 'test', n: '1' }).catch(() => null)
    if (!res) {
      log('warn', 'JioSaavn', 'Could not reach JioSaavn API — source disabled')
      return false
    }

    const proxyUrl = this.config.sources.jiosaavn.proxy?.url
    if (proxyUrl) log('info', 'JioSaavn', `Proxy active: ${proxyUrl}`)

    log('info', 'JioSaavn', 'JioSaavn source ready')
    return true
  }

  accepts(url: string): boolean {
    return URL_RE.test(url)
  }

  async load(url: string): Promise<LoadResult> {
    const match = URL_RE.exec(url)
    if (!match) return this._empty()

    const rawType = match[1]!
    const id = match[2]!
    const type = rawType === 's/playlist' || rawType === 'featured' ? 'playlist' : rawType

    log('debug', 'JioSaavn', `Resolving ${rawType} → id=${id}`)

    if (type === 'song') {
      const song = await this._fetchSongById(id)
      if (!song) return this._empty()
      const track = this._buildTrack(song)
      return track ? { loadType: 'track', data: track } : this._empty()
    }

    const params: Record<string, string> = {
      __call: 'webapi.get',
      api_version: '4',
      token: id,
      type,
    }
    if (type === 'artist') params.n_song = String(this.artistLoadLimit)
    else params.n = String(this.playlistLoadLimit)

    const data = await this._apiGet(params).catch(() => null)
    const payload = this._toObject(data) as JsWebApiResponse | null
    const list: JsSongPayload[] =
      Array.isArray(payload?.list)     ? payload.list
      : Array.isArray(payload?.topSongs) ? payload.topSongs
      : Array.isArray(payload?.songs)    ? payload.songs
      : []

    const tracks = list.map(s => this._buildTrack(s)).filter(Boolean) as Track[]
    if (tracks.length === 0) return this._empty()

    let name = payload?.title ?? payload?.name ?? 'JioSaavn Collection'
    if (type === 'artist') name = `${name}'s Top Tracks`

    return {
      loadType: 'playlist',
      data: {
        info: { name: this._clean(name), selectedTrack: 0 },
        pluginInfo: {},
        tracks,
      },
    }
  }

  async search(query: string): Promise<LoadResult> {
    query = query.trim()
    if (!query) return this._empty()

    const data = await this._apiGet({
      __call: 'search.getResults',
      q: query,
      n: String(this.config.maxSearchResults),
      includeMetaTags: '1',
    }).catch(() => null)

    const payload = this._toObject(data) as JsSearchResponse | null
    if (!Array.isArray(payload?.results) || payload.results.length === 0) return this._empty()

    const tracks = payload.results.map(s => this._buildTrack(s)).filter(Boolean) as Track[]
    return tracks.length > 0 ? { loadType: 'search', data: tracks } : this._empty()
  }

  // ─── Stream resolution ────────────────────────────────────────────────────

  async resolveStream(identifier: string): Promise<string | null> {
    const cached = this.streamCache.get(identifier)
    if (cached && cached.expiresAt > Date.now()) return cached.url

    const song = await this._fetchSongById(identifier)
    if (!song?.encrypted_media_url) return null

    let url = decryptJioSaavnUrl(song.encrypted_media_url, this.secretKey)

    if (song['320kbps'] === 'true' || song['320kbps'] === true) {
      url = url.replace('_96.mp4', '_320.mp4')
    }

    this.streamCache.set(identifier, { url, expiresAt: Date.now() + STREAM_CACHE_TTL })
    return url
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  private async _apiGet(params: Record<string, string>): Promise<unknown> {
    const proxy = this.config.sources.jiosaavn.proxy
    const qs = new URLSearchParams({
      _format: 'json',
      _marker: '0',
      cc: 'in',
      ctx: 'web6dot0',
      ...params,
    }).toString()

    const res = await httpGet(`${API_BASE}?${qs}`, {
      headers: HEADERS,
      ...(proxy?.url ? { proxy: proxy.url, proxyAuth: proxy.username && proxy.password
        ? `${proxy.username}:${proxy.password}`
        : undefined
      } : {}),
    })

    if (!res || res.status >= 400) throw new Error(`JioSaavn API ${res?.status ?? 'unreachable'}`)

    try {
      return JSON.parse(res.body)
    } catch {
      throw new Error('JioSaavn API returned non-JSON')
    }
  }

  private async _fetchSongById(id: string): Promise<JsSongPayload | null> {
    const data = await this._apiGet({ __call: 'song.getDetails', pids: id }).catch(() => null)
    const details = this._toObject(data) as JsSongDetailsResponse | null

    if (details) {
      const byId = this._toObject(details[id]) as JsSongPayload | null
      if (byId?.id) return byId
      const first = Array.isArray(details.songs) ? details.songs[0] : null
      if (first?.id) return first as JsSongPayload
    }

    // Fallback
    const fallback = await this._apiGet({
      __call: 'webapi.get',
      api_version: '4',
      token: id,
      type: 'song',
    }).catch(() => null)

    const wb = this._toObject(fallback) as JsWebApiResponse | null
    return Array.isArray(wb?.songs) ? (wb.songs[0] ?? null) : null
  }

  private _buildTrack(s: JsSongPayload): Track | null {
    if (!s?.id) return null

    const id = String(s.id)

    const primaryArtists = s.more_info?.artistMap?.primary_artists
    const allArtists = s.more_info?.artistMap?.artists
    const artistList = Array.isArray(primaryArtists) && primaryArtists.length > 0
      ? primaryArtists
      : Array.isArray(allArtists) && allArtists.length > 0 ? allArtists : null

    const author = artistList
      ? this._clean(artistList.map(a => a.name ?? '').filter(Boolean).join(', '))
      : this._clean(s.more_info?.music ?? s.primary_artists ?? s.singers ?? 'Unknown Artist')

    const durationSec = parseInt(String(s.more_info?.duration ?? s.duration ?? '0'), 10)
    const artworkUrl = typeof s.image === 'string'
      ? s.image.replace('150x150', '500x500')
      : null

    const info: TrackInfo = {
      identifier: id,
      isSeekable: true,
      author,
      length: isFinite(durationSec) ? durationSec * 1000 : 0,
      isStream: false,
      position: 0,
      title: this._clean(s.title ?? s.song ?? 'Unknown Title'),
      uri: s.perma_url ?? `https://www.jiosaavn.com/song/-/${id}`,
      artworkUrl,
      isrc: null,
      sourceName: 'jiosaavn',
    }

    return { encoded: encodeTrack(info), info, pluginInfo: {} }
  }

  private _clean(value: string): string {
    if (!value) return ''
    return value.replace(HTML_ENTITY_RE, tag => ENTITY_MAP[tag] ?? tag).trim()
  }

  private _toObject(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  private _empty(): LoadResult {
    return { loadType: 'empty', data: {} }
  }
}
