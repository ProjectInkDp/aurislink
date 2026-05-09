export class StreamFormat {
  constructor(
    public readonly mimeType: string,
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
  ) {}

  public getPlaybackUrl(): string {
    return this.url
  }

  public toString(): string {
    return `YoutubeStreamFormat{itag=${this.itag}, type=${this.mimeType}, bitrate=${this.bitrate}, audioChannels=${this.audioChannels}, isDrc=${this.isDrc}, nParam=${this.nParameter}, sigKey=${this.signatureKey}, sig=${this.signature}}`
  }
}
