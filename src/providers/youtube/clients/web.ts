import { StreamingNonMusicClient } from './skeleton/StreamingNonMusicClient.js'
import { YoutubeAudioSourceManager } from '../manager.js'

export class Web extends StreamingNonMusicClient {
  public static CLIENT_VERSION = '2.20241112.04.00'

  public getIdentifier(): string {
    return 'WEB'
  }

  public getPlayerParams(): string | null {
    return '2AMB'
  }

  public getBaseClientConfig(): any {
    return {
      clientName: 'WEB',
      clientVersion: Web.CLIENT_VERSION,
      platform: 'DESKTOP',
      hl: 'en-US',
      gl: 'US'
    }
  }

  public canHandleRequest(identifier: string): boolean {
    return true
  }

  protected extractPlaylistName(json: any): string | null {
    return json.metadata?.playlistMetadataRenderer?.title || 'YouTube Playlist'
  }

  protected extractPlaylistVideoList(json: any): any {
    return json.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents?.[0]?.playlistVideoListRenderer || {}
  }

  protected extractPlaylistTracks(json: any, tracks: any[], source: YoutubeAudioSourceManager): void {
    const items = json.contents || []
    for (const item of items) {
      const video = item.playlistVideoRenderer
      if (video) {
        tracks.push(this.buildAudioTrack(
          source,
          video,
          video.title?.runs?.[0]?.text || 'Unknown',
          video.shortBylineText?.runs?.[0]?.text || 'Unknown',
          parseInt(video.lengthSeconds || '0') * 1000,
          video.videoId,
          false
        ))
      }
    }
  }

  protected extractSearchResults(source: YoutubeAudioSourceManager, json: any): any[] {
    const tracks: any[] = []
    const sectionList = json.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || []
    for (const section of sectionList) {
      const contents = section.itemSectionRenderer?.contents || []
      for (const content of contents) {
        const video = content.videoRenderer
        if (video) {
          tracks.push(this.buildAudioTrack(
            source,
            video,
            video.title?.runs?.[0]?.text || 'Unknown',
            video.shortBylineText?.runs?.[0]?.text || 'Unknown',
            parseInt(video.lengthSeconds || '0') * 1000,
            video.videoId,
            false
          ))
        }
      }
    }
    return tracks
  }
}
