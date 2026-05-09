import { log } from '../../../shared/reporter.js'

export class POTokenManager {
  private static poToken: string | null = null
  private static visitorData: string | null = null

  public static setTokens(poToken: string | null, visitorData: string | null): void {
    this.poToken = poToken
    this.visitorData = visitorData
    log('info', 'POToken', `Tokens updated: poToken=${poToken ? 'SET' : 'NULL'}, visitorData=${visitorData ? 'SET' : 'NULL'}`)
  }

  public static getPoToken(): string | null {
    return this.poToken
  }

  public static getVisitorData(): string | null {
    return this.visitorData
  }
}
