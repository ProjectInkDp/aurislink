export interface FormatInfo {
  container: string
  codecs: string
}

export class StreamFormat {
  public readonly info: FormatInfo | null
  
  constructor(
    public readonly type: string,
    public readonly itag: number,
    public readonly bitrate: number,
    public readonly contentLength: number,
    public readonly audioChannels: number,
    public readonly url: string,
    public readonly nParameter: string | null,
    public readonly signature: string | null,
    public readonly signatureKey: string | null,
    public readonly isDefaultAudioTrack: boolean,
    public readonly isDrc: boolean
  ) {
    this.info = this.parseFormatInfo(type)
  }

  private parseFormatInfo(type: string): FormatInfo | null {
    // Basic parser for "audio/webm; codecs=\"opus\""
    const match = type.match(/^([^;]+);\s*codecs="([^"]+)"/)
    if (match) {
      return {
        container: match[1],
        codecs: match[2]
      }
    }
    return null
  }

  public getPlaybackUrl(): string {
    return this.url
  }
}
