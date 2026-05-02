import { InnerTubeClient } from '../../clients/innertube.js'
import { encodeTrack } from '../../shared/media.js'
import type { LoadResult, Source, Track, TrackInfo } from '../../typings/index.js'

export class YoutubeSource implements Source {
  public readonly name = 'youtube'
  public readonly searchPrefixes = ['ytsearch']
  private _client = new InnerTubeClient('WEB')

  async setup(): Promise<boolean> {
    return !!(await this._client.getContext())
  }

  accepts(url: string): boolean {
    return (url.includes('youtube.com') || url.includes('youtu.be')) && !url.includes('music.youtube.com')
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
      uri: `https://www.youtube.com/watch?v=${v.videoId}`,
      artworkUrl: v.thumbnail?.thumbnails?.pop()?.url || null,
      isrc: null,
      sourceName: 'youtube'
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
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || []
    
    for (const item of contents) {
      const renderer = item.videoRenderer
      if (!renderer) continue
      
      const info: TrackInfo = {
        identifier: renderer.videoId,
        isSeekable: true,
        author: renderer.ownerText?.runs?.[0]?.text || 'Unknown',
        length: 0,
        isStream: false,
        position: 0,
        title: renderer.title?.runs?.[0]?.text || renderer.title?.simpleText,
        uri: `https://www.youtube.com/watch?v=${renderer.videoId}`,
        artworkUrl: renderer.thumbnail?.thumbnails?.[0]?.url || null,
        isrc: null,
        sourceName: 'youtube'
      }
      tracks.push({ encoded: encodeTrack(info), info, pluginInfo: {} })
    }

    return tracks.length > 0 ? { loadType: 'search', data: tracks } : _empty()
  }

  private _extractVideoId(url: string): string | null {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1]! : null
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
