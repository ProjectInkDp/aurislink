// src/sources/spotify.ts
// AurisLink Spotify source.
//
// Supported prefixes / URLs:
//   spsearch:<query>           — track search
//   sprec:<seed>               — inspired-by mix from a track ID or seed_tracks=ID
//   open.spotify.com/track     — single track
//   open.spotify.com/album     — album
//   open.spotify.com/playlist  — playlist
//   open.spotify.com/artist    — artist top tracks
//
// Auth tiers (resolved in order):
//   1. OAuth2 clientId + clientSecret
//   2. Anonymous Web Player TOTP
//   3. Mobile Web Player with sp_dc cookie

import type { Source, LoadResult, Track, TrackInfo, AurisConfig } from '../typings/index.js'
import { getSpotifyToken, getMobileToken, configureSpotifyAuth, getAurisLocalToken } from '../utils/spotifyAuth.js'
import { httpGet, httpGetJson } from '../utils/http.js'
import { log } from '../utils/logger.js'
import { encodeTrack } from '../utils/track.js'

// ─── Internal constants ───────────────────────────────────────────────────────

const AURIS_API        = 'https://api.spotify.com/v1'
const AURIS_CLIENT_API = 'https://spclient.wg.spotify.com'
const AURIS_PATHFINDER = 'https://api-partner.spotify.com/pathfinder/v2/query'

// How many ms before expiry to proactively refresh a token.
const AURIS_RATE_MARGIN = 300_000

// GraphQL persisted query map for the Pathfinder API.
interface GQLOp { name: string; hash: string }
const GQL = {
  track:    { name: 'getTrack',             hash: '612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294' },
  album:    { name: 'getAlbum',             hash: 'b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10' },
  playlist: { name: 'fetchPlaylist',         hash: 'bb67e0af06e8d6f52b531f97468ee4acd44cd0f82b988e15c2ea47b1148efc77' },
  artist:   { name: 'queryArtistOverview',   hash: '35648a112beb1794e39ab931365f6ae4a8d45e65396d641eeda94e4003d41497' },
  search:   { name: 'searchDesktop',         hash: 'fcad5a3e0d5af727fb76966f06971c19cfa2275e6ff7671196753e008611873c' },
} as const satisfies Record<string, GQLOp>

// ─── Internal Spotify typings ─────────────────────────────────────────────────

interface SpotifyApiTrack {
  id: string; name: string; duration_ms: number; explicit: boolean
  artists: { id: string; name: string }[]
  album?: { name: string; images: { url: string }[] }
  external_ids?: { isrc?: string }
  external_urls: { spotify: string }
  uri?: string; is_local?: boolean
}

interface SpotifyGQLTrack {
  uri?: string; name: string
  duration?: { totalMilliseconds: number }
  trackDuration?: { totalMilliseconds: number }
  contentRating?: { label: string }; explicit?: boolean
  artists?: { items: { profile?: { name: string }; name?: string }[] }
  firstArtist?: { items: { profile?: { name: string } }[] }
  albumOfTrack?: { coverArt?: { sources?: { url: string }[] } }
  album?: { images?: { url: string }[] }
  externalIds?: { isrc?: string }
  is_local?: boolean
}

interface SpotifyGQLSearchResponse {
  searchV2?: {
    tracksV2?: { items: { item: { data: SpotifyGQLTrack } }[] }
    albumsV2?: { items: { data: { uri: string; name: string; artists: { items: { profile: { name: string } }[] }; coverArt?: { sources?: { url: string }[] } } }[] }
  }
}

interface SpotifyGQLAlbumResponse {
  albumUnion?: {
    __typename: string; name: string
    coverArt?: { sources?: { url: string }[] }
    tracksV2?: { totalCount: number; items: { track: SpotifyGQLTrack }[] }
  }
}

interface SpotifyGQLPlaylistResponse {
  playlistV2?: {
    __typename: string; name: string
    content?: { totalCount: number; items: { itemV2?: { data: SpotifyGQLTrack } }[] }
  }
}

interface SpotifyGQLArtistResponse {
  artistUnion?: {
    profile: { name: string }
    discography?: { topTracks?: { items: { track: SpotifyGQLTrack }[] } }
  }
}

interface SpotifyGQLTrackResponse {
  trackUnion?: SpotifyGQLTrack & { __typename: string }
}

interface SpotifyMetadataResponse {
  external_id?: { type: string; id: string }[]
}

interface SpotifyApiAlbum {
  name: string; images: { url: string }[]
  tracks: { items: SpotifyApiTrack[]; next: string | null }
}

interface SpotifyApiPlaylist {
  name: string; images: { url: string }[]
  tracks: { items: { track: SpotifyApiTrack; is_local?: boolean }[]; next: string | null }
}

interface SpotifyApiPaging<T> { items: T[]; next?: string | null }

// ─── AurisLink Spotify source ─────────────────────────────────────────────────

export class AurisSpotifySource implements Source {
  readonly name           = 'spotify'
  readonly searchPrefixes = ['spsearch', 'sprec']

  // URL patterns accepted by this source.
  readonly patterns = [
    /https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-zA-Z]{2}\/)?(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/,
    /https?:\/\/(?:open\.)?spotify\.com\/(?:intl-[a-zA-Z]{2}\/)?local\/[^?#]+/,
  ]

  // Source priority — higher = preferred.
  readonly priority = 95

  private readonly market:        string
  private readonly playlistLimit: number
  private readonly albumLimit:    number
  private readonly allowLocal:    boolean
  private readonly allowExplicit: boolean

  constructor(config: AurisConfig) {
    const sp = config.sources.spotify ?? { enabled: false }
    this.market        = sp.market            ?? 'US'
    this.playlistLimit = sp.playlistLoadLimit ?? 100
    this.albumLimit    = sp.albumLoadLimit    ?? 50
    this.allowLocal    = false
    this.allowExplicit = true

    configureSpotifyAuth({
      clientId:             sp.clientId,
      clientSecret:         sp.clientSecret,
      customTokenEndpoint:  sp.customTokenEndpoint,
      preferAnonymousToken: sp.preferAnonymousToken ?? true,
      sp_dc:                sp.sp_dc,
    })
  }

  // Initializes the source and primes all available auth tiers.
  async setup(): Promise<boolean> {
    try {
      await getSpotifyToken()
      if (_spDcEnabled()) await getMobileToken()
      return true
    } catch (err) {
      log('error', 'Spotify', `Setup failed: ${err}`)
      return false
    }
  }

  accepts(url: string): boolean {
    return this.patterns.some(p => p.test(url))
  }

  async load(url: string): Promise<LoadResult> {
    log('info', 'Spotify', `Load: ${url}`)
    try {
      if (this.patterns[1]?.test(url)) return this._resolveLocalTrack(url)
      const match = url.match(this.patterns[0]!)
      if (!match) return _empty()
      const [, type, id] = match
      if (!id) return _empty()
      switch (type) {
        case 'track':    return this._resolveTrack(id)
        case 'album':    return this._resolveAlbum(id)
        case 'playlist': return this._resolvePlaylist(id)
        case 'artist':   return this._resolveArtist(id)
        case 'episode':
        case 'show':     return _error('Episodes and shows are not supported.', 'common')
        default:         return _empty()
      }
    } catch (err) {
      return _error(String(err), 'fault')
    }
  }

  async search(query: string): Promise<LoadResult> {
    if (query.startsWith('sprec:')) return this._getRecommendations(query.slice(6))
    log('info', 'Spotify', `Search: ${query}`)
    try {
      const { accessToken } = await getSpotifyToken()

      // Internal GraphQL search (richer, resolves ISRC on top result)
      const gql = await this._gqlRequest<SpotifyGQLSearchResponse>(GQL.search, {
        searchTerm: query, offset: 0,
        limit: Math.min(this.playlistLimit || 10, 999),
        numberOfTopResults: 5,
        includeAudiobooks: false,
        includeArtistHasConcertsField: false,
        includePreReleases: false,
      }, accessToken)

      if (gql?.searchV2) {
        const results = this._processGQLSearch(gql)
        if (results.length > 0) {
          const first = results[0]!
          if (!first.info.isrc) {
            const meta = await this._fetchTrackMetadata(first.info.identifier, accessToken)
            const isrc = meta?.external_id?.find(e => e.type === 'isrc')?.id
            if (isrc) {
              first.info.isrc = isrc
              first.encoded = encodeTrack(first.info)
            }
          }
          return { loadType: 'search', data: results }
        }
      }

      // Official API fallback
      const res = await this._apiGet<Record<string, SpotifyApiPaging<SpotifyApiTrack>>>(
        `/search?q=${encodeURIComponent(query)}&type=track&limit=10&market=${this.market}`,
        accessToken
      )
      if (res) {
        const items = res['tracks']?.items ?? []
        const tracks = items.map(t => this._buildTrack(t)).filter(Boolean) as Track[]
        if (tracks.length) return { loadType: 'search', data: tracks }
      }

      return _empty()
    } catch (err) {
      return _error(String(err), 'fault')
    }
  }

  // ─── Resolvers ────────────────────────────────────────────────────────────

  // Resolves a single track by ID.
  private async _resolveTrack(id: string): Promise<LoadResult> {
    const { accessToken } = await getSpotifyToken()

    const gql = await this._gqlRequest<SpotifyGQLTrackResponse>(
      GQL.track, { uri: `spotify:track:${id}` }, accessToken
    )
    if (gql?.trackUnion && gql.trackUnion.__typename !== 'NotFound') {
      const track = this._buildGQLTrack(gql.trackUnion)
      if (track) {
        if (!track.info.isrc) {
          const meta = await this._fetchTrackMetadata(id, accessToken)
          const isrc = meta?.external_id?.[0]?.id
          if (isrc) { track.info.isrc = isrc; track.encoded = encodeTrack(track.info) }
        }
        return { loadType: 'track', data: track }
      }
    }

    const data = await this._apiGet<SpotifyApiTrack>(`/tracks/${id}?market=${this.market}`, accessToken)
    if (data) {
      const track = this._buildTrack(data)
      if (track) return { loadType: 'track', data: track }
    }
    return _empty()
  }

  // Resolves an album and all its tracks.
  private async _resolveAlbum(id: string): Promise<LoadResult> {
    const { accessToken } = await getSpotifyToken()
    const tracks: Track[] = []
    let name = 'Unknown Album'
    let offset = 0
    const limit = 300

    // GraphQL path
    while (tracks.length < this.albumLimit) {
      const gql = await this._gqlRequest<SpotifyGQLAlbumResponse>(
        GQL.album, { uri: `spotify:album:${id}`, locale: 'en', offset, limit }, accessToken
      )
      if (!gql?.albumUnion || gql.albumUnion.__typename === 'NotFound') break
      if (offset === 0) name = gql.albumUnion.name
      const items = gql.albumUnion.tracksV2?.items ?? []
      if (!items.length) break
      const art = gql.albumUnion.coverArt?.sources?.[0]?.url ?? null
      for (const it of items) {
        const t = this._buildGQLTrack(it.track, art)
        if (t) tracks.push(t)
        if (tracks.length >= this.albumLimit) break
      }
      offset += items.length
      if (items.length < limit || tracks.length >= this.albumLimit) break
    }

    if (!tracks.length) {
      // Official API fallback
      let next: string | null = `/albums/${id}?market=${this.market}`
      while (next && tracks.length < this.albumLimit) {
        const res: SpotifyApiAlbum | null = await this._apiGet<SpotifyApiAlbum>(next, accessToken)
        if (!res) break
        if (!tracks.length) name = res.name
        for (const it of res.tracks.items) {
          const t = this._buildTrack({ ...it, album: { name: res.name, images: res.images } }, res.images[0]?.url)
          if (t) tracks.push(t)
          if (tracks.length >= this.albumLimit) break
        }
        next = res.tracks.next ? res.tracks.next.split('/v1')[1] ?? null : null
      }
    }

    return tracks.length
      ? { loadType: 'playlist', data: { info: { name, selectedTrack: 0 }, pluginInfo: { type: 'album' }, tracks } }
      : _empty()
  }

  // Resolves a playlist and all its tracks.
  private async _resolvePlaylist(id: string): Promise<LoadResult> {
    const { accessToken } = await getSpotifyToken()
    const tracks: Track[] = []
    let name = 'Unknown Playlist'
    let offset = 0
    const limit = 100

    // GraphQL path
    while (tracks.length < this.playlistLimit) {
      const gql = await this._gqlRequest<SpotifyGQLPlaylistResponse>(
        GQL.playlist, { uri: `spotify:playlist:${id}`, offset, limit, enableWatchFeedEntrypoint: false }, accessToken
      )
      if (!gql?.playlistV2 || gql.playlistV2.__typename === 'NotFound') break
      if (offset === 0) name = gql.playlistV2.name
      const items = gql.playlistV2.content?.items ?? []
      if (!items.length) break
      for (const it of items) {
        const node = it.itemV2?.data
        if (!node) continue
        const t = this._isLocalGQL(node) ? null : this._buildGQLTrack(node)
        if (t) tracks.push(t)
        if (tracks.length >= this.playlistLimit) break
      }
      offset += items.length
      if (items.length < limit || tracks.length >= this.playlistLimit) break
    }

    if (!tracks.length) {
      // Official API fallback
      let next: string | null = `/playlists/${id}?market=${this.market}`
      while (next && tracks.length < this.playlistLimit) {
        const res: SpotifyApiPlaylist | null = await this._apiGet<SpotifyApiPlaylist>(next, accessToken)
        if (!res) break
        if (!tracks.length) name = res.name
        for (const it of res.tracks.items) {
          if (it.is_local || !it.track) continue
          const t = this._buildTrack(it.track)
          if (t) tracks.push(t)
          if (tracks.length >= this.playlistLimit) break
        }
        next = res.tracks.next ? res.tracks.next.split('/v1')[1] ?? null : null
      }
    }

    return tracks.length
      ? { loadType: 'playlist', data: { info: { name, selectedTrack: 0 }, pluginInfo: { type: 'playlist' }, tracks } }
      : _empty()
  }

  // Resolves an artist's top tracks.
  private async _resolveArtist(id: string): Promise<LoadResult> {
    const { accessToken } = await getSpotifyToken()

    const gql = await this._gqlRequest<SpotifyGQLArtistResponse>(
      GQL.artist, { uri: `spotify:artist:${id}`, locale: 'en', includePrerelease: false }, accessToken
    )
    if (gql?.artistUnion) {
      const tracks = (gql.artistUnion.discography?.topTracks?.items ?? [])
        .map(it => this._buildGQLTrack(it.track))
        .filter(Boolean) as Track[]
      if (tracks.length) return {
        loadType: 'playlist',
        data: { info: { name: `${gql.artistUnion.profile.name}'s Top Tracks`, selectedTrack: 0 }, pluginInfo: { type: 'artist' }, tracks }
      }
    }

    const res = await this._apiGet<{ tracks?: SpotifyApiTrack[] }>(
      `/artists/${id}/top-tracks?market=${this.market}`, accessToken
    )
    if (res?.tracks?.length) {
      const tracks = res.tracks.map(t => this._buildTrack(t)).filter(Boolean) as Track[]
      return { loadType: 'playlist', data: { info: { name: 'Top Tracks', selectedTrack: 0 }, pluginInfo: { type: 'artist' }, tracks } }
    }
    return _empty()
  }

  // Fetches a recommendation mix from a seed track ID.
  private async _getRecommendations(seed: string): Promise<LoadResult> {
    const { accessToken } = await getSpotifyToken()
    try {
      let id = seed
      if (seed.includes('seed_tracks=')) {
        const parts = seed.split('seed_tracks=')
        if (parts[1]) id = parts[1].split('&')[0] ?? seed
      }
      const res = await httpGet(
        `${AURIS_CLIENT_API}/inspiredby-mix/v2/seed_to_playlist/spotify:track:${id}?response-format=json`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (!res || res.status !== 200) return _empty()
      const body = JSON.parse(res.body) as { mediaItems?: { uri: string }[] }
      const playlistId = body.mediaItems?.[0]?.uri.split(':')[2]
      if (playlistId) return this._resolvePlaylist(playlistId)
      return _empty()
    } catch {
      return _empty()
    }
  }

  // Local file URL handler — not supported.
  private _resolveLocalTrack(_url: string): LoadResult {
    return _error('Spotify local files are not supported.', 'common')
  }

  // ─── API helpers ──────────────────────────────────────────────────────────

  // Makes a Spotify API request with automatic auth, retry, and rate-limit handling.
  private async _apiGet<T>(path: string, token: string, retry = 0): Promise<T | null> {
    const url = path.startsWith('http') ? path : `${AURIS_API}${path}`
    const res = await httpGet(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      }
    })
    if (!res) return null

    if (res.status === 429 && retry < 3) {
      const wait = parseInt(res.headers['retry-after'] as string ?? '5', 10)
      log('warn', 'Spotify', `Rate limited — waiting ${wait}s`)
      await new Promise(r => setTimeout(r, wait * 1000))
      return this._apiGet<T>(path, token, retry + 1)
    }

    if (res.status === 401 && retry < 2) {
      const { accessToken } = await getSpotifyToken()
      return this._apiGet<T>(path, accessToken, retry + 1)
    }

    if (res.status !== 200 && res.status !== 201) return null
    try { return JSON.parse(res.body) as T } catch { return null }
  }

  // Runs a GraphQL persisted query against the Pathfinder API.
  private async _gqlRequest<T>(op: GQLOp, variables: Record<string, unknown>, token: string, retry = 0): Promise<T | null> {
    const res = await httpGet(AURIS_PATHFINDER, {
      method: 'POST',
      headers: {
        Authorization:        `Bearer ${token}`,
        'Content-Type':       'application/json; charset=utf-8',
        Accept:               'application/json',
        'Accept-Language':    'en-US,en;q=0.9',
        'App-Platform':       'WebPlayer',
        'Spotify-App-Version': '1.2.87.221.ge160d899',
        Referer:              'https://open.spotify.com/',
      },
      body: JSON.stringify({ variables, operationName: op.name, extensions: { persistedQuery: { version: 1, sha256Hash: op.hash } } })
    })
    if (!res) return null

    if (res.status === 429 && retry < 3) {
      const wait = parseInt(res.headers['retry-after'] as string ?? '5', 10)
      await new Promise(r => setTimeout(r, wait * 1000))
      return this._gqlRequest<T>(op, variables, token, retry + 1)
    }

    if (res.status !== 200 && res.status !== 201) return null
    try {
      const json = JSON.parse(res.body) as { data?: T; errors?: unknown[] }
      if (json.errors?.length) { log('warn', 'Spotify', `GQL error in ${op.name}`); return null }
      return json.data ?? null
    } catch { return null }
  }

  // Fetches internal track metadata (ISRC) from the client API.
  private async _fetchTrackMetadata(id: string, token: string): Promise<SpotifyMetadataResponse | null> {
    const hex = this._base62ToHex(id)
    const res = await httpGet(`${AURIS_CLIENT_API}/metadata/4/track/${hex}?market=from_token`, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'App-Platform': 'WebPlayer',
      }
    })
    if (!res || res.status !== 200) return null
    try { return JSON.parse(res.body) as SpotifyMetadataResponse } catch { return null }
  }

  // Converts a Spotify Base62 ID to 32-char hex.
  private _base62ToHex(id: string): string {
    const alpha = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
    let bn = 0n
    for (const c of id) bn = bn * 62n + BigInt(alpha.indexOf(c))
    return bn.toString(16).padStart(32, '0')
  }

  // ─── Track builders ───────────────────────────────────────────────────────

  // Builds a Track from an internal GraphQL response node.
  private _buildGQLTrack(item: SpotifyGQLTrack, artwork: string | null = null): Track | null {
    if (!item.uri || this._isLocalGQL(item)) return null
    const id = item.uri.split(':').pop() ?? ''
    const info: TrackInfo = {
      identifier: id,
      isSeekable:  true,
      author:      this._gqlAuthor(item),
      length:      item.duration?.totalMilliseconds ?? item.trackDuration?.totalMilliseconds ?? 0,
      isStream:    false,
      position:    0,
      title:       item.name,
      uri:         `https://open.spotify.com/track/${id}`,
      artworkUrl:  artwork ?? item.albumOfTrack?.coverArt?.sources?.[0]?.url ?? item.album?.images?.[0]?.url ?? null,
      isrc:        item.externalIds?.isrc ?? null,
      sourceName:  'spotify',
    }
    return { encoded: encodeTrack(info), info, pluginInfo: {} }
  }

  // Builds a Track from an official Web API track object.
  private _buildTrack(item: SpotifyApiTrack, artwork?: string): Track | null {
    if (!item.id || item.is_local) return null
    const info: TrackInfo = {
      identifier: item.id,
      isSeekable:  true,
      author:      item.artists.map(a => a.name).join(', ') || 'Unknown',
      length:      item.duration_ms,
      isStream:    false,
      position:    0,
      title:       item.name,
      uri:         item.external_urls.spotify,
      artworkUrl:  artwork ?? item.album?.images?.[0]?.url ?? null,
      isrc:        item.external_ids?.isrc ?? null,
      sourceName:  'spotify',
    }
    return { encoded: encodeTrack(info), info, pluginInfo: {} }
  }

  // ─── GQL search processing ────────────────────────────────────────────────

  // Processes GraphQL search results into AurisLink Track objects.
  private _processGQLSearch(data: SpotifyGQLSearchResponse): Track[] {
    const tracks: Track[] = []
    const v2 = data.searchV2
    if (!v2) return tracks
    for (const it of v2.tracksV2?.items ?? []) {
      const t = this._buildGQLTrack(it.item.data)
      if (t) tracks.push(t)
    }
    return tracks
  }

  // ─── Utility ──────────────────────────────────────────────────────────────

  // Returns true if the resource is a Spotify local file.
  private _isLocalGQL(it: SpotifyGQLTrack | SpotifyApiTrack): boolean {
    if (!it) return false
    return (it as SpotifyApiTrack).is_local === true || !!(it as SpotifyGQLTrack).uri?.startsWith('spotify:local:')
  }

  // Joins artist names from internal or official structures.
  private _gqlAuthor(it: SpotifyGQLTrack): string {
    const items = it.artists?.items
    if (items?.length) return items.map(a => a.profile?.name ?? a.name ?? '').join(', ')
    const first = it.firstArtist?.items?.[0]
    if (first) return first.profile?.name ?? 'Unknown'
    return 'Unknown'
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
function _error(message: string, severity: 'common' | 'suspicious' | 'fault'): LoadResult {
  return { loadType: 'error', data: { message, severity, cause: 'SpotifyError' } }
}
function _spDcEnabled(): boolean {
  // Check if sp_dc was configured (accessed via configureSpotifyAuth internals)
  return false // getMobileToken handles the guard internally
}
