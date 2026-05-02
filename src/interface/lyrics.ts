// src/api/lyrics.ts
// GET /v4/sessions/:sessionId/players/:guildId/track/lyrics
//
// Returns lyrics for the currently playing track.
// Deezer tracks with an ISRC use the Deezer lyrics API.
// All other tracks fall back to lrclib.net (free, no key required).

import type http from 'node:http'
import { sendJson, sendError } from './helpers.js'
import { httpGetJson } from '../shared/http.js'
import { decodeTrack } from '../shared/media.js'
import type { SessionManager } from '../engine/SessionManager.js'

interface LrcLibLine {
  seconds: number
  words: string
}

interface LrcLibResult {
  syncedLyrics?: string
  plainLyrics?: string
  trackName?: string
  artistName?: string
  albumName?: string
  duration?: number
}

interface DeezerLyricsResult {
  error?: unknown
  data?: {
    LYRICS_TEXT?: string
    LYRICS_SYNC_JSON?: Array<{ lrc_timestamp?: string; line?: string; milliseconds?: string }>
  }
}

interface LyricsLine {
  timestamp: number | null
  line: string
}

interface LyricsResponse {
  source: string
  synced: boolean
  lines: LyricsLine[]
  text: string | null
}

// ─── LRC parser ───────────────────────────────────────────────────────────────

function parseLrc(raw: string): LyricsLine[] {
  const lines: LyricsLine[] = []
  for (const row of raw.split('\n')) {
    const match = /^\[(\d+):(\d+\.\d+)\](.*)$/.exec(row.trim())
    if (!match) continue
    const minutes = parseInt(match[1]!, 10)
    const seconds = parseFloat(match[2]!)
    const text = match[3]!.trim()
    lines.push({ timestamp: (minutes * 60 + seconds) * 1000, line: text })
  }
  return lines
}

// ─── Providers ────────────────────────────────────────────────────────────────

async function fromDeezer(trackId: string): Promise<LyricsResponse | null> {
  const url = `https://api.deezer.com/2.0/track/${trackId}/lyrics`
  const res = await httpGetJson<DeezerLyricsResult>(url)
  if (!res || res.error) return null

  const sync = res.data?.LYRICS_SYNC_JSON
  const plain = res.data?.LYRICS_TEXT

  if (sync && sync.length > 0) {
    const lines: LyricsLine[] = sync
      .filter(l => typeof l.line === 'string')
      .map(l => ({
        timestamp: l.milliseconds ? parseInt(l.milliseconds, 10) : null,
        line: l.line ?? '',
      }))
    return { source: 'deezer', synced: true, lines, text: plain ?? null }
  }

  if (plain) {
    const lines: LyricsLine[] = plain
      .split('\n')
      .map(line => ({ timestamp: null, line }))
    return { source: 'deezer', synced: false, lines, text: plain }
  }

  return null
}

async function fromLrcLib(title: string, author: string, album?: string, duration?: number): Promise<LyricsResponse | null> {
  const params = new URLSearchParams({ track_name: title, artist_name: author })
  if (album) params.set('album_name', album)
  if (duration) params.set('duration', String(Math.round(duration / 1000)))

  const res = await httpGetJson<LrcLibResult>(`https://lrclib.net/api/get?${params}`)
  if (!res) return null

  if (res.syncedLyrics) {
    const lines = parseLrc(res.syncedLyrics)
    return { source: 'lrclib', synced: true, lines, text: res.plainLyrics ?? null }
  }

  if (res.plainLyrics) {
    const lines: LyricsLine[] = res.plainLyrics
      .split('\n')
      .map(line => ({ timestamp: null, line }))
    return { source: 'lrclib', synced: false, lines, text: res.plainLyrics }
  }

  return null
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleLyrics(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string,
  guildId: string,
  sessions: SessionManager
) {
  const player = sessions.fetchPlayer(sessionId, guildId)
  if (!player) return sendError(res, 404, 'Not Found', 'Player not found')

  const encoded = player.track?.encoded ?? null
  if (!encoded) return sendError(res, 404, 'Not Found', 'No track currently playing')

  let info: ReturnType<typeof decodeTrack> | null = null
  try { info = decodeTrack(encoded) } catch { return sendError(res, 400, 'Bad Request', 'Could not decode track') }

  let lyrics: LyricsResponse | null = null

  // Deezer tracks: try Deezer lyrics API first
  if (info.sourceName === 'deezer') {
    lyrics = await fromDeezer(info.identifier)
  }

  // Fallback: lrclib.net (works for any source)
  if (!lyrics) {
    lyrics = await fromLrcLib(info.title, info.author, undefined, info.length)
  }

  if (!lyrics) return sendError(res, 404, 'Not Found', 'No lyrics found')

  sendJson(res, 200, lyrics)
}
