import { StreamFormat } from './format/StreamFormat.js'

export class TrackFormats {
  constructor(
    private readonly formats: StreamFormat[],
    public readonly playerScriptUrl?: string
  ) {}

  public getFormats(): StreamFormat[] {
    return this.formats
  }

  public getBestAudioFormat(): StreamFormat | null {
    let bestFormat: StreamFormat | null = null
    for (const format of this.formats) {
      if (this.isBetterFormat(format, bestFormat)) {
        bestFormat = format
      }
    }
    return bestFormat
  }

  private isBetterFormat(format: StreamFormat, other: StreamFormat | null): boolean {
    if (!other) return true

    const isWebm = format.mimeType.includes('webm')
    const otherIsWebm = other.mimeType.includes('webm')

    // Opus (webm) is generally preferred over AAC (mp4)
    if (isWebm && !otherIsWebm) return true
    if (!isWebm && otherIsWebm) return false

    // Prefer higher bitrate
    return format.bitrate > other.bitrate
  }
}
