// src/lyrics/yandexmusic.ts
// Yandex Music lyrics provider — fetches synced / plain-text lyrics using the
// Yandex Music Android API. Requires a valid OAuth2 access token configured
// via `lyrics.yandexmusic.accessToken` in config.ts.
//
// The signing logic (HMAC-SHA256 + Android sign key) is required by the Yandex
// API and is a standard implementation pattern for this endpoint.

import crypto from 'node:crypto'
import { httpGetJson } from '../utils/http.js'
import { log } from '../utils/logger.js'
import type { LyricsResult } from '../typings/index.js'
import type TokenStore from '../core/TokenStore.js'

// ─── Internal constants ───────────────────────────────────────────────────────

const YANDEX_API_BASE  = 'https://api.music.yandex.net'
const YANDEX_UA        = 'Yandex-Music-API'
const YANDEX_CLIENT_HDR = 'YandexMusicAndroid/24023621'
const SIGN_SECRET      = 'p93jhgh689SBReK6ghtw62'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the HMAC-SHA256 request signature expected by the Yandex Music
 * Android lyrics endpoint.
 *
 * @param trackId  - Yandex Music numeric track identifier.
 * @param timestamp - Unix timestamp (seconds) used for replay-protection.
 * @returns Lowercase hex digest string.
 */
function buildSignature(trackId: string, timestamp: number): string {
  const payload = `${trackId}${timestamp}${SIGN_SECRET}`
  return crypto.createHmac('sha256', SIGN_SECRET).update(payload).digest('hex')
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface YandexLyricsResponse {
  result?: {
    id?:           number
    externalLyricId?: string
    lyrics?:       string
    syncedLyrics?: string
    hasRights?:    boolean
    textLanguage?: string
    showTranslation?: boolean
    url?:          string
  }
  error?: { name: string; message: string }
}

interface YandexSearchResponse {
  result?: {
    tracks?: {
      results?: Array<{
        id:      number
        title:   string
        artists: Array<{ name: string }>
        durationMs?: number
      }>
    }
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export default class YandexMusicLyrics {
  private readonly tokenStore: TokenStore
  private accessToken: string | null = null

  constructor(tokenStore: TokenStore) {
    this.tokenStore = tokenStore
  }

  /** Load the access token from config-injected store or TokenStore cache. */
  async setup(accessToken?: string): Promise<boolean> {
    // Prefer the value injected directly from config (fastest path)
    if (accessToken) {
      this.accessToken = accessToken
      return true
    }

    // Fall back to the encrypted TokenStore (survives restarts)
    const cached = await this.tokenStore.get<string>('yandexmusic_access_token')
    if (cached) {
      this.accessToken = cached
      return true
    }

    log('warn', 'YandexLyrics', 'No access token — provider disabled. Set lyrics.yandexmusic.accessToken in config.ts')
    return false
  }

  /**
   * Resolve lyrics for a track by title + artist.
   *
   * Steps:
   * 1. Search Yandex Music for the track to get its numeric ID.
   * 2. Fetch synced (or plain) lyrics using that ID.
   */
  async getLyrics(trackInfo: { title: string; author: string }): Promise<LyricsResult> {
    const { title, author: artist } = trackInfo
    if (!this.accessToken) {
      return { loadType: 'error', data: { message: 'Yandex Music token not configured', severity: 'common' } }
    }

    const trackId = await this._resolveTrackId(title, artist)
    if (!trackId) {
      return { loadType: 'empty', data: {} }
    }

    return this._fetchLyricsById(trackId)
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _buildHeaders(): Record<string, string> {
    return {
      'Authorization':  `OAuth ${this.accessToken}`,
      'User-Agent':     YANDEX_UA,
      'X-Yandex-Music-Client': YANDEX_CLIENT_HDR,
      'Accept':         'application/json',
    }
  }

  /** Search for a track and return its Yandex numeric ID. */
  private async _resolveTrackId(title: string, artist: string): Promise<string | null> {
    const query = encodeURIComponent(`${title} ${artist}`)
    const url   = `${YANDEX_API_BASE}/search?type=track&text=${query}&page=0&pageSize=5`

    let body: YandexSearchResponse | null
    try {
      body = await httpGetJson<YandexSearchResponse>(url, { headers: this._buildHeaders() })
    } catch (err) {
      log('warn', 'YandexLyrics', `Search request failed: ${err}`)
      return null
    }

    const results = body?.result?.tracks?.results
    if (!results?.length) return null

    // Pick the best-matching track — prefer exact title match (case-insensitive)
    const titleLc = title.toLowerCase()
    const match =
      results.find(t => t.title.toLowerCase() === titleLc) ?? results[0]

    return match ? String(match.id) : null
  }

  /** Fetch lyrics from the Yandex Music lyrics endpoint using a numeric track ID. */
  private async _fetchLyricsById(trackId: string): Promise<LyricsResult> {
    const timestamp = Math.floor(Date.now() / 1000)
    const signature = buildSignature(trackId, timestamp)

    const url = `${YANDEX_API_BASE}/tracks/${trackId}/lyrics`
      + `?format=LRC&timeStamp=${timestamp}&sign=${signature}`

    let body: YandexLyricsResponse | null
    try {
      body = await httpGetJson<YandexLyricsResponse>(url, { headers: this._buildHeaders() })
    } catch (err) {
      log('warn', 'YandexLyrics', `Lyrics request failed for track ${trackId}: ${err}`)
      return { loadType: 'error', data: { message: String(err), severity: 'common' } }
    }

    if (body?.error) {
      log('warn', 'YandexLyrics', `API error for track ${trackId}: ${body.error.message}`)
      return { loadType: 'empty', data: {} }
    }

    const result = body?.result
    if (!result) return { loadType: 'empty', data: {} }

    // ── Synced (LRC) lyrics ────────────────────────────────────────────────────
    if (result.syncedLyrics) {
      const lines = this._parseLrc(result.syncedLyrics)
      if (lines.length) {
        return {
          loadType: 'lyrics',
          data: {
            name:   'yandexmusic',
            synced: true,
            lines,
          },
        }
      }
    }

    // ── Plain text fallback ────────────────────────────────────────────────────
    if (result.lyrics) {
      const lines = result.lyrics
        .split('\n')
        .map((text, i) => ({ text: text.trim(), time: i * 3000, duration: 3000 }))
        .filter(l => l.text.length > 0)

      return {
        loadType: 'lyrics',
        data: {
          name:   'yandexmusic',
          synced: false,
          lines,
        },
      }
    }

    return { loadType: 'empty', data: {} }
  }

  /**
   * Parse an LRC-formatted string into AurisLink lyric lines.
   *
   * LRC format: `[mm:ss.xx] line text`
   */
  private _parseLrc(lrc: string): Array<{ text: string; time: number; duration: number }> {
    const LRC_RE = /^\[(\d{1,2}):(\d{2})\.(\d{2,3})\]\s*(.*)$/

    const raw = lrc
      .split('\n')
      .map(line => {
        const m = LRC_RE.exec(line.trim())
        if (!m) return null
        const [, min, sec, ms, text] = m
        const time = Number(min) * 60_000 + Number(sec) * 1_000 + Number(ms.padEnd(3, '0'))
        return { text: text.trim(), time }
      })
      .filter((l): l is { text: string; time: number } => l !== null && l.text.length > 0)

    return raw.map((line, i) => ({
      text:     line.text,
      time:     line.time,
      duration: (raw[i + 1]?.time ?? line.time + 5_000) - line.time,
    }))
  }
}
