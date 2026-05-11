import { log } from '../../../../shared/reporter.js'
import { httpPostJson } from '../../../../shared/http.js'
import { POTokenManager } from '../../http/potoken.js'
import { YoutubeAudioSourceManager } from '../../manager.js'
import { TrackFormats } from '../../track/TrackFormats.js'

export interface ClientOptions {
  playback: boolean
  searching: boolean
  playlistLoading: boolean
  videoLoading: boolean
}

export const DEFAULT_OPTIONS: ClientOptions = {
  playback: true,
  searching: true,
  playlistLoading: true,
  videoLoading: true
}

export abstract class Client {
  public static WATCH_URL = 'https://www.youtube.com/watch?v='
  public static BROWSE_URL = 'https://www.youtube.com/youtubei/v1/browse'
  public static SEARCH_URL = 'https://www.youtube.com/youtubei/v1/search'
  public static PLAYER_URL = 'https://www.youtube.com/youtubei/v1/player'

  public abstract getIdentifier(): string
  public abstract getPlayerParams(): string | null
  public abstract getBaseClientConfig(): any
  public abstract canHandleRequest(identifier: string): boolean

  public getOptions(): ClientOptions {
    return DEFAULT_OPTIONS
  }

  public supportsFormatLoading(): boolean {
    return this.getOptions().playback
  }

  public isEmbedded(): boolean {
    return false
  }

  public supportsOAuth(): boolean {
    return false
  }

  public requirePlayerScript(): boolean {
    return true
  }

  public abstract setPlaylistPageCount(count: number): void

  public abstract loadFormats(source: YoutubeAudioSourceManager, videoId: string): Promise<TrackFormats>
  public abstract loadVideo(source: YoutubeAudioSourceManager, videoId: string): Promise<any>
  public abstract loadSearch(source: YoutubeAudioSourceManager, searchQuery: string): Promise<any>
  public abstract loadSearchMusic(source: YoutubeAudioSourceManager, searchQuery: string): Promise<any>
  public abstract loadPlaylist(source: YoutubeAudioSourceManager, playlistId: string, selectedVideoId?: string): Promise<any>

  protected async loadTrackInfoFromInnertube(source: YoutubeAudioSourceManager, videoId: string): Promise<any> {
    const config = this.getBaseClientConfig()
    const cipher = await source.getCipherManager().getPlayerScript()
    const visitorData = POTokenManager.getVisitorData()
    const poToken = POTokenManager.getPoToken()

    const payload: any = {
      context: {
        client: {
          ...config,
          visitorData
        },
        user: visitorData ? { visitorData } : undefined,
        request: poToken ? { poToken } : undefined
      },
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          signatureTimestamp: cipher?.timestamp || '0'
        }
      }
    }

    if (this.getPlayerParams()) {
      payload.params = this.getPlayerParams()
    }

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Content-Type': 'application/json',
      'X-Youtube-Client-Name': this.getClientCode(),
      'X-Youtube-Client-Version': config.clientVersion,
      'Origin': 'https://www.youtube.com',
      'Referer': 'https://www.youtube.com'
    }

    const res = await httpPostJson(Client.PLAYER_URL, payload, { headers })
    if (!res || !res.body) throw new Error('Failed to load track info from InnerTube')
    return JSON.parse(res.body)
  }

  protected getClientCode(): number {
    switch (this.getIdentifier()) {
      case 'WEB': return 1
      case 'ANDROID': return 3
      case 'ANDROID_MUSIC': return 21
      case 'WEB_REMIX': return 67
      case 'TVHTML5': return 7
      default: return 1
    }
  }

  protected async loadSearchResults(source: YoutubeAudioSourceManager, query: string): Promise<any> {
    const config = this.getBaseClientConfig()
    const payload = {
      context: {
        client: {
          ...config,
          visitorData: POTokenManager.getVisitorData()
        }
      },
      query
    }

    const res = await httpPostJson(Client.SEARCH_URL, payload)
    if (!res || !res.body) throw new Error('Failed to load search results')
    return JSON.parse(res.body)
  }

  protected buildAudioTrack(source: YoutubeAudioSourceManager, json: any, title: string, author: string, duration: number, videoId: string, isStream: boolean): any {
    return {
      encoded: '',
      info: {
        identifier: videoId,
        title,
        author,
        length: duration,
        isStream,
        uri: Client.WATCH_URL + videoId,
        sourceName: 'youtube',
        artworkUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        isrc: null
      }
    }
  }

  protected findSelectedTrack(tracks: any[], selectedVideoId?: string): any {
    if (!selectedVideoId) return null
    return tracks.find(t => t.info.identifier === selectedVideoId) || null
  }
}
