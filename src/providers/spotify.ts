// src/sources/spotify.ts
import type { Source, LoadResult, Track, TrackInfo, AurisConfig } from '../typings/index.js'
import { getSpotifyToken, configureSpotifyAuth } from '../shared/spotifyAuth.js'
import { SpotifyTokenManager } from '../shared/spotify-auth.js'
import { httpGet } from '../shared/http.js'
import { log } from '../shared/reporter.js'
import { encodeTrack } from '../shared/media.js'

const AURIS_PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v1/query'

interface GQLOp { name: string; hash: string }
const GQL = {
  track:    { name: 'getTrack',             hash: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294' },
  search:   { name: 'searchDesktop',         hash: 'fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c' },
} as const satisfies Record<string, GQLOp>

export class AurisSpotifySource implements Source {
  readonly name           = 'spotify'
  readonly searchPrefixes = ['spsearch', 'sprec']
  readonly patterns = [
    /https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-zA-Z]{2}\/)?(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/,
  ]
  
  private _tokenManager = new SpotifyTokenManager()

  constructor(config: AurisConfig) {
    const sp = config.sources.spotify ?? { enabled: false }
    configureSpotifyAuth(sp)
  }

  async setup(): Promise<boolean> {
    // Apenas tenta obter o token, mas não bloqueia se falhar (o fallback cuidará disso)
    await this._tokenManager.getAccessToken()
    return true
  }

  private async _getAccessToken(): Promise<string> {
    const autoToken = await this._tokenManager.getAccessToken()
    if (autoToken) return autoToken
    const { accessToken } = await getSpotifyToken()
    return accessToken
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

  async search(query: string): Promise<LoadResult> {
    log('info', 'Spotify', `Search: ${query}`)
    try {
      const accessToken = await this._getAccessToken()
      const url = `${AURIS_PATHFINDER}?operationName=${GQL.search.name}&variables=${encodeURIComponent(JSON.stringify({ searchTerm: query, offset: 0, limit: 10, numberOfTopResults: 5 }))}&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: GQL.search.hash } }))}`
      
      const res = await httpGet(url, { headers: { Authorization: `Bearer ${accessToken}` } })
      if (res?.status === 200) {
        const data = JSON.parse(res.body)
        const tracks = this._processGQLSearch(data)
        return { loadType: 'search', data: tracks }
      }
      return _empty()
    } catch (err) {
      return _error(String(err), 'fault')
    }
  }

  private async _resolveTrack(id: string): Promise<LoadResult> {
    const accessToken = await this._getAccessToken()
    const url = `${AURIS_PATHFINDER}?operationName=${GQL.track.name}&variables=${encodeURIComponent(JSON.stringify({ uri: `spotify:track:${id}` }))}&extensions=${encodeURIComponent(JSON.stringify({ persistedQuery: { version: 1, sha256Hash: GQL.track.hash } }))}`
    
    const res = await httpGet(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (res?.status === 200) {
      const data = JSON.parse(res.body)
      const track = this._buildGQLTrack(data.data?.trackUnion)
      if (track) return { loadType: 'track', data: track }
    }
    return _empty()
  }

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

  private _processGQLSearch(data: any): Track[] {
    const tracks: Track[] = []
    for (const it of data.data?.searchV2?.tracksV2?.items ?? []) {
      const t = this._buildGQLTrack(it.item.data)
      if (t) tracks.push(t)
    }
    return tracks
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
function _error(message: string, severity: 'common' | 'suspicious' | 'fault'): LoadResult {
  return { loadType: 'error', data: { message, severity, cause: 'SpotifyError' } }
}
