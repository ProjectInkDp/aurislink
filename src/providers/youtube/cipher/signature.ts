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
  private static readonly GLOBAL_VARS_PATTERN = /var\s+[a-zA-Z0-9_$]+\s*=\s*\[(?:\s*[a-zA-Z0-9_$]+\s*(?:,\s*)?)+\];/
  private static readonly ACTIONS_PATTERN = /var\s+[a-zA-Z0-9_$]+\s*=\s*\{(?:\s*[a-zA-Z0-9_$]+\s*:\s*function\s*\(.*?\)\s*\{[\s\S]*?\}(?:,\s*)?)+\};/
  private static readonly SIG_FUNCTION_PATTERN = /[a-zA-Z0-9_$]+\.set\("signature",\s*(?<name>[a-zA-Z0-9_$]+)\(/
  private static readonly N_FUNCTION_PATTERN = /\.get\("n"\)\s*&&\s*(?<name>[a-zA-Z0-9_$]+)\s*=\s*(?<func>[a-zA-Z0-9_$]+)\(\s*\k<name>\s*\)/

  public static extract(script: string, sourceUrl: string): SignatureCipher {
    const timestampMatch = script.match(this.TIMESTAMP_PATTERN)
    if (!timestampMatch) throw new Error(`Timestamp not found in script: ${sourceUrl}`)

    const sigFuncNameMatch = script.match(this.SIG_FUNCTION_PATTERN)
    const nFuncNameMatch = script.match(this.N_FUNCTION_PATTERN)

    if (!sigFuncNameMatch) throw new Error(`Decipher function name not found in script: ${sourceUrl}`)
    if (!nFuncNameMatch) throw new Error(`N-function name not found in script: ${sourceUrl}`)

    const sigFuncName = sigFuncNameMatch.groups!.name
    const nFuncName = nFuncNameMatch.groups!.func

    const sigFuncPattern = new RegExp(`${sigFuncName}\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{[\\s\\S]*?return\\s*[a-zA-Z0-9_$]+\\.join\\(""\\)\\s*\\}`)
    const nFuncPattern = new RegExp(`${nFuncName}\\s*=\\s*function\\s*\\([a-zA-Z0-9_$]+\\)\\s*\\{[\\s\\S]*?return\\s*[a-zA-Z0-9_$]+\\.join\\(""\\)\\s*\\}`)

    const sigFunctionMatch = script.match(sigFuncPattern)
    const nFunctionMatch = script.match(nFuncPattern)

    if (!sigFunctionMatch) throw new Error(`Decipher function body not found: ${sigFuncName}`)
    if (!nFunctionMatch) throw new Error(`N-function body not found: ${nFuncName}`)

    // Extract actions used by sigFunction
    const actionsVarMatch = sigFunctionMatch[0].match(/([a-zA-Z0-9_$]+)\.[a-zA-Z0-9_$]+\(/)
    let sigActions = ''
    if (actionsVarMatch) {
      const actionsVar = actionsVarMatch[1]
      const actionsPattern = new RegExp(`var\\s+${actionsVar}\\s*=\\s*\\{[\\s\\S]*?\\};`)
      const match = script.match(actionsPattern)
      if (match) sigActions = match[0]
    }

    let nFunction = nFunctionMatch[0]
    const nParamNameMatch = nFunction.match(/\(([^)]+)\)/)
    if (nParamNameMatch) {
      const nParamName = nParamNameMatch[1]
      nFunction = nFunction.replace(new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${nParamName}\\s*;?`, 'g'), '')
    }

    return {
      timestamp: timestampMatch[1] || timestampMatch[2],
      globalVars: '', // Often not needed with modern scripts
      sigActions,
      sigFunction: sigFunctionMatch[0],
      nFunction: nFunction,
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
