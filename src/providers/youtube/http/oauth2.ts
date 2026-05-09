import { log } from '../../../shared/reporter.js'
import { httpPostJson } from '../../../shared/http.js'

export class YoutubeOauth2Handler {
  private static readonly CLIENT_ID = '861556708454-d6dlm3lh05idd8npek18k6be8ba3oc68.apps.googleusercontent.com'
  private static readonly CLIENT_SECRET = 'SboVhoG9s0rNafixCSGGKXAT'
  private static readonly SCOPES = 'http://gdata.youtube.com https://www.googleapis.com/auth/youtube'

  private refreshToken: string | null = null
  private accessToken: string | null = null
  private tokenExpires: number = 0

  public setRefreshToken(token: string | null): void {
    this.refreshToken = token
    log('info', 'OAuth2', `Refresh token ${token ? 'updated' : 'cleared'}`)
  }

  public async getAccessToken(): Promise<string | null> {
    if (this.accessToken && this.tokenExpires > Date.now()) {
      return this.accessToken
    }

    if (!this.refreshToken) return null

    try {
      const res = await httpPostJson('https://oauth2.googleapis.com/token', {
        client_id: YoutubeOauth2Handler.CLIENT_ID,
        client_secret: YoutubeOauth2Handler.CLIENT_SECRET,
        refresh_token: this.refreshToken,
        grant_type: 'refresh_token'
      })

      if (!res || !res.body) return null
      const data = JSON.parse(res.body)
      
      this.accessToken = data.access_token
      this.tokenExpires = Date.now() + (data.expires_in * 1000) - 60000 // 1 min buffer
      
      return this.accessToken
    } catch (err) {
      log('error', 'OAuth2', `Failed to refresh access token: ${err}`)
      return null
    }
  }
}
