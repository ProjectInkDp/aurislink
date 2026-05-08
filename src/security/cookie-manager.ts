import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { log } from '../shared/reporter.js'
import { CookieGenerator } from './cookie-generator.js'

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
  private _cookieMetadata: Map<string, { expiration?: number; secure?: boolean }> = new Map()
  private _lastRefresh = 0
  private _refreshInterval = 24 * 60 * 60 * 1000 // 24 hours

  constructor(filePath?: string, autoRefreshInterval?: number) {
    if (filePath) {
      this._filePath = filePath
      // Ensure directory exists before trying to load
      const dir = dirname(filePath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
        log('info', 'CookieManager', `Created directory: ${dir}`)
      }
      this.load()
    }
    if (autoRefreshInterval) {
      this._refreshInterval = autoRefreshInterval
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

    // If file doesn't exist, try to generate cookies automatically
    if (!existsSync(this._filePath)) {
      log('info', 'CookieManager', `Cookie file not found at ${this._filePath}, attempting auto-generation...`)
      void this._generateAndSave()
      return false
    }

    try {
      const content = readFileSync(this._filePath, 'utf-8')
      const lines = content.split('\n')

      this._cookies = {}
      this._cookieMetadata.clear()

      for (const line of lines) {
        // Skip comments and empty lines
        if (line.startsWith('#') || !line.trim()) continue

        const parts = line.split('\t')
        if (parts.length < 7) continue

        const [domain, flag, path, secure, expiration, name, value] = parts
        const cookieKey = `${domain}:${name}`
        this._cookies[cookieKey] = value

        // Store metadata for validation
        const expirationTime = parseInt(expiration, 10) * 1000
        this._cookieMetadata.set(cookieKey, {
          expiration: expirationTime,
          secure: secure === 'TRUE',
        })

        log('debug', 'CookieManager', `Loaded cookie: ${name} from ${domain}`)
      }

      this._lastRefresh = Date.now()
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
   * Get valid (non-expired) cookies
   */
  getValidCookies(): CookieJar {
    const validCookies: CookieJar = {}
    const now = Date.now()

    for (const [key, value] of Object.entries(this._cookies)) {
      const metadata = this._cookieMetadata.get(key)
      if (!metadata || !metadata.expiration || metadata.expiration > now) {
        validCookies[key] = value
      }
    }

    return validCookies
  }

  /**
   * Get expired cookies
   */
  getExpiredCookies(): string[] {
    const expired: string[] = []
    const now = Date.now()

    for (const [key, metadata] of this._cookieMetadata.entries()) {
      if (metadata.expiration && metadata.expiration <= now) {
        expired.push(key)
      }
    }

    return expired
  }

  /**
   * Check if cookies need refresh (based on expiration or time interval)
   */
  needsRefresh(): boolean {
    const expired = this.getExpiredCookies()
    const timeSinceRefresh = Date.now() - this._lastRefresh
    return expired.length > 0 || timeSinceRefresh > this._refreshInterval
  }

  /**
   * Get cookie validity status
   */
  getStatus(): { total: number; valid: number; expired: number; refreshNeeded: boolean } {
    const expired = this.getExpiredCookies()
    return {
      total: Object.keys(this._cookies).length,
      valid: Object.keys(this._cookies).length - expired.length,
      expired: expired.length,
      refreshNeeded: this.needsRefresh(),
    }
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
   * Get valid cookie count
   */
  getValidCount(): number {
    return Object.keys(this.getValidCookies()).length
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this._cookies = {}
    this._cookieMetadata.clear()
    log('info', 'CookieManager', 'All cookies cleared')
  }

  /**
   * Remove expired cookies
   */
  removeExpired(): number {
    const expired = this.getExpiredCookies()
    for (const key of expired) {
      delete this._cookies[key]
      this._cookieMetadata.delete(key)
    }
    if (expired.length > 0) {
      log('info', 'CookieManager', `Removed ${expired.length} expired cookies`)
    }
    return expired.length
  }

  /**
   * Get valid cookie header
   */
  getValidCookieHeader(): string {
    return Object.values(this.getValidCookies()).join('; ')
  }

  /**
   * Auto-generate cookies via CookieGenerator and save to disk
   */
  private async _generateAndSave(): Promise<void> {
    try {
      const cookies = await CookieGenerator.generate()
      if (cookies.length === 0) {
        log('warn', 'CookieManager', 'Auto-generation returned no cookies')
        return
      }

      const content = CookieGenerator.toNetscapeFormat(cookies)
      const dir = dirname(this._filePath!)
      mkdirSync(dir, { recursive: true })
      writeFileSync(this._filePath!, content, 'utf-8')
      log('info', 'CookieManager', `Auto-generated ${cookies.length} cookies saved to ${this._filePath}`)

      // Reload from the newly created file
      this.load()
    } catch (err) {
      log('error', 'CookieManager', `Auto-generation failed: ${err}`)
    }
  }
}
