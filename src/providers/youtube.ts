import { httpGet, httpPostJson } from '../shared/http.js'
import { log } from '../shared/reporter.js'
import { encodeTrack } from '../shared/media.js'
import type { LoadResult, Source, Track, TrackInfo } from '../typings/index.js'

export class YoutubeMusicSource implements Source {
  public readonly name = 'youtube'
  public readonly searchPrefixes = ['ytsearch', 'ytmsearch']
  
  private _apiKey: string | null = null
  private _visitorData: string | null = null
  private _clientVersion = '1.20260428.11.00'
  private _lastRefresh = 0
  private _refreshInterval = 3600 * 1000 // 1 hora

  async setup(): Promise<boolean> {
    await this._refreshTokens()
    return !!this._apiKey
  }

  accepts(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be')
  }

  private async _refreshTokens() {
    log('info', 'YouTube', 'Refreshing InnerTube tokens...')
    const res = await httpGet('https://music.youtube.com/')
    if (!res) return

    const apiKeyMatch = res.body.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
    const visitorDataMatch = res.body.match(/"VISITOR_DATA":"([^"]+)"/)
    const clientVersionMatch = res.body.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)

    if (apiKeyMatch) this._apiKey = apiKeyMatch[1]
    if (visitorDataMatch) this._visitorData = visitorDataMatch[1]
    if (clientVersionMatch) this._clientVersion = clientVersionMatch[1]

    if (this._apiKey && this._visitorData) {
      this._lastRefresh = Date.now()
      log('info', 'YouTube', 'Tokens refreshed successfully.')
    } else {
      log('warn', 'YouTube', 'Failed to extract tokens from page.')
    }
  }

  private async _ensureTokens() {
    if (!this._apiKey || !this._visitorData || (Date.now() - this._lastRefresh > this._refreshInterval)) {
      await this._refreshTokens()
    }
  }

  async load(url: string): Promise<LoadResult> {
    // Implementação básica de carregamento de URL (pode ser expandida depois)
    return _empty()
  }

  async search(query: string): Promise<LoadResult> {
    await this._ensureTokens()
    if (!this._apiKey) return _error('YouTube API Key not available', 'fault')

    const url = `https://music.youtube.com/youtubei/v1/search?key=${this._apiKey}`
    const payload = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: this._clientVersion,
          hl: 'en',
          gl: 'US',
          visitorData: this._visitorData
        }
      },
      query
    }

    const res = await httpPostJson(url, payload)
    if (!res || res.status !== 200) return _error('Search failed', 'common')

    try {
      const data = JSON.parse(res.body)
      const tracks = this._parseSearchResults(data)
      return {
        loadType: 'search',
        data: tracks
      }
    } catch (err) {
      return _error('Failed to parse search results', 'common')
    }
  }

  private _parseSearchResults(data: any): Track[] {
    const tracks: Track[] = []
    const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || []
    
    for (const section of sections) {
      const shelf = section.musicShelfRenderer || section.musicCardShelfRenderer
      if (!shelf) continue

      const contents = shelf.contents || []
      if (section.musicCardShelfRenderer) contents.push(section.musicCardShelfRenderer)

      for (const item of contents) {
        const renderer = item.musicResponsiveListItemRenderer || item
        const info = this._extractTrackInfo(renderer)
        if (info) {
          tracks.push({
            encoded: encodeTrack(info),
            info,
            pluginInfo: {}
          })
        }
      }
    }
    return tracks
  }

  private _extractTrackInfo(renderer: any): TrackInfo | null {
    try {
      const videoId = renderer.navigationEndpoint?.watchEndpoint?.videoId || 
                      renderer.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId
      if (!videoId) return null

      const title = renderer.title?.runs?.[0]?.text || 'Unknown Title'
      const author = renderer.subtitle?.runs?.[0]?.text || 'Unknown Artist'
      const lengthText = renderer.subtitle?.runs?.find((r: any) => r.text.includes(':'))?.text
      const length = lengthText ? this._parseDuration(lengthText) : 0

      return {
        identifier: videoId,
        isSeekable: true,
        author,
        length,
        isStream: false,
        position: 0,
        title,
        uri: `https://music.youtube.com/watch?v=${videoId}`,
        artworkUrl: renderer.thumbnail?.thumbnails?.[0]?.url || renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]?.url || null,
        isrc: null,
        sourceName: 'youtube'
      }
    } catch {
      return null
    }
  }

  private _parseDuration(time: string): number {
    const parts = time.split(':').map(Number)
    if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000
    if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000
    return 0
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
function _error(message: string, severity: 'common' | 'suspicious' | 'fault'): LoadResult {
  return { loadType: 'error', data: { message, severity, cause: 'YouTubeError' } }
}
