// src/api/chapters.ts
// GET /v4/loadchapters?encodedTrack=<encoded>
//
// Returns timestamped chapters for a track, sourced from:
//   - Deezer podcast episodes  → real chapter data via public API
//   - SoundCloud               → timestamps parsed from track description
//   - All other sources        → empty chapter list (type: "none")
//
// Results are cached for 1 h per track identifier.

import type http from 'node:http'
import { sendJson, sendError } from './helpers.js'
import { httpGetJson } from '../shared/http.js'
import { decodeTrack } from '../shared/media.js'
import { log } from '../shared/reporter.js'

const CACHE_TTL = 60 * 60 * 1000  // 1 h
const cache = new Map<string, { data: ChaptersResponse; expiresAt: number }>()

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Chapter {
  title: string
  startMs: number
  endMs: number
}

export type ChaptersType = 'deezer' | 'soundcloud_parsed' | 'none'

export interface ChaptersResponse {
  type: ChaptersType
  chapters: Chapter[]
}

// Deezer public podcast chapter API shape
interface DeezerChapter {
  title?: string
  time_start?: number  // seconds
  time_end?: number    // seconds
}

interface DeezerChaptersResult {
  data?: DeezerChapter[]
}

// SoundCloud API track shape (only what we need)
interface SoundCloudTrack {
  description?: string | null
  duration?: number  // ms
}

// ─── Providers ────────────────────────────────────────────────────────────────

/**
 * Fetches real chapter data from the Deezer podcast episode API.
 * Only works for Deezer podcast episodes — regular tracks return no data.
 */
async function fetchDeezerChapters(identifier: string): Promise<Chapter[] | null> {
  const url = `https://api.deezer.com/episode/${identifier}/chapters`
  const res = await httpGetJson<DeezerChaptersResult>(url)
  const raw = res?.data

  if (!Array.isArray(raw) || raw.length === 0) return null

  const chapters: Chapter[] = []
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i]!
    if (typeof c.time_start !== 'number') continue

    const startMs = c.time_start * 1000
    // Use the next chapter's start as this one's end, or use time_end if present
    const nextStart = raw[i + 1]?.time_start
    const endMs =
      typeof c.time_end === 'number'
        ? c.time_end * 1000
        : typeof nextStart === 'number'
          ? nextStart * 1000
          : startMs  // degenerate — filtered out below

    if (endMs <= startMs) continue

    chapters.push({ title: c.title?.trim() || `Chapter ${i + 1}`, startMs, endMs })
  }

  return chapters.length > 0 ? chapters : null
}

/**
 * Parses chapters from a SoundCloud track description.
 *
 * Matches lines in the format:  0:00 Intro  or  1:23:45 - Bridge
 * which is the de-facto community standard for YouTube/SoundCloud chapters.
 */
async function fetchSoundCloudChapters(
  identifier: string,
  durationMs: number,
  clientId: string,
): Promise<Chapter[] | null> {
  if (!clientId) return null

  const url = `https://api-v2.soundcloud.com/tracks/${identifier}?client_id=${clientId}`
  const track = await httpGetJson<SoundCloudTrack>(url)
  const description = track?.description

  if (!description) return null

  // Match timestamps: optional HH: + MM:SS at the start of a line, then title
  const LINE_RE = /^(?:(\d+):)?(\d{1,2}):(\d{2})\s*[-–—]?\s*(.+)/

  const raw: { startMs: number; title: string }[] = []
  for (const line of description.split('\n')) {
    const m = line.trim().match(LINE_RE)
    if (!m) continue
    const [, h, min, sec, title] = m
    const hours = h ? parseInt(h, 10) : 0
    const startMs = (hours * 3600 + parseInt(min!, 10) * 60 + parseInt(sec!, 10)) * 1000
    raw.push({ startMs, title: title!.trim() })
  }

  if (raw.length === 0) return null

  // Sort by startMs ascending (description order is usually correct but ensure it)
  raw.sort((a, b) => a.startMs - b.startMs)

  const totalMs = durationMs > 0 ? durationMs : Infinity

  const chapters: Chapter[] = raw.map((entry, i) => ({
    title: entry.title,
    startMs: entry.startMs,
    endMs: raw[i + 1]?.startMs ?? totalMs,
  }))

  return chapters
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleLoadChapters(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  soundcloudClientId: string,
) {
  const encodedTrack = url.searchParams.get('encodedTrack')?.trim().replace(/ /g, '+')
  if (!encodedTrack) {
    return sendError(res, 400, 'Bad Request', 'encodedTrack parameter is required')
  }

  let info: ReturnType<typeof decodeTrack>
  try {
    info = decodeTrack(encodedTrack)
  } catch {
    return sendError(res, 400, 'Bad Request', 'Could not decode encodedTrack')
  }

  const cacheKey = info.identifier
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    log('debug', 'Chapters', `Cache hit for ${info.title}`)
    return sendJson(res, 200, cached.data)
  }

  log('debug', 'Chapters', `Loading chapters for: ${info.title} [${info.sourceName}]`)

  let result: ChaptersResponse = { type: 'none', chapters: [] }

  if (info.sourceName === 'deezer') {
    const chapters = await fetchDeezerChapters(info.identifier).catch(() => null)
    if (chapters) {
      result = { type: 'deezer', chapters }
      log('info', 'Chapters', `Deezer: found ${chapters.length} chapters for "${info.title}"`)
    } else {
      log('debug', 'Chapters', `Deezer: no chapters for "${info.title}" (not a podcast episode)`)
    }
  } else if (info.sourceName === 'soundcloud') {
    const chapters = await fetchSoundCloudChapters(
      info.identifier,
      info.length,
      soundcloudClientId,
    ).catch(() => null)
    if (chapters) {
      result = { type: 'soundcloud_parsed', chapters }
      log('info', 'Chapters', `SoundCloud: parsed ${chapters.length} chapters for "${info.title}"`)
    } else {
      log('debug', 'Chapters', `SoundCloud: no timestamp chapters in description for "${info.title}"`)
    }
  }

  cache.set(cacheKey, { data: result, expiresAt: Date.now() + CACHE_TTL })
  sendJson(res, 200, result)
}
