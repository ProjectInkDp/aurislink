import { httpPostJson, httpGet } from './http.js'
import { log } from './reporter.js'

export interface SpotifyAuthTokens {
  accessToken: string
  expiresAt: number
}

export class SpotifyTokenManager {
  private static _clientId = 'd8a5ed1b290d4978828257ef068a553c'
  private _accessToken: string | null = null
  private _expiresAt = 0

  async getAccessToken(): Promise<string | null> {
    if (this._accessToken && Date.now() < this._expiresAt) {
      return this._accessToken
    }

    return this._refreshTokens()
  }

  private async _refreshTokens(): Promise<string | null> {
    log('info', 'SpotifyAuth', 'Iniciando handshake de token anônimo...')

    try {
      // 1. Obter o Client Token (Handshake Inicial)
      const clientToken = await this._fetchClientToken()
      if (!clientToken) return null

      // 2. Obter o Access Token usando o Client Token e Cookies simulados
      const res = await httpGet('https://open.spotify.com/get_access_token?reason=transport&productType=web_player', {
        headers: {
          'x-client-token': clientToken,
          'Referer': 'https://open.spotify.com/',
          'Origin': 'https://open.spotify.com'
        }
      })

      if (!res || res.status !== 200) {
        log('error', 'SpotifyAuth', `Falha ao obter Access Token: ${res?.status}`)
        return null
      }

      const data = JSON.parse(res.body)
      this._accessToken = data.accessToken
      this._expiresAt = data.accessTokenExpirationTimestampMs - 60000 // Expira 1 min antes por segurança

      log('info', 'SpotifyAuth', 'Access Token obtido com sucesso.')
      return this._accessToken
    } catch (err: any) {
      log('error', 'SpotifyAuth', `Erro no handshake: ${err.message}`)
      return null
    }
  }

  private async _fetchClientToken(): Promise<string | null> {
    const url = 'https://clienttoken.spotify.com/v1/clienttoken'
    const payload = {
      client_data: {
        client_id: SpotifyTokenManager._clientId,
        client_version: '1.2.38.513.g9f592476'
      }
    }

    const res = await httpPostJson(url, payload, {
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      }
    })

    if (!res || res.status !== 200) {
      log('error', 'SpotifyAuth', `Falha no Client Token: ${res?.status} - ${res?.body}`)
      return null
    }

    const data = JSON.parse(res.body)
    return data.granted_token?.token || null
  }
}
