import { log } from '../../../shared/reporter.js'
import { httpGet, httpPostJson } from '../../../shared/http.js'
import { SignatureDecipherer, SignatureCipher } from './signature.js'
import type { AurisConfig } from '../../../typings/index.js'

export interface CachedPlayerScript {
  url: string
  cipher: SignatureCipher
  expires: number
}

export class CipherManager {
  private cachedScript: CachedPlayerScript | null = null
  private config: AurisConfig['sources']['youtube']

  constructor(config?: AurisConfig['sources']['youtube']) {
    this.config = config
  }

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

    // Use remote chipper if configured
    if (this.config?.cipher?.url) {
      try {
        const scriptUrl = this.cachedScript?.url || 'https://www.youtube.com/s/player/8fb635c2/player_embed_es6.vflset/en_US/base.js'
        const res = await httpPostJson(`${this.config.cipher.url}/resolve_url`, {
          stream_url: format.url,
          player_url: scriptUrl,
          encrypted_signature: format.signature || null,
          signature_key: format.signatureKey || 'sig',
          n_param: format.nParameter || null
        }, {
          headers: this.config.cipher.token ? { 'Authorization': this.config.cipher.token } : {}
        })

        if (res && res.status === 200) {
          const body = JSON.parse(res.body)
          if (body.resolved_url) {
            log('debug', 'YouTubeCipher', 'URL resolved via remote chipper')
            return body.resolved_url
          }
        }
        log('warn', 'YouTubeCipher', `Remote chipper failed (status ${res?.status}), falling back to local`)
      } catch (err) {
        log('warn', 'YouTubeCipher', `Remote chipper error: ${err}, falling back to local`)
      }
    }

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
