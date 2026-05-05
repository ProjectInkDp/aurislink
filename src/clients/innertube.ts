import { httpGet, httpPostJson } from '../shared/http.js'
import { log } from '../shared/reporter.js'
import { poTokenProvider } from '../shared/po-token.js'

export type InnerTubeClientType = 'WEB' | 'WEB_REMIX' | 'ANDROID' | 'ANDROID_MUSIC' | 'IOS' | 'TVHTML5' | 'TVHTML5_SIMPLY'

export interface InnerTubeContext {
  apiKey: string
  visitorData: string
  clientVersion: string
  poToken?: string
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

      const poData = await poTokenProvider.getToken()

      if (apiKeyMatch && (visitorDataMatch || poData)) {
        let version = clientVersionMatch ? clientVersionMatch[1]! : '2.20240501.01.00'
        
        // Versões fixas baseadas no plugin do Lavalink para clientes móveis/TV
        if (this._type === 'ANDROID') version = '19.48.34'
        if (this._type === 'ANDROID_MUSIC') version = '7.29.53'
        if (this._type === 'TVHTML5') version = '7.20260115.10.00'
        if (this._type === 'WEB_REMIX') version = '1.20260501.11.00'

        this._context = {
          apiKey: apiKeyMatch[1]!,
          visitorData: poData?.visitorData || visitorDataMatch?.[1] || '',
          clientVersion: version,
          poToken: poData?.poToken
        }
        this._lastRefresh = Date.now()
        log('info', `InnerTube[${this._type}]`, 'Tokens refreshed successfully.')
      }
    } catch (err) {
      log('error', `InnerTube[${this._type}]`, `Error refreshing tokens: ${err}`)
    }
  }

  private _getUserAgent(type: InnerTubeClientType, version: string): string {
    switch (type) {
      case 'ANDROID': return `com.google.android.youtube/${version} (Linux; U; Android 14; pt_BR; SM-S918B; Build/UP1A.231005.007) gzip`
      case 'ANDROID_MUSIC': return `com.google.android.apps.youtube.music/${version} (Linux; U; Android 14; pt_BR; SM-S918B; Build/UP1A.231005.007) gzip`
      case 'TVHTML5': return `Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.105 Safari/537.36 SmartTV/10.0 (NetCast)`
      case 'WEB_REMIX': return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
      default: return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    }
  }

  private _getClientCode(type: InnerTubeClientType): number {
    switch (type) {
      case 'WEB': return 1
      case 'ANDROID': return 3
      case 'IOS': return 5
      case 'TVHTML5': return 7
      case 'ANDROID_MUSIC': return 21
      case 'WEB_REMIX': return 67
      default: return 1
    }
  }

  async request(endpoint: string, payload: any): Promise<any> {
    const ctx = await this.getContext()
    if (!ctx) return null

    const url = `https://www.youtube.com/youtubei/v1/${endpoint}?key=${ctx.apiKey}`
    const userAgent = this._getUserAgent(this._type, ctx.clientVersion)
    const fullPayload = {
      context: {
        client: {
          clientName: this._type,
          clientVersion: ctx.clientVersion,
          hl: 'pt',
          gl: 'BR',
          utcOffsetMinutes: -180,
          visitorData: ctx.visitorData,
          ...(this._type.startsWith('ANDROID') ? { androidSdkVersion: 34, osVersion: '14' } : { osName: 'Windows', osVersion: '10.0', platform: 'DESKTOP' }),
          ...(ctx.poToken ? { serviceIntegrityDimensions: { poToken: ctx.poToken } } : {})
        },
        user: { lockedSafetyMode: false }
      },
      ...payload
    }

    const res = await httpPostJson(url, fullPayload, {
      headers: {
        'User-Agent': userAgent,
        'X-Youtube-Client-Name': this._getClientCode(this._type).toString(),
        'X-Youtube-Client-Version': ctx.clientVersion,
        'Origin': 'https://www.youtube.com',
        'Referer': 'https://www.youtube.com/',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin'
      }
    })

    if (!res || res.status !== 200) return null
    try {
      return JSON.parse(res.body)
    } catch {
      return null
    }
  }
}
