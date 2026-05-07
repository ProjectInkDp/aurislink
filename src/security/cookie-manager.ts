import { readFileSync } from 'node:fs'
import { log } from '../shared/reporter.js'

export interface Cookie {
  domain: string
  flag: string
  path: string
  secure: string
  expiration: string
  name: string
  value: string
}

export interface CookieJar {
  [key: string]: string
}

/**
 * CookieManager
 * Parses and manages cookies from Netscape format (cookies.txt)
 * Commonly used by tools like youtube-dl, yt-dlp, and browser extensions
 */
export class CookieManager {
  private _cookies: CookieJar = {}
  private _filePath: string | null = null

  constructor(filePath?: string) {
    if (filePath) {
      this._filePath = filePath
      this.load()
    }
  }

  /**
   * Load cookies from a Netscape-format cookies.txt file
   * Format: domain flag path secure expiration name value
   */
  load(): boolean {
    if (!this._filePath) {
      log('warn', 'CookieManager', 'No file path provided')
      return false
    }

    try {
      const content = readFileSync(this._filePath, 'utf-8')
      const lines = content.split('\n')

      for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || !line.trim()) continue

        const parts = line.split('\t')
        if (parts.length < 7) continue

        const [domain, flag, path, secure, expiration, name, value] = parts
        const cookieKey = `${domain}:${name}`
        this._cookies[cookieKey] = value

        log('debug', 'CookieManager', `Loaded cookie: ${name} from ${domain}`)
      }

      log('info', 'CookieManager', `Successfully loaded ${Object.keys(this._cookies).length} cookies from ${this._filePath}`)
      return true
    } catch (err) {
      log('error', 'CookieManager', `Failed to load cookies: ${err}`)
      return false
    }
  }

  /**
   * Get all cookies as a Cookie header string
   */
  getCookieHeader(): string {
    return Object.values(this._cookies).join('; ')
  }

  /**
   * Get a specific cookie by name
   */
  getCookie(name: string): string | null {
    // Try exact match first
    if (this._cookies[name]) return this._cookies[name]!

    // Try partial match (domain:name)
    for (const [key, value] of Object.entries(this._cookies)) {
      if (key.endsWith(`:${name}`)) return value
    }

    return null
  }

  /**
   * Get all cookies as an object
   */
  getAllCookies(): CookieJar {
    return { ...this._cookies }
  }

  /**
   * Check if cookies are loaded
   */
  isLoaded(): boolean {
    return Object.keys(this._cookies).length > 0
  }

  /**
   * Get cookie count
   */
  getCount(): number {
    return Object.keys(this._cookies).length
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this._cookies = {}
    log('info', 'CookieManager', 'All cookies cleared')
  }
}
