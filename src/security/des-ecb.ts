import crypto from 'node:crypto'

/**
 * DES-ECB Decryption Utility
 * Handles decryption for legacy media providers like JioSaavn.
 */
export default class DesECB {
  private static readonly JIOSAAVN_KEY = Buffer.from('38346591')

  /**
   * Decrypts a Base64-encoded ciphertext using DES-ECB.
   */
  public static decrypt(inputBase64: string, customKey?: string): string {
    const key = customKey && customKey.length === 8 
      ? Buffer.from(customKey) 
      : this.JIOSAAVN_KEY

    const decipher = crypto.createDecipheriv('des-ecb', key, null)
    decipher.setAutoPadding(true)

    const buffer = Buffer.from(inputBase64, 'base64')
    const decrypted = Buffer.concat([decipher.update(buffer), decipher.final()])

    return decrypted.toString('utf8').trim()
  }
}
