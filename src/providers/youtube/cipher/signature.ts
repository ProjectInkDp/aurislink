import { log } from '../../../shared/reporter.js'
import vm from 'node:vm'

export interface SignatureCipher {
  timestamp: string
  globalVars: string
  sigActions: string
  sigFunction: string
  nFunction: string
  script: string
}

export class SignatureDecipherer {
  private static readonly TIMESTAMP_PATTERN = /signatureTimestamp:(\d+)|sts:(\d+)/
  private static readonly SIG_FUNCTION_PATTERNS = [
    /[a-zA-Z0-9_$]+\.set\("signature",\s*([a-zA-Z0-9_$]+)\(/,
    /a\.set\("signature",\s*([a-zA-Z0-9_$]+)\(/,
    /([a-zA-Z0-9_$]+)\s*=\s*function\s*\(\s*a\s*\)\s*\{[\s\S]{0,2000}?reverse/
  ]
  private static readonly N_FUNCTION_PATTERNS = [
    /\.get\("n"\)\s*&&\s*([a-zA-Z0-9_$]+)\s*=\s*([a-zA-Z0-9_$]+)\s*\(/,
    /a\.get\("n"\)\s*&&\s*([a-zA-Z0-9_$]+)\s*=\s*([a-zA-Z0-9_$]+)\s*\(/,
    /transform[^\n]*?=\s*function\s*\(\s*a\s*\)[\s\S]{0,1000}?/
  ]

  public static extract(script: string, sourceUrl: string): SignatureCipher {
    const timestampMatch = script.match(this.TIMESTAMP_PATTERN)
    if (!timestampMatch) throw new Error(`Timestamp not found in script: ${sourceUrl}`)

    let sigFuncName: string | null = null
    for (const pattern of this.SIG_FUNCTION_PATTERNS) {
      const match = script.match(pattern)
      if (match) {
        sigFuncName = match[1] || match[2] || match[3]
        break
      }
    }

    let nFuncName = 'transform'
    for (const pattern of this.N_FUNCTION_PATTERNS) {
      const match = script.match(pattern)
      if (match) {
        nFuncName = match[2] || match[1] || 'transform'
        break
      }
    }

    if (!sigFuncName) {
      throw new Error(`Decipher function name not found in script: ${sourceUrl}`)
    }

    const sigFuncPattern = new RegExp(`${sigFuncName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{[\\s\\S]*?return[a-zA-Z0-9_$]+\\.join`)
    const nFuncPattern = new RegExp(`${nFuncName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{[\\s\\S]*?return`)

    const sigFunctionMatch = script.match(sigFuncPattern)
    const nFunctionMatch = script.match(nFuncPattern)

    if (!sigFunctionMatch) {
      throw new Error(`Decipher function body not found: ${sigFuncName}`)
    }

    let sigActions = ''
    const actionsMatch = sigFunctionMatch[0].match(/([a-zA-Z0-9_$]+)\.(?:reverse|splice|swap)\(/)
    if (actionsMatch) {
      const actionsVar = actionsMatch[1]
      const actionsPattern = new RegExp(`var\\s+${actionsVar}\\s*=\\s*\\{[^}]+\\}`, 's')
      const match = script.match(actionsPattern)
      if (match) sigActions = match[0]
    }

    return {
      timestamp: timestampMatch[1] || timestampMatch[2],
      globalVars: '',
      sigActions,
      sigFunction: sigFunctionMatch[0],
      nFunction: nFunctionMatch ? nFunctionMatch[0] : `function(a){return a}`,
      script: script
    }
  }

  public static decipher(cipher: SignatureCipher, signature: string): string {
    try {
      const context = vm.createContext({})
      const code = `${cipher.globalVars}\n${cipher.sigActions}\nconst decipher = ${cipher.sigFunction};\ndecipher("${signature}");`
      return vm.runInContext(code, context)
    } catch (err) {
      log('error', 'YouTubeCipher', `Decipher failed: ${err}`)
      return signature
    }
  }

  public static transformN(cipher: SignatureCipher, nParam: string): string {
    try {
      const context = vm.createContext({})
      const code = `${cipher.globalVars}\nconst transform = ${cipher.nFunction};\ntransform("${nParam}");`
      return vm.runInContext(code, context)
    } catch (err) {
      log('error', 'YouTubeCipher', `N-Transform failed: ${err}`)
      return nParam
    }
  }
}
