import { log } from '../shared/reporter.js'
import { httpGet } from '../shared/http.js'
import type { LyricsResult, TrackInfo } from '../typings/index.js'

/**
 * Deezer Lyrics Provider
 * Fetches and parses lyrics from Deezer's internal GraphQL API.
 */
export default class DeezerLyrics {
  private jwt: string | null = null
  private jwtExpiry: number = 0

  /**
   * Retrieves lyrics for a specific track.
   */
  public async getLyrics(trackInfo: TrackInfo): Promise<LyricsResult> {
    const token = await this.ensureJwt()
    if (!token) return { loadType: 'empty', data: {} }

    try {
      const query = `
        query GetLyrics($trackId: String!) {
          track(trackId: $trackId) {
            lyrics {
              text
              synchronizedLines {
                line
                milliseconds
                duration
              }
            }
          }
        }
      `

      const res = await httpGet('https://pipe.deezer.com/api', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: { trackId: trackInfo.identifier }
        })
      })

      if (!res || res.status !== 200) return { loadType: 'empty', data: {} }
      
      const body = JSON.parse(res.body)
      const lyrics = body.data?.track?.lyrics

      if (!lyrics) return { loadType: 'empty', data: {} }

      return {
        loadType: 'lyrics',
        data: {
          name: trackInfo.title,
          synced: !!lyrics.synchronizedLines?.length,
          lines: lyrics.synchronizedLines?.map((l: any) => ({
            time: Number(l.milliseconds),
            duration: Number(l.duration),
            text: l.line
          })) || lyrics.text?.split('\n').map((t: string) => ({ time: 0, duration: 0, text: t }))
        }
      }
    } catch (err) {
      log('error', 'DeezerLyrics', `Lyrics fetch failed: ${err instanceof Error ? err.message : String(err)}`)
      return { loadType: 'empty', data: {} }
    }
  }

  private async ensureJwt(): Promise<string | null> {
    if (this.jwt && Date.now() < this.jwtExpiry) return this.jwt

    try {
      const res = await httpGet('https://auth.deezer.com/login/anonymous?jo=p&rto=c')
      if (!res || res.status !== 200) return null

      const data = JSON.parse(res.body)
      this.jwt = data.jwt
      this.jwtExpiry = Date.now() + 300000 // 5 minutes
      return this.jwt
    } catch {
      return null
    }
  }
}
