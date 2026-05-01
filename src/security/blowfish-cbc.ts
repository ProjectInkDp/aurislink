import crypto from 'node:crypto'

/**
 * Blowfish-CBC Decryption Utility
 * Leverages Node.js native crypto for high-performance stream decryption.
 */
export default class BlowfishCBC {
  private readonly key: Buffer
  private iv: Buffer = Buffer.alloc(8)

  constructor(key: string | Buffer) {
    this.key = typeof key === 'string' ? Buffer.from(key) : key
  }

  /**
   * Sets the initialization vector for CBC mode.
   */
  public setIv(iv: string | Buffer): void {
    this.iv = typeof iv === 'string' ? Buffer.from(iv) : iv
    if (this.iv.length !== 8) {
      throw new Error('Blowfish IV must be exactly 8 bytes.')
    }
  }

  /**
   * Decrypts a data chunk using Blowfish-CBC.
   */
  public decode(chunk: Buffer): Buffer {
    const decipher = crypto.createDecipheriv('bf-cbc', this.key, this.iv)
    decipher.setAutoPadding(false)
    return Buffer.concat([decipher.update(chunk), decipher.final()])
  }

  /**
   * Static helper for Deezer-specific chunk decryption.
   */
  public static decryptDeezer(chunk: Buffer, key: Buffer): Buffer {
    const instance = new BlowfishCBC(key)
    instance.setIv(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))
    return instance.decode(chunk)
  }
}
