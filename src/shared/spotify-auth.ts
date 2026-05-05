import { httpPostJson, httpGet } from './http.js'
import { log } from './reporter.js'

export interface SpotifyAuthTokens {
  accessToken: string
  expiresAt: number
  clientToken?: string
}

export class SpotifyTokenManager {
  private static _clientId = '08bab3354d40f74e5177917b5ae80894'
  private _accessToken: string | null = null
  private _clientToken: string | null = null
  private _expiresAt = 0
  private _spDc: string | null = null
  private _vault: any | null = null

  constructor(spDc?: string, vault?: any) {
    this._spDc = spDc || null
    this._vault = vault || null
  }

  async getAuth(): Promise<SpotifyAuthTokens | null> {
    // 1. Check memory cache
    if (this._accessToken && Date.now() < this._expiresAt) {
      return {
        accessToken: this._accessToken,
        expiresAt: this._expiresAt,
        clientToken: this._clientToken || undefined
      }
    }

    // 2. Check Vault (Secure Persistence)
    if (this._vault) {
      const cached = (this._vault as any).get(`spotify_auth_${this._spDc || 'anon'}`) as SpotifyAuthTokens | null
      if (cached && Date.now() < cached.expiresAt) {
        this._accessToken = cached.accessToken
        this._expiresAt = cached.expiresAt
        this._clientToken = cached.clientToken || null
        return cached
      }
    }

    // 3. Refresh if nothing valid found
    const success = await this._refreshTokens()
    if (success && this._accessToken) {
      const auth = {
        accessToken: this._accessToken,
        expiresAt: this._expiresAt,
        clientToken: this._clientToken || undefined
      }
      
      // Persist to Vault
      if (this._vault) {
        void this._vault.set(`spotify_auth_${this._spDc || 'anon'}`, auth, this._expiresAt - Date.now())
      }

      return auth
    }
    return null
  }

  private async _refreshTokens(): Promise<boolean> {
    log('info', 'SpotifyAuth', this._spDc ? 'Initiating Tier 3 authentication (sp_dc)...' : 'Initiating anonymous token handshake...')

    try {
      // 1. Prepare headers exactly like a real browser to avoid 403
      const headers: Record<string, string> = {
        'authority': 'open.spotify.com',
        'accept': 'application/json',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'referer': 'https://open.spotify.com/',
        'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
      }

      if (this._spDc) {
        headers['Cookie'] = `sp_dc=${this._spDc}`
      }

      const res = await httpGet('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
        headers
      })

      if (!res || res.status !== 200) {
        log('error', 'SpotifyAuth', `Failed to retrieve Access Token: ${res?.status}`)
        return false
      }

      const data = JSON.parse(res.body)
      this._accessToken = data.accessToken
      this._expiresAt = data.accessTokenExpirationTimestampMs - 60000

      // We still try to get a client token for Pathfinder, but it's optional
      this._clientToken = await this._fetchClientToken()

      log('info', 'SpotifyAuth', `Access Token successfully obtained (${this._spDc ? 'Authenticated' : 'Anonymous'}).`)
      return true
    } catch (err: any) {
      log('error', 'SpotifyAuth', `Handshake error: ${err.message}`)
      return false
    }
  }

  private async _fetchClientToken(): Promise<string | null> {
    const url = 'https://clienttoken.spotify.com/v1/clienttoken'
    const payload = {
      client_data: {
        client_id: SpotifyTokenManager._clientId,
        js_sdk_data: {
          device_brand: 'unknown',
          device_model: 'unknown',
          os: 'Windows',
          os_version: '10'
        }
      }
    }

    try {
      const res = await httpPostJson(url, payload, {
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36'
        }
      })

      if (res && res.status === 200) {
        const data = JSON.parse(res.body)
        return data.granted_token?.token || null
      }
      return null
    } catch (err) {
      return null
    }
  }
}
