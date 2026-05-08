// src/sources/spotify.ts
import type { Source, LoadResult, Track, TrackInfo, AurisConfig } from '../typings/index.js'
// Fix #4: removed SpotifyTokenManager (spotify-auth.ts legacy) — using spotifyAuth.ts exclusively
import { getSpotifyToken, getMobileToken, configureSpotifyAuth } from '../shared/spotifyAuth.js'
import { httpGet, httpPostJson } from '../shared/http.js'
import { log } from '../shared/reporter.js'
import { encodeTrack } from '../shared/media.js'

/**
 * Spotify Partner API v2 endpoint (Pathfinder).
 */
const AURIS_PATHFINDER_V2 = 'https://api-partner.spotify.com/pathfinder/v2/query'

interface GQLOp { name: string; hash: string }

/**
 * Persisted GraphQL queries for Spotify Pathfinder v2.
 * Hashes updated for 2026 standards.
 */
const GQL = {
  track:    { name: 'getTrack',             hash: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294' },
  search:   { name: 'searchTopResultsList', hash: '795a87647895afbb1e3f1aa923ced808ab960ae0e04b8f052f8fe182378d2cae' },
} as const satisfies Record<string, GQLOp>

export class AurisSpotifySource implements Source {
  readonly name           = 'spotify'
  readonly searchPrefixes = ['spsearch', 'sprec']
  readonly patterns = [
    /https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-zA-Z]{2}\/)?(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/,
  ]

  constructor(config: AurisConfig, vault?: any) {
    const sp = config.sources.spotify ?? { enabled: false }
    configureSpotifyAuth(sp)
  }

  async setup(): Promise<boolean> {
    await getSpotifyToken().catch(() => null)
    return true
  }

  // Fix #4: single auth path — mobile token (sp_dc) preferred, falls back to anonymous
  private async _getAuth() {
    const mobile = await getMobileToken()
    if (mobile) return { accessToken: mobile.accessToken, clientToken: null }
    const anon = await getSpotifyToken()
    return { accessToken: anon.accessToken, clientToken: null }
  }

  accepts(url: string): boolean {
    return this.patterns.some(p => p.test(url))
  }

  async load(url: string): Promise<LoadResult> {
    const match = url.match(this.patterns[0]!)
    if (!match) return _empty()
    const [, type, id] = match
    if (type === 'track') return this._resolveTrack(id!)
    return _empty()
  }

  /**
   * Performs a search using Spotify's Pathfinder v2 API.
   */
  async search(query: string): Promise<LoadResult> {
    log('info', 'Spotify', `Searching (Pathfinder v2): ${query}`)
    try {
      const auth = await this._getAuth()
      const payload = {
        variables: {
          query: query,
          limit: 20,
          offset: 0,
          numberOfTopResults: 20,
          includeArtistHasConcertsField: false,
          includeAudiobooks: true,
          includeAuthors: false,
          includePreReleases: true,
          includeEpisodeContentRatingsV2: false,
          isPrefix: null,
          sectionFilters: ["GENERIC", "VIDEO_CONTENT"]
        },
        operationName: GQL.search.name,
        extensions: {
          persistedQuery: {
            version: 1,
            sha256Hash: GQL.search.hash
          }
        }
      }

      const headers: Record<string, string> = {
        'Authorization': `Bearer ${auth.accessToken}`,
        'app-platform': 'WebPlayer',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      }

      if (auth.clientToken) {
        headers['client-token'] = auth.clientToken
      }
      
      const res = await httpPostJson(AURIS_PATHFINDER_V2, payload, { headers })
      if (res?.status === 200) {
        const data = JSON.parse(res.body)
        const tracks = this._processGQLSearchV2(data)
        return { loadType: 'search', data: tracks }
      }
      log('error', 'Spotify', `Search failed with status ${res?.status}`)
      return _empty()
    } catch (err) {
      log('error', 'Spotify', `Search exception: ${err}`)
      return _error(String(err), 'fault')
    }
  }

  /**
   * Resolves a single Spotify track URI.
   */
  private async _resolveTrack(id: string): Promise<LoadResult> {
    const auth = await this._getAuth()
    const url = `https://api-partner.spotify.com/pathfinder/v1/query?operationName=${GQL.track.name}&variables=${encodeURIComponent(JSON.stringify({ uri: `spotify:track:${id}` }))}&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: GQL.track.hash } }))}`
    
    const headers: Record<string, string> = {
      'Authorization': `Bearer ${auth.accessToken}`,
      'app-platform': 'WebPlayer'
    }
    if (auth.clientToken) headers['client-token'] = auth.clientToken

    const res = await httpGet(url, { headers })
    if (res?.status === 200) {
      const data = JSON.parse(res.body)
      const track = this._buildGQLTrack(data.data?.trackUnion)
      if (track) return { loadType: 'track', data: track }
    }
    return _empty()
  }

  /**
   * Maps Spotify GQL track data to Auris internal Track format.
   */
  private _buildGQLTrack(item: any): Track | null {
    if (!item?.uri) return null
    const id = item.uri.split(':').pop() ?? ''
    const info: TrackInfo = {
      identifier: id,
      isSeekable:  true,
      author:      item.artists?.items.map((a: any) => a.profile?.name || a.name).join(', ') || 'Unknown',
      length:      item.duration?.totalMilliseconds || 0,
      isStream:    false,
      position:    0,
      title:       item.name,
      uri:         `https://open.spotify.com/track/${id}`,
      artworkUrl:  item.albumOfTrack?.coverArt?.sources?.[0]?.url || null,
      isrc:        item.externalIds?.isrc || null,
      sourceName:  'spotify',
    }
    return { encoded: encodeTrack(info), info, pluginInfo: {} }
  }

  /**
   * Processes the complex nested response from Pathfinder v2 search.
   */
  private _processGQLSearchV2(data: any): Track[] {
    const tracks: Track[] = []
    const items = data.data?.searchV2?.topResultsV2?.itemsV2 ?? []
    
    for (const it of items) {
      const itemData = it.item?.data
      // Ensure we only process Track entities from the mixed result list
      if (itemData?.__typename === 'Track' || itemData?.uri?.includes(':track:')) {
        const t = this._buildGQLTrack(itemData)
        if (t) tracks.push(t)
      }
    }
    return tracks
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
function _error(message: string, severity: 'common' | 'suspicious' | 'fault'): LoadResult {
  return { loadType: 'error', data: { message, severity, cause: 'SpotifyError' } }
}
