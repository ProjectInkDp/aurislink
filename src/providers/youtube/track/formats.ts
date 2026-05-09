import { StreamFormat } from './format.js'

export class TrackFormats {
  private readonly formats: StreamFormat[] = []

  constructor(formats: StreamFormat[]) {
    this.formats = formats
  }

  public getBestAudioFormat(): StreamFormat | null {
    // Ported logic: prefer opus, then high bitrate
    return this.formats
      .filter(f => f.type.includes('audio/'))
      .sort((a, b) => {
        const aIsOpus = a.type.includes('opus')
        const bIsOpus = b.type.includes('opus')
        if (aIsOpus && !bIsOpus) return -1
        if (!aIsOpus && bIsOpus) return 1
        return b.bitrate - a.bitrate
      })[0] || null
  }

  public getAllFormats(): StreamFormat[] {
    return this.formats
  }
}
