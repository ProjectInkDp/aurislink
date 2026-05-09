import { Client, DEFAULT_OPTIONS } from './skeleton/Client.js'
import { YoutubeAudioSourceManager } from '../manager.js'
import { TrackFormats } from '../track/TrackFormats.js'

export class Music extends Client {
  public getIdentifier(): string {
    return 'WEB_REMIX'
  }

  public getPlayerParams(): string | null {
    return null
  }

  public getBaseClientConfig(): any {
    return {
      clientName: 'WEB_REMIX',
      clientVersion: '1.20240724.00.00',
      hl: 'en-US',
      gl: 'US'
    }
  }

  public canHandleRequest(identifier: string): boolean {
    return identifier.startsWith('ytmsearch:')
  }

  public setPlaylistPageCount(count: number): void {
    // No-op
  }

  public async loadFormats(source: YoutubeAudioSourceManager, videoId: string): Promise<TrackFormats> {
    throw new Error('Music client does not support format loading')
  }

  public async loadVideo(source: YoutubeAudioSourceManager, videoId: string): Promise<any> {
    throw new Error('Music client does not support video loading')
  }

  public async loadSearch(source: YoutubeAudioSourceManager, searchQuery: string): Promise<any> {
    throw new Error('Music client does not support normal search')
  }

  public async loadSearchMusic(source: YoutubeAudioSourceManager, searchQuery: string): Promise<any> {
    const json = await this.loadSearchResults(source, searchQuery)
    const tracks = this.extractMusicSearchResults(source, json)

    if (tracks.length === 0) {
      return null
    }

    return {
      name: `Search music results for: ${searchQuery}`,
      tracks,
      selectedTrack: null,
      isSearchResult: true
    }
  }

  public async loadPlaylist(source: YoutubeAudioSourceManager, playlistId: string, selectedVideoId?: string): Promise<any> {
    throw new Error('Music client does not support playlist loading')
  }

  private extractMusicSearchResults(source: YoutubeAudioSourceManager, json: any): any[] {
    const tracks: any[] = []
    const shelf = json.contents?.sectionListRenderer?.contents?.find((c: any) => c.musicShelfRenderer)?.musicShelfRenderer
    if (!shelf) return tracks

    for (const content of shelf.contents || []) {
      const video = content.musicResponsiveListItemRenderer
      if (video) {
        const flexColumns = video.flexColumns || []
        const title = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || 'Unknown'
        const author = flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text || 'Unknown artist'
        const videoId = flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.navigationEndpoint?.watchEndpoint?.videoId

        if (videoId) {
          tracks.push(this.buildAudioTrack(
            source,
            video,
            title,
            author,
            0, // Duration often missing in music search results
            videoId,
            false
          ))
        }
      }
    }
    return tracks
  }
}
