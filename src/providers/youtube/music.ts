import { YoutubeSource } from './youtube.js'
import type { AurisConfig } from '../../typings/index.js'

export class YoutubeMusicSource extends YoutubeSource {
  public override readonly name: any = 'ytmusic'
  public override readonly searchPrefixes = ['ytmsearch']

  constructor(config: AurisConfig) {
    super(config)
  }

  public search(query: string): Promise<any> {
    return this.load(`ytmsearch:${query}`)
  }

  public accepts(url: string): boolean {
    return url.includes('music.youtube.com')
  }
}
