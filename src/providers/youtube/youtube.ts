import { InnerTubeClient, type InnerTubeClientType } from '../../clients/innertube.js'
import { CookieManager } from '../../security/cookie-manager.js'
import { encodeTrack } from '../../shared/media.js'
import { log } from '../../shared/reporter.js'
import type { LoadResult, Source, Track, TrackInfo, AurisConfig } from '../../typings/index.js'

export class YoutubeSource implements Source {
  public readonly name = 'youtube'
  public readonly searchPrefixes = ['ytsearch']
  
  private _clients: InnerTubeClient[] = []
  private _allowFallback: boolean
  private _cookieManager: CookieManager | null = null

  constructor(config: AurisConfig) {
    const yt = config.sources.youtube ?? { enabled: false }
    const clientTypes = (yt.clients as InnerTubeClientType[]) || ['WEB', 'TVHTML5', 'ANDROID']
    this._allowFallback = yt.allowFallback ?? true

    // Initialize cookie manager if cookies file is configured
    if (yt.cookies?.enabled && yt.cookies?.path) {
      this._cookieManager = new CookieManager(yt.cookies.path)
      if (this._cookieManager.isLoaded()) {
        log('info', 'YouTube', `Loaded ${this._cookieManager.getCount()} cookies from ${yt.cookies.path}`)
      }
    }

    for (const type of clientTypes) {
      const client = new InnerTubeClient(type, this._cookieManager || undefined)
      this._clients.push(client)
    }
  }

  async setup(): Promise<boolean> {
    let anyOk = false
    for (const client of this._clients) {
      if (await client.getContext()) anyOk = true
    }
    
    if (anyOk && this._cookieManager?.isLoaded()) {
      log('info', 'YouTube', `Setup complete with ${this._cookieManager.getCount()} cookies`)
    }
    
    return anyOk
  }

  /**
   * Update cookie manager (useful for runtime cookie updates)
   */
  setCookies(cookieManager: CookieManager | null): void {
    this._cookieManager = cookieManager
    for (const client of this._clients) {
      client.setCookieManager(cookieManager)
    }
  }

  accepts(url: string): boolean {
    return (url.includes('youtube.com') || url.includes('youtu.be')) && !url.includes('music.youtube.com')
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

      if (!this._allowFallback) break
      log('warn', 'YouTube', `Client failed for ${videoId}, trying next...`)
    }

    return _empty()
  }

  async search(query: string): Promise<LoadResult> {
    const client = this._clients[0]
    if (!client) return _empty()

    const data = await client.request('search', { query })
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

  /**
   * Get cookie manager instance
   */
  getCookieManager(): CookieManager | null {
    return this._cookieManager
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }

