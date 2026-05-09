import { log } from '../../../../shared/reporter.js'
import { Client } from './Client.js'
import { YoutubeAudioSourceManager } from '../../manager.js'

export abstract class NonMusicClient extends Client {
  protected playlistPageCount = 1

  public setPlaylistPageCount(count: number): void {
    this.playlistPageCount = count
  }

  public async loadVideo(source: YoutubeAudioSourceManager, videoId: string): Promise<any> {
    const json = await this.loadTrackInfoFromInnertube(source, videoId)
    const playabilityStatus = json.playabilityStatus || {}

    if (playabilityStatus.status !== 'OK') {
      throw new Error(`Video unplayable: ${playabilityStatus.reason || 'unknown status'}`)
    }

    const videoDetails = json.videoDetails || {}
    return this.buildAudioTrack(
      source,
      json,
      videoDetails.title || 'Unknown',
      videoDetails.author || 'Unknown',
      parseInt(videoDetails.lengthSeconds || '0') * 1000,
      videoId,
      false
    )
  }

  public async loadSearch(source: YoutubeAudioSourceManager, searchQuery: string): Promise<any> {
    if (!this.getOptions().searching) {
      throw new Error('Searching is disabled for this client')
    }

    const json = await this.loadSearchResults(source, searchQuery)
    const tracks = this.extractSearchResults(source, json)

    if (tracks.length === 0) {
      return null
    }

    return {
      name: `Search results for: ${searchQuery}`,
      tracks,
      selectedTrack: null,
      isSearchResult: true
    }
  }

  public async loadPlaylist(source: YoutubeAudioSourceManager, playlistId: string, selectedVideoId?: string): Promise<any> {
    if (!this.getOptions().playlistLoading) {
      throw new Error('Playlist loading is disabled for this client')
    }

    const json = await this.loadPlaylistResult(source, playlistId)
    const playlistName = this.extractPlaylistName(json)
    if (!playlistName) {
      throw new Error('Failed to extract playlist name')
    }

    const playlistVideoList = this.extractPlaylistVideoList(json)
    const tracks: any[] = []
    this.extractPlaylistTracks(playlistVideoList, tracks, source)

    // Simplified continuation logic for now
    if (tracks.length === 0) {
      throw new Error('Could not find tracks from playlist')
    }

    return {
      name: playlistName,
      tracks,
      selectedTrack: this.findSelectedTrack(tracks, selectedVideoId),
      isSearchResult: false
    }
  }

  protected abstract extractPlaylistName(json: any): string | null
  protected abstract extractPlaylistVideoList(json: any): any
  protected abstract extractPlaylistTracks(json: any, tracks: any[], source: YoutubeAudioSourceManager): void
  protected abstract extractSearchResults(source: YoutubeAudioSourceManager, json: any): any[]
  public async loadSearchMusic(source: YoutubeAudioSourceManager, searchQuery: string): Promise<any> {
    throw new Error('This client cannot search music')
  }
  protected async loadPlaylistResult(source: YoutubeAudioSourceManager, playlistId: string): Promise<any> {
    return this.loadSearchResults(source, `list=${playlistId}`)
  }
}
