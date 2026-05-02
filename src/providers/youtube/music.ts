import { InnerTubeClient, type InnerTubeClientType } from '../../clients/innertube.js'
import { encodeTrack } from '../../shared/media.js'
import { log } from '../../shared/reporter.js'
import type { LoadResult, Source, Track, TrackInfo, AurisConfig } from '../../typings/index.js'

export class YoutubeMusicSource implements Source {
  public readonly name = 'ytmusic'
  public readonly searchPrefixes = ['ytmsearch']
  
  private _clients: InnerTubeClient[] = []
  private _allowFallback: boolean

  constructor(config: AurisConfig) {
    const ytm = config.sources.ytmusic ?? { enabled: false }
    const clientTypes = (ytm.clients as InnerTubeClientType[]) || ['WEB_REMIX', 'ANDROID_MUSIC']
    this._allowFallback = ytm.allowFallback ?? true

    for (const type of clientTypes) {
      this._clients.push(new InnerTubeClient(type))
    }
  }

  async setup(): Promise<boolean> {
    let anyOk = false
    for (const client of this._clients) {
      if (await client.getContext()) anyOk = true
    }
    return anyOk
  }

  accepts(url: string): boolean {
    return url.includes('music.youtube.com')
  }

  async load(url: string): Promise<LoadResult> {
    const videoId = this._extractVideoId(url)
    if (!videoId) return _empty()

    for (const client of this._clients) {
      const data = await client.request('player', { videoId })
      if (data && data.playabilityStatus?.status === 'OK') {
        const v = data.videoDetails
        const info: TrackInfo = {
          identifier: v.videoId,
          isSeekable: true,
          author: v.author,
          length: parseInt(v.lengthSeconds) * 1000,
          isStream: v.isLiveContent || false,
          position: 0,
          title: v.title,
          uri: `https://music.youtube.com/watch?v=${v.videoId}`,
          artworkUrl: v.thumbnail?.thumbnails?.pop()?.url || null,
          isrc: null,
          sourceName: 'ytmusic'
        }

        return {
          loadType: 'track',
          data: { encoded: encodeTrack(info), info, pluginInfo: {} }
        }
      }

      if (!this._allowFallback) break
      log('warn', 'YouTubeMusic', `Client failed for ${videoId}, trying next...`)
    }

    return _empty()
  }

  async search(query: string): Promise<LoadResult> {
    // Busca sempre usa o primeiro cliente configurado (geralmente WEB_REMIX)
    const client = this._clients[0]
    if (!client) return _empty()

    const data = await client.request('search', { query })
    if (!data) return _empty()

    const tracks: Track[] = []
    const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || []
    
    for (const section of sections) {
      const shelf = section.musicShelfRenderer || section.musicCardShelfRenderer
      if (!shelf) continue
      for (const item of shelf.contents || []) {
        const renderer = item.musicResponsiveListItemRenderer || item
        const info = this._extractTrackInfo(renderer)
        if (info) tracks.push({ encoded: encodeTrack(info), info, pluginInfo: {} })
      }
    }

    return tracks.length > 0 ? { loadType: 'search', data: tracks } : _empty()
  }

  private _extractTrackInfo(renderer: any): TrackInfo | null {
    const videoId = renderer.navigationEndpoint?.watchEndpoint?.videoId || 
                    renderer.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId
    if (!videoId) return null

    return {
      identifier: videoId,
      isSeekable: true,
      author: renderer.subtitle?.runs?.[0]?.text || 'Unknown Artist',
      length: 0,
      isStream: false,
      position: 0,
      title: renderer.title?.runs?.[0]?.text || 'Unknown Title',
      uri: `https://music.youtube.com/watch?v=${videoId}`,
      artworkUrl: renderer.thumbnail?.thumbnails?.[0]?.url || null,
      isrc: null,
      sourceName: 'ytmusic'
    }
  }

  private _extractVideoId(url: string): string | null {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1]! : null
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
