// src/decrypters/des-ecb.ts
// DES/ECB decryption used by JioSaavn's encrypted_media_url.
//
// JioSaavn encodes stream URLs as Base64-encoded DES/ECB ciphertext.
// Node.js crypto handles this natively — no manual S-box needed.

import crypto from 'node:crypto'

// JioSaavn's built-in static key (8 bytes).
const DEFAULT_KEY = '38346591'

/**
 * Decrypts a JioSaavn Base64-encoded encrypted_media_url.
 * Accepts an optional secretKey override from config (must be 8 chars).
 */
export function decryptJioSaavnUrl(encryptedBase64: string, secretKey?: string): string {
  const keyStr = typeof secretKey === 'string' && secretKey.length === 8
    ? secretKey
    : DEFAULT_KEY

  const key = Buffer.from(keyStr)
  const input = Buffer.from(encryptedBase64, 'base64')
  const decipher = crypto.createDecipheriv('des-ecb', key, null)
  decipher.setAutoPadding(true)
  const decrypted = Buffer.concat([decipher.update(input), decipher.final()])
  return decrypted.toString('utf8').trim()
}
