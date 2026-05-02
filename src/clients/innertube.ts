import { httpGet, httpPostJson } from '../shared/http.js'
import { log } from '../shared/reporter.js'

export type InnerTubeClientType = 'WEB' | 'WEB_REMIX' | 'ANDROID' | 'IOS' | 'TV'

export interface InnerTubeContext {
  apiKey: string
  visitorData: string
  clientVersion: string
}

export class InnerTubeClient {
  private _context: InnerTubeContext | null = null
  private _lastRefresh = 0
  private _refreshInterval = 3600 * 1000

  constructor(private _type: InnerTubeClientType = 'WEB_REMIX') {}

  async getContext(): Promise<InnerTubeContext | null> {
    if (!this._context || (Date.now() - this._lastRefresh > this._refreshInterval)) {
      await this._refreshTokens()
    }
    return this._context
  }

  private async _refreshTokens() {
    log('info', `InnerTube[${this._type}]`, 'Refreshing tokens...')
    try {
      const url = this._type === 'WEB_REMIX' ? 'https://music.youtube.com/' : 'https://www.youtube.com/'
      const res = await httpGet(url)
      if (!res) return

      const apiKeyMatch = res.body.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
      const visitorDataMatch = res.body.match(/"VISITOR_DATA":"([^"]+)"/)
      const clientVersionMatch = res.body.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)

      if (apiKeyMatch && visitorDataMatch) {
        this._context = {
          apiKey: apiKeyMatch[1]!,
          visitorData: visitorDataMatch[1]!,
          clientVersion: clientVersionMatch ? clientVersionMatch[1]! : (this._type === 'WEB_REMIX' ? '1.20260428.11.00' : '2.20240501.01.00')
        }
        this._lastRefresh = Date.now()
        log('info', `InnerTube[${this._type}]`, 'Tokens refreshed successfully.')
      }
    } catch (err) {
      log('error', `InnerTube[${this._type}]`, `Error refreshing tokens: ${err}`)
    }
  }

  async request(endpoint: string, payload: any): Promise<any> {
    const ctx = await this.getContext()
    if (!ctx) return null

    const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${ctx.apiKey}`
    const fullPayload = {
      context: {
        client: {
          clientName: this._type,
          clientVersion: ctx.clientVersion,
          hl: 'en',
          gl: 'US',
          visitorData: ctx.visitorData
        }
      },
      ...payload
    }

    const res = await httpPostJson(url, fullPayload)
    if (!res || res.status !== 200) return null
    try {
      return JSON.parse(res.body)
    } catch {
      return null
    }
  }
}
