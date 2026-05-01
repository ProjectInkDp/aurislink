import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { join } from 'node:path'
import { log } from '../shared/reporter.js'

/**
 * AurisLink Secure Token Store
 * Handles encrypted persistence of service tokens with automatic TTL management.
 */
export default class Vault {
  private readonly storePath = join(process.cwd(), '.auris-cache', 'tokens.enc')
  private readonly encryptionKey: Buffer
  private tokens: Map<string, { value: any; expiresAt: number | null }> = new Map()

  constructor(password: string) {
    this.encryptionKey = crypto.createHash('sha256').update(password).digest()
    this.init()
  }

  private async init() {
    try {
      await fs.mkdir(join(process.cwd(), '.auris-cache'), { recursive: true })
      await this.load()
    } catch (err) {
      log('error', 'Vault', `Initialization failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  public async set(key: string, value: any, ttlMs: number = 0): Promise<void> {
    const expiresAt = ttlMs > 0 ? Date.now() + ttlMs : null
    this.tokens.set(key, { value, expiresAt })
    await this.save()
  }

  public get<T>(key: string): T | null {
    const entry = this.tokens.get(key)
    if (!entry) return null

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.tokens.delete(key)
      void this.save()
      return null
    }

    return entry.value as T
  }

  private async save(): Promise<void> {
    try {
      const plainText = JSON.stringify(Object.fromEntries(this.tokens))
      const iv = crypto.randomBytes(16)
      const cipher = crypto.createCipheriv('aes-256-cbc', this.encryptionKey, iv)
      const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()])
      const data = Buffer.concat([iv, encrypted])
      await fs.writeFile(this.storePath, data)
    } catch (err) {
      log('error', 'Vault', `Failed to save tokens: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  private async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.storePath)
      const iv = data.subarray(0, 16)
      const encrypted = data.subarray(16)
      const decipher = crypto.createDecipheriv('aes-256-cbc', this.encryptionKey, iv)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      const parsed = JSON.parse(decrypted.toString('utf8'))
      this.tokens = new Map(Object.entries(parsed))
    } catch (err) {
      // Ignore if file doesn't exist
    }
  }
}
