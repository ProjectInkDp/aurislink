import https from 'node:https'
import { log } from '../shared/reporter.js'

export interface GeneratedCookie {
  domain: string
  path: string
  name: string
  value: string
  expiration: number
  secure: boolean
}

/**
 * CookieGenerator
 * Automatically generates YouTube cookies by simulating a browser session
 * Useful for users who don't have cookies.txt files
 */
export class CookieGenerator {
  private static readonly YOUTUBE_URL = 'https://www.youtube.com'
  private static readonly USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  ]

  /**
   * Generate YouTube cookies by fetching the homepage
   * This simulates a real browser session and extracts cookies
   */
  static async generate(): Promise<GeneratedCookie[]> {
    log('info', 'CookieGenerator', 'Attempting to generate YouTube cookies...')

    try {
      const cookies = await this._fetchCookies()
      
      if (cookies.length === 0) {
        log('warn', 'CookieGenerator', 'No cookies generated - YouTube may have blocked the request')
        return []
      }

      log('info', 'CookieGenerator', `Successfully generated ${cookies.length} cookies`)
      return cookies
    } catch (err) {
      log('error', 'CookieGenerator', `Failed to generate cookies: ${err}`)
      return []
    }
  }

  /**
   * Convert generated cookies to Netscape format
   */
  static toNetscapeFormat(cookies: GeneratedCookie[]): string {
    const header = '# Netscape HTTP Cookie File\n# https://curl.haxx.se/rfc/cookie_spec.html\n# This is a generated file! Do not edit.\n\n'
    
    const lines = cookies.map(cookie => {
      const secure = cookie.secure ? 'TRUE' : 'FALSE'
      const expiration = Math.floor(cookie.expiration / 1000)
      return `${cookie.domain}\tTRUE\t${cookie.path}\t${secure}\t${expiration}\t${cookie.name}\t${cookie.value}`
    })

    return header + lines.join('\n') + '\n'
  }

  /**
   * Validate if a cookie is still valid (not expired)
   */
  static isValid(cookie: GeneratedCookie): boolean {
    return cookie.expiration > Date.now()
  }

  /**
   * Filter out expired cookies
   */
  static filterValid(cookies: GeneratedCookie[]): GeneratedCookie[] {
    return cookies.filter(c => this.isValid(c))
  }

  private static _fetchCookies(): Promise<GeneratedCookie[]> {
    return new Promise((resolve, reject) => {
      const userAgent = this.USER_AGENTS[Math.floor(Math.random() * this.USER_AGENTS.length)]!
      const cookies: GeneratedCookie[] = []

      const options = {
        hostname: 'www.youtube.com',
        path: '/',
        method: 'GET',
        headers: {
          'User-Agent': userAgent,
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'DNT': '1',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
        },
        timeout: 15000,
      }

      const req = https.request(options, (res) => {
        // Extract cookies from Set-Cookie headers
        const setCookieHeaders = res.headers['set-cookie'] || []
        
        for (const setCookieHeader of setCookieHeaders) {
          const cookie = this._parseCookie(setCookieHeader)
          if (cookie) {
            cookies.push(cookie)
          }
        }

        // Consume response data
        res.on('data', () => {})
        res.on('end', () => {
          resolve(cookies)
        })
      })

      req.on('error', (err) => {
        reject(err)
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })

      req.end()
    })
  }

  private static _parseCookie(setCookieHeader: string): GeneratedCookie | null {
    try {
      const parts = setCookieHeader.split(';')
      const [nameValue] = parts
      
      if (!nameValue) return null

      const [name, value] = nameValue.trim().split('=')
      if (!name || !value) return null

      let domain = '.youtube.com'
      let path = '/'
      let secure = true
      let expiration = Date.now() + 365 * 24 * 60 * 60 * 1000 // 1 year default

      // Parse cookie attributes
      for (let i = 1; i < parts.length; i++) {
        const attr = parts[i]!.trim()
        const [attrName, attrValue] = attr.split('=')

        if (attrName.toLowerCase() === 'domain') {
          domain = attrValue || '.youtube.com'
        } else if (attrName.toLowerCase() === 'path') {
          path = attrValue || '/'
        } else if (attrName.toLowerCase() === 'secure') {
          secure = true
        } else if (attrName.toLowerCase() === 'expires') {
          const expiryDate = new Date(attrValue || '')
          if (!isNaN(expiryDate.getTime())) {
            expiration = expiryDate.getTime()
          }
        } else if (attrName.toLowerCase() === 'max-age') {
          const maxAge = parseInt(attrValue || '0', 10)
          if (!isNaN(maxAge)) {
            expiration = Date.now() + maxAge * 1000
          }
        }
      }

      return {
        domain,
        path,
        name: name.trim(),
        value: value.trim(),
        expiration,
        secure,
      }
    } catch (err) {
      return null
    }
  }
}
