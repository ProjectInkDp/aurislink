// src/api/meaning.ts
// GET /v4/meaning?encodedTrack=<encoded>&language=<lang>
//
// Returns rich artist/track info from 3 public APIs in parallel:
//   - Wikipedia  → bio / description (no key needed)
//   - MusicBrainz → genre, year, label, country (no key needed)
//   - Last.fm     → tags, listeners, playcount (key optional)
//
// Results are cached for 24h per track identifier.

import type http from 'node:http'
import { sendJson, sendError } from './helpers.js'
import { httpGetJson } from '../shared/http.js'
import { decodeTrack } from '../shared/media.js'

const CACHE_TTL = 24 * 60 * 60 * 1000
const cache = new Map<string, { data: MeaningResponse; expiresAt: number }>()

// ─── Types ────────────────────────────────────────────────────────────────────

interface WikipediaResult {
  query?: {
    search?: Array<{ title?: string }>
    pages?: Record<string, { extract?: string; missing?: boolean }>
  }
}

interface MusicBrainzRecording {
  recordings?: Array<{
    id?: string
    title?: string
    'first-release-date'?: string
    releases?: Array<{
      title?: string
      date?: string
      country?: string
      'label-info'?: Array<{ label?: { name?: string } }>
      'release-group'?: { 'primary-type'?: string }
    }>
    tags?: Array<{ name?: string; count?: number }>
    isrcs?: string[]
  }>
}

interface MusicBrainzArtist {
  artists?: Array<{
    id?: string
    name?: string
    country?: string
    'begin-area'?: { name?: string }
    'life-span'?: { begin?: string; end?: string; ended?: boolean }
    tags?: Array<{ name?: string; count?: number }>
  }>
}

interface LastFmTrack {
  track?: {
    listeners?: string
    playcount?: string
    toptags?: { tag?: Array<{ name?: string }> }
    wiki?: { summary?: string }
    url?: string
  }
  error?: number
}

interface MeaningResponse {
  track: {
    title: string
    author: string
    identifier: string
    sourceName: string
    isrc: string | null
    year: string | null
    releaseType: string | null
    country: string | null
    label: string | null
    tags: string[]
  }
  artist: {
    origin: string | null
    activeFrom: string | null
    activeTo: string | null
    tags: string[]
    bio: string | null
  }
  stats: {
    listeners: number | null
    playcount: number | null
  }
  wikipedia: {
    language: string
    extract: string | null
    url: string | null
  }
  lastfm: {
    url: string | null
    summary: string | null
  }
  cachedAt: number
}

// ─── Providers ────────────────────────────────────────────────────────────────

async function fetchWikipedia(query: string, language: string): Promise<{ extract: string | null; url: string | null }> {
  const searchUrl = `https://${language}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`
  const search = await httpGetJson<WikipediaResult>(searchUrl)
  const title = search?.query?.search?.[0]?.title
  if (!title) return { extract: null, url: null }

  const extractUrl = `https://${language}.wikipedia.org/w/api.php?action=query&prop=extracts&exintro=true&explaintext=true&titles=${encodeURIComponent(title)}&format=json`
  const result = await httpGetJson<WikipediaResult>(extractUrl)
  const pages = result?.query?.pages ?? {}
  const page = Object.values(pages)[0]

  if (!page || page.missing) return { extract: null, url: null }

  const raw = page.extract ?? null
  const extract = raw ? raw.slice(0, 800).trim() : null
  const url = extract ? `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}` : null

  return { extract, url }
}

async function fetchMusicBrainzTrack(title: string, artist: string) {
  const q = encodeURIComponent(`recording:"${title}" AND artist:"${artist}"`)
  const url = `https://musicbrainz.org/ws/2/recording?query=${q}&limit=1&fmt=json&inc=releases+tags+isrcs`
  const res = await httpGetJson<MusicBrainzRecording>(url)
  const rec = res?.recordings?.[0]
  if (!rec) return null

  const release = rec.releases?.[0]
  const labelInfo = release?.['label-info']?.[0]

  return {
    year: rec['first-release-date']?.slice(0, 4) ?? release?.date?.slice(0, 4) ?? null,
    releaseType: release?.['release-group']?.['primary-type'] ?? null,
    country: release?.country ?? null,
    label: labelInfo?.label?.name ?? null,
    tags: (rec.tags ?? []).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 5).map(t => t.name ?? '').filter(Boolean),
    isrc: rec.isrcs?.[0] ?? null,
  }
}

async function fetchMusicBrainzArtist(artist: string) {
  const q = encodeURIComponent(`artist:"${artist}"`)
  const url = `https://musicbrainz.org/ws/2/artist?query=${q}&limit=1&fmt=json`
  const res = await httpGetJson<MusicBrainzArtist>(url)
  const a = res?.artists?.[0]
  if (!a) return null

  return {
    origin: a['begin-area']?.name ?? a.country ?? null,
    activeFrom: a['life-span']?.begin?.slice(0, 4) ?? null,
    activeTo: a['life-span']?.ended ? (a['life-span'].end?.slice(0, 4) ?? null) : null,
    tags: (a.tags ?? []).sort((a, b) => (b.count ?? 0) - (a.count ?? 0)).slice(0, 5).map(t => t.name ?? '').filter(Boolean),
  }
}

async function fetchLastFm(title: string, artist: string, apiKey?: string): Promise<{ listeners: number | null; playcount: number | null; summary: string | null; url: string | null }> {
  if (!apiKey) return { listeners: null, playcount: null, summary: null, url: null }

  const url = `https://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key=${apiKey}&artist=${encodeURIComponent(artist)}&track=${encodeURIComponent(title)}&format=json`
  const res = await httpGetJson<LastFmTrack>(url)
  if (!res || res.error) return { listeners: null, playcount: null, summary: null, url: null }

  const t = res.track
  const rawSummary = t?.wiki?.summary ?? null
  const summary = rawSummary ? rawSummary.replace(/<a[^>]*>.*?<\/a>/g, '').replace(/<[^>]+>/g, '').trim().slice(0, 300) : null

  return {
    listeners: t?.listeners ? parseInt(t.listeners, 10) : null,
    playcount: t?.playcount ? parseInt(t.playcount, 10) : null,
    summary,
    url: t?.url ?? null,
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function handleMeaning(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  lastFmKey?: string
) {
  const encodedTrack = url.searchParams.get('encodedTrack')?.trim().replace(/ /g, '+')
  if (!encodedTrack) return sendError(res, 400, 'Bad Request', 'encodedTrack parameter is required')

  const language = url.searchParams.get('language')?.trim() || 'en'

  let info: ReturnType<typeof decodeTrack>
  try { info = decodeTrack(encodedTrack) } catch { return sendError(res, 400, 'Bad Request', 'Could not decode track') }

  const cacheKey = `${info.identifier}:${language}`
  const cached = cache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return sendJson(res, 200, cached.data)

  // Fetch all sources in parallel
  const [wiki, mbTrack, mbArtist, lastfm] = await Promise.all([
    fetchWikipedia(`${info.author} ${info.title}`, language).catch(() => ({ extract: null, url: null })),
    fetchMusicBrainzTrack(info.title, info.author).catch(() => null),
    fetchMusicBrainzArtist(info.author).catch(() => null),
    fetchLastFm(info.title, info.author, lastFmKey).catch(() => ({ listeners: null, playcount: null, summary: null, url: null })),
  ])

  const data: MeaningResponse = {
    track: {
      title: info.title,
      author: info.author,
      identifier: info.identifier,
      sourceName: info.sourceName,
      isrc: mbTrack?.isrc ?? info.isrc ?? null,
      year: mbTrack?.year ?? null,
      releaseType: mbTrack?.releaseType ?? null,
      country: mbTrack?.country ?? null,
      label: mbTrack?.label ?? null,
      tags: mbTrack?.tags ?? [],
    },
    artist: {
      origin: mbArtist?.origin ?? null,
      activeFrom: mbArtist?.activeFrom ?? null,
      activeTo: mbArtist?.activeTo ?? null,
      tags: mbArtist?.tags ?? [],
      bio: wiki.extract,
    },
    stats: {
      listeners: lastfm.listeners,
      playcount: lastfm.playcount,
    },
    wikipedia: {
      language,
      extract: wiki.extract,
      url: wiki.url,
    },
    lastfm: {
      url: lastfm.url,
      summary: lastfm.summary,
    },
    cachedAt: Date.now(),
  }

  cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL })
  sendJson(res, 200, data)
}
