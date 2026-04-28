import type { LyricsLine, LyricsResult, TrackInfo } from '../typings/index.js'
import { httpGet } from '../utils/http.js'
import { log } from '../utils/logger.js'

// ─── Deezer-specific internal types ──────────────────────────────────────────

interface DeezerJwtResponse { jwt?: string; exp?: number }

interface DeezerSearchCandidate {
  id?: number | string
  title?: string
  artist?: { name?: string }
  info?: { identifier?: string | number; title?: string; author?: string }
  [key: string]: unknown
}

interface DeezerLyricsWord { lrcTimestamp: string; line: string; milliseconds: string | number; duration: string | number }
interface DeezerLyricsLine { lrcTimestamp: string; line: string; milliseconds: string | number; duration: string | number }

interface DeezerGraphqlWord {
  word: string
  start: number
  end: number
}

interface DeezerGraphqlWordByWordLine {
  start: number
  end: number
  words: DeezerGraphqlWord[]
}

interface DeezerGraphqlSyncLine {
  lrcTimestamp: string
  line: string
  milliseconds: string | number
  duration: string | number
}

interface DeezerGraphqlTrackLyrics {
  id?: string
  text?: string
  synchronizedLines?: DeezerGraphqlSyncLine[]
  synchronizedWords?: DeezerGraphqlSyncLine[]
  synchronizedWordByWordLines?: DeezerGraphqlWordByWordLine[]
}

interface DeezerGraphqlResponse {
  data?: {
    track?: {
      id?: string
      lyrics?: DeezerGraphqlTrackLyrics
    }
  }
  errors?: { message: string }[]
}

type AurisInstanceForDeezerLyrics = object

// Finds the best matching track from Deezer search results.
function aurisFindBestMatch(candidates: DeezerSearchCandidate[], trackInfo: TrackInfo): DeezerSearchCandidate | null {
  if (!candidates.length) return null
  const title  = trackInfo.title.toLowerCase()
  const author = trackInfo.author.toLowerCase()
  const getTitle  = (c: DeezerSearchCandidate) => (c.info?.title ?? c.title ?? '').toLowerCase()
  const getAuthor = (c: DeezerSearchCandidate) => (c.info?.author ?? c.artist?.name ?? '').toLowerCase()
  const exact = candidates.find(c =>
    getTitle(c) === title &&
    getAuthor(c).includes(author.split(',')[0]?.trim() ?? '')
  )
  if (exact) return exact
  const titleMatch = candidates.find(c => getTitle(c) === title)
  if (titleMatch) return titleMatch
  return candidates[0] ?? null
}

/**
 * Deezer lyrics provider utilizing the Deezer GraphQL internal API.
 * Supports word-by-word and line-level synchronization.
 * @public
 */
export default class DeezerLyrics {
  /**
   * AurisLink service context required for source lookups.
   * @public
   */
  public readonly auris: AurisInstanceForDeezerLyrics

  /**
   * Cached anonymous JWT token for authentication.
   * @internal
   */
  private jwt: string | null

  /**
   * Unix timestamp (ms) when the current JWT expires.
   * @internal
   */
  private jwtExpiry: number

  /**
   * Constructs a new DeezerLyrics provider.
   * @param auris - The parent service context.
   */
  public constructor(auris: AurisInstanceForDeezerLyrics) {
    this.auris = auris
    this.jwt = null
    this.jwtExpiry = 0
  }

  /**
   * Performs provider-specific resource initialization.
   * @returns A promise resolving to true.
   * @public
   */
  public async setup(): Promise<boolean> {
    return true
  }

  /**
   * Obtains a valid anonymous JWT from the Deezer authentication service.
   * Caches results until expiration.
   * @returns A promise resolving to the JWT string or null.
   * @internal
   */
  private async _getJwt(): Promise<string | null> {
    if (this.jwt && Date.now() < this.jwtExpiry) return this.jwt

    try {
      const jwtRes = await httpGet(
        'https://auth.deezer.com/login/anonymous?jo=p&rto=c',
        { method: 'GET' }
      )

      if (!jwtRes || jwtRes.status !== 200) throw new Error('JWT request failed')
      const rawJwt = typeof jwtRes.body === 'string' ? jwtRes.body : JSON.stringify(jwtRes.body)
      const data = JSON.parse(rawJwt) as DeezerJwtResponse
      if (!data?.jwt) throw new Error('No JWT in response')

      this.jwt = data.jwt
      this.jwtExpiry = Date.now() + 300000

      return this.jwt
    } catch (e) {
      log(
        'error',
        'Lyrics',
        `Deezer JWT fetch failed: ${e instanceof Error ? e.message : String(e)}`
      )
      return null
    }
  }

  /**
   * Fetches and parses lyrics for the specified track.
   * Automatically resolves non-Deezer tracks using metadata matching.
   * @param trackInfo - Metadata of the track to fetch lyrics for.
   * @returns A promise resolving to a LyricsResult.
   * @public
   */
  public async getLyrics(trackInfo: TrackInfo): Promise<LyricsResult> {
    const jwt = await this._getJwt()
    if (!jwt) return { loadType: 'empty', data: {} }

    let trackId: string | number = trackInfo.identifier

    if (trackInfo.sourceName !== 'deezer') {
      const query = `${trackInfo.title} ${trackInfo.author}`
      // Search Deezer REST for a matching track ID
      const searchUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`
      const searchRes = await httpGet(searchUrl)
      if (!searchRes || searchRes.status !== 200) return { loadType: 'empty', data: {} }

      const searchBody = JSON.parse(searchRes.body ?? '{}') as { data?: DeezerSearchCandidate[] }
      const candidates = searchBody.data ?? []
      const bestMatch = aurisFindBestMatch(candidates, trackInfo)
      if (!bestMatch) return { loadType: 'empty', data: {} }
      const matchedCandidate = bestMatch as DeezerSearchCandidate
      trackId = matchedCandidate.info?.identifier ?? (matchedCandidate as any).id
    }

    try {
      const query = `query GetLyrics($trackId: String!) {
  track(trackId: $trackId) {
    id
    lyrics {
      id
      text
      ...SynchronizedWordByWordLines
      ...SynchronizedLines
      licence
      copyright
      writers
      __typename
    }
    __typename
  }
}

fragment SynchronizedWordByWordLines on Lyrics {
  id
  synchronizedWordByWordLines {
    start
    end
    words {
      start
      end
      word
      __typename
    }
    __typename
  }
  __typename
}

fragment SynchronizedLines on Lyrics {
  id
  synchronizedLines {
    lrcTimestamp
    line
    lineTranslated
    milliseconds
    duration
    __typename
  }
  __typename
}`

      const res = await httpGet('https://pipe.deezer.com/api', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operationName: 'GetLyrics',
          variables: { trackId: String(trackId) },
          query
        })
      })

      if (!res || res.status !== 200) return { loadType: 'empty', data: {} }
      const rawBody = typeof res.body === 'string' ? res.body : JSON.stringify(res.body)
      let data: DeezerGraphqlResponse
      try { data = JSON.parse(rawBody) as DeezerGraphqlResponse } catch { return { loadType: 'empty', data: {} } }
      const lyrics = data?.data?.track?.lyrics
      if (!lyrics) return { loadType: 'empty', data: {} }

      let lines: LyricsLine[] = []
      let synced = false

      if (lyrics.synchronizedWordByWordLines?.length) {
        synced = true
        lines = lyrics.synchronizedWordByWordLines.map((line) => ({
          time: line.start,
          duration: line.end - line.start,
          text: line.words.map((w) => w.word).join(' '),
          words: line.words.map((w) => ({
            text: w.word,
            timestamp: w.start,
            duration: w.end - w.start
          }))
        }))
      } else if (lyrics.synchronizedLines?.length) {
        synced = true
        lines = lyrics.synchronizedLines.map((line) => ({
          time: line.milliseconds,
          duration: line.duration,
          text: line.line
        }))
      } else if (lyrics.text) {
        lines = lyrics.text
          .split(/\r?\n/)
          .map((text) => ({ time: 0, duration: 0, text: text.trim() }))
          .filter((line) => line.text.length > 0)
      }

      return {
        loadType: 'lyrics',
        data: {
          name: trackInfo.title,
          synced,
          lines
        }
      }
    } catch (e) {
      log(
        'error',
        'Lyrics',
        `Deezer lyrics request failed: ${e instanceof Error ? e.message : String(e)}`
      )
      return { loadType: 'empty', data: {} }
    }
  }
}
