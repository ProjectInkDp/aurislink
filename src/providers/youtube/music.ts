import { InnerTubeClient } from '../../clients/innertube.js'
import { encodeTrack } from '../../shared/media.js'
import type { LoadResult, Source, Track, TrackInfo } from '../../typings/index.js'

export class YoutubeMusicSource implements Source {
  public readonly name = 'ytmusic'
  public readonly searchPrefixes = ['ytmsearch']
  private _client = new InnerTubeClient('WEB_REMIX')

  async setup(): Promise<boolean> {
    return !!(await this._client.getContext())
  }

  accepts(url: string): boolean {
    return url.includes('music.youtube.com')
  }

  async load(url: string): Promise<LoadResult> {
    const videoId = this._extractVideoId(url)
    if (!videoId) return _empty()

    const data = await this._client.request('player', { videoId })
    if (!data || data.playabilityStatus?.status !== 'OK') return _empty()

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

  async search(query: string): Promise<LoadResult> {
    const data = await this._client.request('search', { query })
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
