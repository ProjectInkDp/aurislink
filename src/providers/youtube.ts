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
    return url.includes('youtube.com') || url.includes('youtu.be') || url.includes('music.youtube.com')
  }

  private async _refreshTokens() {
    log('info', 'YouTube', 'Refreshing InnerTube tokens...')
    try {
      // Tenta pegar do YTM primeiro por ser mais limpo
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
    } catch (err) {
      log('error', 'YouTube', `Error refreshing tokens: ${err}`)
    }
  }

  private async _ensureTokens() {
    if (!this._apiKey || !this._visitorData || (Date.now() - this._lastRefresh > this._refreshInterval)) {
      await this._refreshTokens()
    }
  }

  async load(url: string): Promise<LoadResult> {
    const videoId = this._extractVideoId(url)
    if (!videoId) return _empty()

    await this._ensureTokens()
    if (!this._apiKey) return _error('YouTube API Key not available', 'fault')

    // Tenta carregar metadados via Player API (funciona para YTM e YT Normal)
    const playerUrl = `https://music.youtube.com/youtubei/v1/player?key=${this._apiKey}`
    const payload = {
      context: {
        client: {
          clientName: 'WEB_REMIX',
          clientVersion: this._clientVersion,
          visitorData: this._visitorData
        }
      },
      videoId
    }

    const res = await httpPostJson(playerUrl, payload)
    if (!res || res.status !== 200) return _error('Failed to load video metadata', 'common')

    try {
      const data = JSON.parse(res.body)
      if (data.playabilityStatus?.status !== 'OK') return _error(`Video unavailable: ${data.playabilityStatus?.status}`, 'common')

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
        data: {
          encoded: encodeTrack(info),
          info,
          pluginInfo: {}
        }
      }
    } catch (err) {
      return _error('Failed to parse video metadata', 'common')
    }
  }

  async search(query: string): Promise<LoadResult> {
    await this._ensureTokens()
    if (!this._apiKey) return _error('YouTube API Key not available', 'fault')

    // Tenta busca no YouTube Music (WEB_REMIX)
    let result = await this._doSearch(query, 'WEB_REMIX')
    
    // Fallback para YouTube Normal (WEB) se não encontrar nada ou for pedido via prefixo
    if (result.loadType === 'empty' || query.startsWith('ytsearch:')) {
      result = await this._doSearch(query.replace('ytsearch:', ''), 'WEB')
    }

    return result
  }

  private async _doSearch(query: string, clientName: 'WEB_REMIX' | 'WEB'): Promise<LoadResult> {
    const url = `https://www.youtube.com/youtubei/v1/search?key=${this._apiKey}`
    const payload = {
      context: {
        client: {
          clientName,
          clientVersion: clientName === 'WEB_REMIX' ? this._clientVersion : '2.20240501.01.00',
          hl: 'en',
          gl: 'US',
          visitorData: this._visitorData
        }
      },
      query
    }

    const res = await httpPostJson(url, payload)
    if (!res || res.status !== 200) return _empty()

    try {
      const data = JSON.parse(res.body)
      const tracks = clientName === 'WEB_REMIX' 
        ? this._parseYtmResults(data) 
        : this._parseYtResults(data)

      if (tracks.length === 0) return _empty()

      return {
        loadType: 'search',
        data: tracks
      }
    } catch {
      return _empty()
    }
  }

  private _parseYtmResults(data: any): Track[] {
    const tracks: Track[] = []
    const sections = data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || []
    for (const section of sections) {
      const shelf = section.musicShelfRenderer || section.musicCardShelfRenderer
      if (!shelf) continue
      const contents = shelf.contents || []
      for (const item of contents) {
        const renderer = item.musicResponsiveListItemRenderer || item
        const info = this._extractTrackInfo(renderer, true)
        if (info) tracks.push({ encoded: encodeTrack(info), info, pluginInfo: {} })
      }
    }
    return tracks
  }

  private _parseYtResults(data: any): Track[] {
    const tracks: Track[] = []
    const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || []
    for (const item of contents) {
      const renderer = item.videoRenderer
      if (!renderer) continue
      const info = this._extractTrackInfo(renderer, false)
      if (info) tracks.push({ encoded: encodeTrack(info), info, pluginInfo: {} })
    }
    return tracks
  }

  private _extractTrackInfo(renderer: any, isMusic: boolean): TrackInfo | null {
    try {
      const videoId = isMusic 
        ? (renderer.navigationEndpoint?.watchEndpoint?.videoId || renderer.title?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId)
        : renderer.videoId
      
      if (!videoId) return null

      const title = isMusic 
        ? (renderer.title?.runs?.[0]?.text || 'Unknown Title')
        : (renderer.title?.runs?.[0]?.text || renderer.title?.simpleText)
      
      const author = isMusic
        ? (renderer.subtitle?.runs?.[0]?.text || 'Unknown Artist')
        : (renderer.ownerText?.runs?.[0]?.text || renderer.shortBylineText?.runs?.[0]?.text)

      return {
        identifier: videoId,
        isSeekable: true,
        author: author || 'Unknown',
        length: 0, // Duração simplificada para busca
        isStream: false,
        position: 0,
        title,
        uri: `https://www.youtube.com/watch?v=${videoId}`,
        artworkUrl: renderer.thumbnail?.thumbnails?.[0]?.url || null,
        isrc: null,
        sourceName: 'youtube'
      }
    } catch {
      return null
    }
  }

  private _extractVideoId(url: string): string | null {
    const match = url.match(/(?:v=|\/)([0-9A-Za-z_-]{11}).*/)
    return match ? match[1] : null
  }
}

function _empty(): LoadResult { return { loadType: 'empty', data: {} } }
function _error(message: string, severity: 'common' | 'suspicious' | 'fault'): LoadResult {
  return { loadType: 'error', data: { message, severity, cause: 'YouTubeError' } }
}
