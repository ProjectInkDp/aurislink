import { log } from '../../shared/reporter.js'
import { YoutubeAudioSourceManager } from './manager.js'
import type { AurisConfig } from '../../typings/index.js'

export class YoutubeSource {
  private readonly manager: YoutubeAudioSourceManager
  public readonly name: any = 'youtube'
  public readonly searchPrefixes = ['ytsearch']

  constructor(config: AurisConfig) {
    log('info', 'YouTube', 'Initializing comprehensive ported YouTube Source...')
    this.manager = new YoutubeAudioSourceManager(config)
  }

  public async setup(): Promise<boolean> {
    return await this.manager.setup()
  }

  public async search(query: string): Promise<any> {
    return this.load(`ytsearch:${query}`)
  }

  public accepts(url: string): boolean {
    return url.includes('youtube.com') || url.includes('youtu.be')
  }

  public async load(identifier: string): Promise<any> {
    const result = await this.manager.loadItem(identifier)
    if (!result) {
      return {
        loadType: 'error',
        data: {
          message: 'Video unplayable or not found',
          severity: 'common'
        }
      }
    }

    // If it's a single track, we need to resolve the playback URL
    if (result.info && !result.tracks) {
      const videoId = result.info.identifier
      for (const client of this.manager.getClients()) {
        if (client.supportsFormatLoading()) {
          try {
            const trackFormats = await client.loadFormats(this.manager, videoId)
            const bestFormat = trackFormats.getBestAudioFormat()
            if (bestFormat) {
              const playbackUrl = await this.manager.getCipherManager().resolveFormatUrl(bestFormat)
              return {
                loadType: 'track',
                data: {
                  ...result,
                  pluginInfo: {
                    url: playbackUrl
                  }
                }
              }
            }
          } catch (err) {
            log('debug', 'YouTube', `Client ${client.getIdentifier()} failed to resolve formats for ${videoId}: ${err}`)
          }
        }
      }
    }

    return {
      loadType: result.tracks ? 'playlist' : 'track',
      data: result
    }
  }
}
