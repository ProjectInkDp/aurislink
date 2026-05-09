import { StreamingNonMusicClient } from './skeleton/StreamingNonMusicClient.js'
import { YoutubeAudioSourceManager } from '../manager.js'

export class Android extends StreamingNonMusicClient {
  public static CLIENT_VERSION = '19.44.38'
  public static OS_VERSION = '11'
  public static SDK_VERSION = 30

  public getIdentifier(): string {
    return 'ANDROID'
  }

  public getPlayerParams(): string | null {
    return null
  }

  public getBaseClientConfig(): any {
    return {
      clientName: 'ANDROID',
      clientVersion: Android.CLIENT_VERSION,
      androidSdkVersion: Android.SDK_VERSION,
      platform: 'ANDROID',
      hl: 'en-US',
      gl: 'US'
    }
  }

  public canHandleRequest(identifier: string): boolean {
    return identifier.startsWith('ytsearch:') || identifier.includes('list=') || identifier.length === 11 || identifier.includes('youtube.com') || identifier.includes('youtu.be')
  }

  public requirePlayerScript(): boolean {
    return false
  }

  protected extractPlaylistName(json: any): string | null {
    return json.header?.pageHeaderRenderer?.content?.elementRenderer?.newElement?.type?.componentType?.model?.youtubeModel?.viewModel?.pageHeaderViewModel?.title?.dynamicTextViewModel?.text?.content || 'YouTube Playlist'
  }

  protected extractPlaylistVideoList(json: any): any {
    return json.contents?.sectionListRenderer?.contents?.[0]?.playlistVideoListRenderer || {}
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
    const sectionList = json.contents?.sectionListRenderer?.contents || []
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
