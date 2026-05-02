// src/sources/soundcloud.ts
// AurisLink SoundCloud source.
// Zero config required — client_id is auto-detected from the SoundCloud web app.
// Improvements over initial research:
//   • Single-pass asset scraping (fetches all candidate assets in parallel, stops at first hit)
//   • Automatic client_id refresh on 401 instead of requiring restart
//   • In-memory URL cache with expiry check (no external credential manager needed)
//   • Transcoding priority prefers progressive MP3 > progressive AAC > HLS AAC HQ > HLS AAC > any
//   • Clean TypeScript with no internal class dependencies

import { PassThrough } from 'node:stream'
import type { Source, LoadResult, Track, TrackInfo } from '../typings/index.js'
import { httpGet, httpGetJson, httpStream } from '../shared/http.js'
import { encodeTrack } from '../shared/media.js'
import { log } from '../shared/reporter.js'

// ─── Constants ────────────────────────────────────────────────────────────────

const SC_URL = 'https://soundcloud.com'
const API_URL = 'https://api-v2.soundcloud.com'
const ASSET_RE = /https:\/\/a-v2\.sndcdn\.com\/assets\/[a-zA-Z0-9-]+\.js/g
const CLIENT_ID_RE = /(?:[?&\/]?(?:client_id)[\s:=&]*"?|"data":{"id":")([A-Za-z0-9]{32})"?|client_id:["']([a-zA-Z0-9]{32})["']/

// Patterns for URL matching
const TRACK_URL_RE = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[^/\s]+\/(?!sets\/)[^/\s]+(?:\?.*)?$/
const PLAYLIST_URL_RE = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[^/\s]+\/sets\/[^/\s]+(?:\?.*)?$/
const USER_URL_RE = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/[^/\s]+\/?(?:\?.*)?$/

// How long a resolved stream URL stays cached (SoundCloud CDN URLs expire around 30m)
const STREAM_CACHE_TTL = 15 * 60 * 1000 // 15 minutes

// ─── Internal types ───────────────────────────────────────────────────────────

interface SCUser {
  id: number
  username: string
  permalink_url: string
  avatar_url: string | null
  followers_count: number
  track_count: number
}

interface SCTrack {
  id: number
  kind: 'track'
  title: string
  duration: number
  permalink_url: string
  artwork_url: string | null
  user: SCUser
  publisher_metadata?: { isrc?: string }
  media?: { transcodings: SCTranscoding[] }
  // Legacy HLS fields (still present on some tracks)
  hls_aac_160_url?: string
  hls_aac_96_url?: string
}

interface SCPlaylist {
  id: number
  kind: 'playlist'
  title: string
  permalink_url: string
  artwork_url: string | null
  user: SCUser
  is_album: boolean
  track_count: number
  tracks: Array<SCTrack | { id: number }>
}

interface SCTranscoding {
  url: string
  quality?: string
  preset?: string
  format?: { protocol: 'hls' | 'progressive'; mime_type: string }
}

interface CachedStream {
  url: string
  protocol: 'hls' | 'progressive'
  format: string
  expiresAt: number
}

// ─── Source ───────────────────────────────────────────────────────────────────

export class SoundCloudSource implements Source {
  readonly name = 'soundcloud'
  readonly searchPrefixes = ['scsearch']

  private clientId: string | null = null
  private streamCache = new Map<string, CachedStream>()
  private maxResults = 10
  private maxPlaylist = 100

  constructor(opts?: { clientId?: string; maxResults?: number; maxPlaylistLength?: number }) {
    if (opts?.clientId)       this.clientId = opts.clientId
    if (opts?.maxResults)     this.maxResults = opts.maxResults
    if (opts?.maxPlaylistLength) this.maxPlaylist = opts.maxPlaylistLength
  }

  // ─── Setup ─────────────────────────────────────────────────────────────────

  async setup(): Promise<boolean> {
    if (this.clientId) {
      log('info', 'SoundCloud', `Using provided client_id (${this.clientId})`)
      return true
    }

    return this._fetchClientId()
  }

  /** Auto-scrapes the SoundCloud web app to extract the API client_id. */
  private async _fetchClientId(): Promise<boolean> {
    log('info', 'SoundCloud', 'Fetching client_id from soundcloud.com…')

    const page = await httpGet(SC_URL, { headers: { 'accept-language': 'en-US,en;q=0.9' } })
    if (!page) {
      log('error', 'SoundCloud', 'Request to soundcloud.com returned null (network error)')
      return false
    }
    if (page.status >= 400) {
      log('error', 'SoundCloud', `soundcloud.com returned HTTP ${page.status}`)
      return false
    }

    log('info', 'SoundCloud', `soundcloud.com responded HTTP ${page.status}, body: ${page.body.length} chars`)

    // Fast path: client_id sometimes appears directly in the main page HTML
    const directMatch = page.body.match(CLIENT_ID_RE)
    if (directMatch?.[1]) {
      this.clientId = directMatch[1]
      log('info', 'SoundCloud', `client_id found directly in main page (${this.clientId})`)
      return true
    }

    log('info', 'SoundCloud', 'client_id not in main page, scanning JS assets…')

    // Slow path: find all JS asset URLs and race them for the first client_id
    const assetUrls = [...new Set([...page.body.matchAll(ASSET_RE)].map(m => m[0]))]
    log('info', 'SoundCloud', `Found ${assetUrls.length} asset URL(s) to scan`)

    if (assetUrls.length === 0) {
      log('error', 'SoundCloud', `No asset URLs found. Page snippet: ${page.body.slice(0, 500)}`)
      return false
    }

    try {
      const id = await Promise.any(
        assetUrls.map(async (url): Promise<string> => {
          const res = await httpGet(url)
          if (!res || res.status >= 400) throw new Error(`fetch failed (${res?.status ?? 'null'})`)
          const m = res.body.match(CLIENT_ID_RE)
          if (!m?.[1]) throw new Error('not found in asset')
          return m[1]
        })
      )

      this.clientId = id
      log('info', 'SoundCloud', `client_id found in assets (${this.clientId})`)
      return true
    } catch {
      log('error', 'SoundCloud', 'client_id not found in any asset')
      return false
    }
  }

  // ─── Source interface ───────────────────────────────────────────────────────

  accepts(url: string): boolean {
    return TRACK_URL_RE.test(url) || PLAYLIST_URL_RE.test(url)
  }

  async load(url: string): Promise<LoadResult> {
    const resolved = await this._resolve(url)
    return resolved
  }

  async search(query: string): Promise<LoadResult> {
    return this._search(query.trim())
  }

  // ─── Resolve URL ───────────────────────────────────────────────────────────

  private async _resolve(url: string): Promise<LoadResult> {
    const apiUrl = `${API_URL}/resolve?${this._params({ url })}`
    const data = await this._apiGet<SCTrack | SCPlaylist>(apiUrl)

    if (!data) return this._empty()

    if (data.kind === 'track')    return { loadType: 'track', data: this._buildTrack(data) }
    if (data.kind === 'playlist') return this._buildPlaylist(data)

    return this._empty()
  }

  // ─── Search ────────────────────────────────────────────────────────────────

  private async _search(query: string): Promise<LoadResult> {
    if (!query) return this._error('Query is empty', 'common')

    const data = await this._apiGet<{ collection: SCTrack[] }>(
      `${API_URL}/search/tracks?${this._params({ q: query, limit: String(this.maxResults) })}`
    )

    if (!data?.collection?.length) return this._empty()

    const tracks = data.collection
      .filter(t => t.kind === 'track')
      .slice(0, this.maxResults)
      .map(t => this._buildTrack(t))

    return { loadType: 'search', data: tracks }
  }

  // ─── Playlist ──────────────────────────────────────────────────────────────

  private async _buildPlaylist(pl: SCPlaylist): Promise<LoadResult> {
    // SoundCloud returns full track objects only for the first ~5 tracks.
    // Remaining entries only have { id }. We batch-fetch the rest.
    const full: SCTrack[] = []
    const missingIds: number[] = []

    for (const t of pl.tracks ?? []) {
      if ('title' in t) full.push(t as SCTrack)
      else missingIds.push((t as { id: number }).id)
    }

    const limit = this.maxPlaylist
    const needed = missingIds.slice(0, Math.max(0, limit - full.length))

    if (needed.length > 0) {
      const CHUNK = 50
      const chunks: number[][] = []
      for (let i = 0; i < needed.length; i += CHUNK) chunks.push(needed.slice(i, i + CHUNK))

      const fetched = await Promise.all(
        chunks.map(ids =>
          this._apiGet<SCTrack[]>(`${API_URL}/tracks?${this._params({ ids: ids.join(',') })}`).then(r => r ?? [])
        )
      )

      for (const batch of fetched) full.push(...batch)
    }

    const tracks = full.slice(0, limit).map(t => this._buildTrack(t))

    return {
      loadType: 'playlist',
      data: {
        info:       { name: pl.title || 'Untitled', selectedTrack: 0 },
        pluginInfo: { type: pl.is_album ? 'album' : 'playlist', trackCount: pl.track_count },
        tracks,
      },
    }
  }

  // ─── Track builder ─────────────────────────────────────────────────────────

  private _buildTrack(t: SCTrack): Track {
    const info: TrackInfo = {
      identifier: String(t.id),
      isSeekable: true,
      author:     t.user?.username ?? 'Unknown',
      length:     t.duration ?? 0,
      isStream:   false,
      position:   0,
      title:      t.title ?? 'Unknown',
      uri:        t.permalink_url ?? null,
      artworkUrl: t.artwork_url ?? null,
      isrc:       t.publisher_metadata?.isrc ?? null,
      sourceName: 'soundcloud',
    }

    return { encoded: encodeTrack(info), info, pluginInfo: {} }
  }

  // ─── Stream URL resolution ─────────────────────────────────────────────────
  //
  // Called by the player when it needs the actual audio stream for a track.
  // Returns the raw URL + format so the player can pipe it correctly.

  async resolveStream(identifier: string): Promise<CachedStream | null> {
    // Return from cache if still valid
    const cached = this.streamCache.get(identifier)
    if (cached && cached.expiresAt > Date.now() + 10_000) {
      log('debug', 'SoundCloud', `Stream cache hit for ${identifier}`)
      return cached
    }

    // Re-fetch the track to get fresh transcodings
    const data = await this._apiGet<SCTrack>(
      `${API_URL}/resolve?${this._params({ url: `https://api.soundcloud.com/tracks/${identifier}` })}`
    )

    if (!data) {
      // 401 = client_id expired → refresh and retry once
      log('warn', 'SoundCloud', 'Stream resolve failed, refreshing client_id…')
      const ok = await this._fetchClientId()
      if (!ok) return null

      const retry = await this._apiGet<SCTrack>(
        `${API_URL}/resolve?${this._params({ url: `https://api.soundcloud.com/tracks/${identifier}` })}`
      )
      if (!retry) return null

      return this._resolveTranscoding(identifier, retry)
    }

    return this._resolveTranscoding(identifier, data)
  }

  private async _resolveTranscoding(identifier: string, track: SCTrack): Promise<CachedStream | null> {
    const transcodings: SCTranscoding[] = [...(track.media?.transcodings ?? [])]

    // Inject legacy HLS fields if the modern array is empty
    if (transcodings.length === 0) {
      if (track.hls_aac_160_url)
        transcodings.push({ url: track.hls_aac_160_url, quality: 'hq', format: { protocol: 'hls', mime_type: 'audio/aac' } })
      if (track.hls_aac_96_url)
        transcodings.push({ url: track.hls_aac_96_url, quality: 'sq', format: { protocol: 'hls', mime_type: 'audio/aac' } })
    }

    if (transcodings.length === 0) {
      log('warn', 'SoundCloud', `No transcodings for track ${identifier}`)
      return null
    }

    // Priority order (best quality first, prefer progressive to avoid HLS overhead)
    const pick = (
      transcodings.find(t => t.format?.protocol === 'progressive' && t.format.mime_type.includes('mpeg')) ??
      transcodings.find(t => t.format?.protocol === 'progressive' && t.format.mime_type.includes('aac')) ??
      transcodings.find(t => t.format?.protocol === 'hls' && (t.quality === 'hq' || t.preset?.includes('160'))) ??
      transcodings.find(t => t.format?.protocol === 'hls' && t.format.mime_type.includes('aac')) ??
      transcodings.find(t => t.format?.protocol === 'progressive') ??
      transcodings.find(t => t.format?.protocol === 'hls') ??
      transcodings[0]!
    )

    // Resolve the CDN URL from SoundCloud's auth endpoint
    const authUrl = `${pick.url}?client_id=${this.clientId}`
    const res = await httpGetJson<{ url?: string }>(authUrl)

    const cdnUrl = res?.url ?? null
    if (!cdnUrl) {
      log('warn', 'SoundCloud', `Could not resolve CDN URL for track ${identifier}`)
      return null
    }

    if (cdnUrl.includes('/preview/') || cdnUrl.includes('cf-preview-media')) {
      log('warn', 'SoundCloud', `Track ${identifier} only has a preview URL`)
      return null
    }

    const protocol = pick.format?.protocol ?? 'progressive'
    const mime = pick.format?.mime_type?.toLowerCase() ?? ''
    const format = mime.includes('mpeg') ? 'mp3' : mime.includes('aac') ? 'aac' : mime.includes('opus') ? 'opus' : 'audio'

    const entry: CachedStream = {
      url:       cdnUrl,
      protocol,
      format,
      expiresAt: Date.now() + STREAM_CACHE_TTL,
    }

    this.streamCache.set(identifier, entry)
    return entry
  }

  // ─── Progressive stream helper (for player use) ────────────────────────────

  createProgressiveStream(url: string): PassThrough {
    const pass = new PassThrough()

    httpStream(url).then(body => {
      if (!body) { pass.destroy(new Error('Failed to open stream')); return }

      body.on('data', chunk => { if (!pass.write(chunk)) body.pause() })
      body.on('drain', () => body.resume())
      body.on('end', () => pass.end())
      body.on('error', err => pass.destroy(err))
    })

    return pass
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Build URLSearchParams with client_id automatically appended. */
  private _params(extra: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ client_id: this.clientId ?? '', ...extra })
  }

  /** GET → JSON with automatic 401 handling (client_id refresh). */
  private async _apiGet<T>(url: string): Promise<T | null> {
    const res = await httpGet(url)
    if (!res) return null

    // 401 means our client_id expired; caller decides whether to retry
    if (res.status === 401 || res.status === 403) return null
    if (res.status === 404) return null
    if (res.status >= 400) {
      log('warn', 'SoundCloud', `API returned ${res.status} for ${url}`)
      return null
    }

    try {
      return JSON.parse(res.body) as T
    } catch {
      log('warn', 'SoundCloud', `JSON parse error for ${url}`)
      return null
    }
  }

  // ─── Result builders ────────────────────────────────────────────────────────

  private _empty(): LoadResult {
    return { loadType: 'empty', data: {} }
  }

  private _error(message: string, severity: 'common' | 'suspicious' | 'fault' = 'fault'): LoadResult {
    return { loadType: 'error', data: { message, severity, cause: 'SoundCloud' } }
  }
}
