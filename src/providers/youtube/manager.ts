import { log } from '../../shared/reporter.js'
import { Client } from './clients/skeleton/Client.js'
import { Web } from './clients/web.js'
import { Android } from './clients/android.js'
import { Music } from './clients/music.js'
import { CipherManager } from './cipher/manager.js'
import { YoutubeOauth2Handler } from './http/oauth2.js'
import { POTokenManager } from './http/potoken.js'
import type { AurisConfig } from '../../typings/index.js'

export class YoutubeAudioSourceManager {
  private readonly clients: Client[]
  private readonly cipherManager: CipherManager
  private readonly oauth2Handler: YoutubeOauth2Handler

  constructor(config: AurisConfig) {
    this.cipherManager = new CipherManager(config.sources.youtube)
    this.oauth2Handler = new YoutubeOauth2Handler()
    this.clients = [
      new Music(),
      new Android(),
      new Web()
    ]
  }

  public async setup(config: AurisConfig): Promise<boolean> {
    log('info', 'YouTube', 'Initializing YouTube Source Manager with official ported structure...')
    
    const ytConfig = config.sources.youtube
    if (ytConfig?.pot) {
      POTokenManager.setTokens(ytConfig.pot.token || null, ytConfig.pot.visitorData || null)
    }

    if (ytConfig?.oauth?.enabled) {
      this.oauth2Handler.setRefreshToken(ytConfig.oauth.refreshToken || null)
      if (!ytConfig.oauth.skipInitialization) {
        await this.oauth2Handler.initialize()
      }
    }

    // Pre-fetch player script for cipher logic
    await this.cipherManager.getPlayerScript()
    
    return true
  }

  public getClients(): Client[] {
    return this.clients
  }

  public getCipherManager(): CipherManager {
    return this.cipherManager
  }

  public getOauth2Handler(): YoutubeOauth2Handler {
    return this.oauth2Handler
  }

  public async loadItem(identifier: string): Promise<any> {
    for (const client of this.clients) {
      if (client.canHandleRequest(identifier)) {
        try {
          if (identifier.startsWith('ytsearch:')) {
            const query = identifier.substring(9)
            const res = await client.loadSearch(this, query)
            if (res) return res
          } else if (identifier.startsWith('ytmsearch:')) {
            const query = identifier.substring(10)
            const res = await client.loadSearchMusic(this, query)
            if (res) return res
          } else if (identifier.includes('list=')) {
            const playlistId = new URLSearchParams(identifier.split('?')[1] || '').get('list')
            if (playlistId) return await client.loadPlaylist(this, playlistId)
          } else {
            const videoId = this.extractVideoId(identifier)
            if (videoId) return await client.loadVideo(this, videoId)
          }
        } catch (err) {
          log('debug', 'YouTubeManager', `Client ${client.getIdentifier()} failed to load ${identifier}: ${err}`)
        }
      }
    }
    return null
  }

  private extractVideoId(identifier: string): string | null {
    if (identifier.length === 11) return identifier
    try {
      const url = new URL(identifier)
      return url.searchParams.get('v') || identifier
    } catch {
      return identifier.length === 11 ? identifier : null
    }
  }
}
