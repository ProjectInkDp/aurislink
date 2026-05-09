import { log } from '../../../shared/reporter.js'
import { httpGet } from '../../../shared/http.js'
import { SignatureDecipherer, SignatureCipher } from './signature.js'

export interface CachedPlayerScript {
  url: string
  cipher: SignatureCipher
  expires: number
}

export class CipherManager {
  private cachedScript: CachedPlayerScript | null = null

  public async getPlayerScript(): Promise<SignatureCipher | null> {
    if (this.cachedScript && this.cachedScript.expires > Date.now()) {
      return this.cachedScript.cipher
    }

    try {
      const res = await httpGet('https://www.youtube.com/embed/')
      if (!res || !res.body) return null

      const scriptUrlMatch = res.body.match(/"jsUrl":"([^"]+)"/)
      if (!scriptUrlMatch) {
        log('warn', 'YouTubeCipher', 'jsUrl not found in embed page')
        return null
      }

      const scriptUrl = scriptUrlMatch[1].startsWith('http') ? scriptUrlMatch[1] : `https://www.youtube.com${scriptUrlMatch[1]}`
      const scriptRes = await httpGet(scriptUrl)
      if (!scriptRes || !scriptRes.body) return null

      try {
        const cipher = SignatureDecipherer.extract(scriptRes.body, scriptUrl)
        this.cachedScript = {
          url: scriptUrl,
          cipher,
          expires: Date.now() + 24 * 60 * 60 * 1000
        }
        return cipher
      } catch (extractErr) {
        log('warn', 'YouTubeCipher', `Extraction failed, using partial cipher: ${extractErr}`)
        const timestampMatch = scriptRes.body.match(/signatureTimestamp:(\d+)|sts:(\d+)/)
        return {
          timestamp: timestampMatch ? (timestampMatch[1] || timestampMatch[2]) : '0',
          globalVars: '', sigActions: '', sigFunction: '', nFunction: '', script: scriptRes.body
        }
      }
    } catch (err) {
      log('error', 'YouTubeCipher', `Failed to load player script: ${err}`)
      return null
    }
  }

  public async resolveFormatUrl(format: any): Promise<string> {
    const cipher = await this.getPlayerScript()
    if (!cipher) return format.url

    let url = format.url
    if (format.signature && format.signatureKey) {
      const deciphered = SignatureDecipherer.decipher(cipher, format.signature)
      const uri = new URL(url)
      uri.searchParams.set(format.signatureKey, deciphered)
      url = uri.toString()
    }

    if (format.nParameter) {
      const transformed = SignatureDecipherer.transformN(cipher, format.nParameter)
      const uri = new URL(url)
      uri.searchParams.set('n', transformed)
      url = uri.toString()
    }

    return url
  }
}
