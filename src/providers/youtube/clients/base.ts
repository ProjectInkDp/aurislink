import { log } from '../../../shared/reporter.js'

export interface ClientConfig {
  name: string
  clientName: string
  clientVersion: string
  platform: string
  hl: string
  gl: string
  remoteHost: string
  visitorData?: string
}

export abstract class YoutubeClient {
  protected poToken: string | null = null
  protected visitorData: string | null = null

  constructor(public readonly options: any = {}) {}

  public setPoTokenAndVisitorData(poToken: string | null, visitorData: string | null): void {
    this.poToken = poToken
    this.visitorData = visitorData
  }

  public abstract getIdentifier(): string
  public abstract getBaseClientConfig(): ClientConfig
  
  protected getBasePayload() {
    const config = this.getBaseClientConfig()
    return {
      context: {
        client: {
          clientName: config.clientName,
          clientVersion: config.clientVersion,
          platform: config.platform,
          hl: config.hl,
          gl: config.gl,
          visitorData: this.visitorData || config.visitorData
        }
      }
    }
  }
}
