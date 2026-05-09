import { log } from '../../../../shared/reporter.js'
import { StreamFormat } from '../../track/format/StreamFormat.js'
import { TrackFormats } from '../../track/TrackFormats.js'
import { NonMusicClient } from './NonMusicClient.js'
import { YoutubeAudioSourceManager } from '../../manager.js'

export abstract class StreamingNonMusicClient extends NonMusicClient {
  protected static DEFAULT_SIGNATURE_KEY = 'signature'

  public async loadFormats(source: YoutubeAudioSourceManager, videoId: string): Promise<TrackFormats> {
    const json = await this.loadTrackInfoFromInnertube(source, videoId)
    const playabilityStatus = json.playabilityStatus || {}
    const videoDetails = json.videoDetails || {}
    const playerScript = await source.getCipherManager().getPlayerScript()

    let isLive = videoDetails.isLive || false
    if (playabilityStatus.status === 'OK' && playabilityStatus.reason?.includes('This live event has ended')) {
      isLive = true
    }

    const streamingData = json.streamingData || {}
    const mergedFormats = streamingData.formats || []
    const adaptiveFormats = streamingData.adaptiveFormats || []

    const formats: StreamFormat[] = []
    let anyFailures = false

    for (const merged of mergedFormats) {
      if (!this.extractFormat(merged, formats, isLive)) {
        anyFailures = true
      }
    }

    for (const adaptive of adaptiveFormats) {
      if (!this.extractFormat(adaptive, formats, isLive)) {
        anyFailures = true
      }
    }

    if (formats.length === 0 && anyFailures) {
      log('warn', 'YouTubeClient', `Loading formats either failed to load or were skipped due to missing fields for ${videoId}`)
    }

    return new TrackFormats(formats, playerScript?.script)
  }

  protected extractFormat(formatJson: any, formats: StreamFormat[], isLive: boolean): boolean {
    if (!formatJson || typeof formatJson !== 'object') {
      return false
    }

    let url = formatJson.url
    const cipher = formatJson.signatureCipher || formatJson.cipher
    let cipherInfo: Record<string, string> = {}

    if (cipher) {
      const params = new URLSearchParams(cipher)
      cipherInfo = Object.fromEntries(params.entries())
    }

    if (!url && !cipherInfo.url) {
      log('debug', 'YouTubeClient', `Client '${this.getIdentifier()}' is missing format URL for itag '${formatJson.itag}'. SABR response?`)
      return false
    }

    const finalUrl = cipherInfo.url || url
    const urlParams = new URLSearchParams(finalUrl.split('?')[1] || '')

    try {
      const itag = parseInt(formatJson.itag)
      const contentLength = parseInt(formatJson.contentLength || '-1')

      if (contentLength === -1 && !isLive && itag !== 18) {
        log('debug', 'YouTubeClient', `Track is not a live stream, but no contentLength in format itag ${itag}, skipping`)
        return true
      }

      formats.push(new StreamFormat(
        formatJson.mimeType,
        itag,
        parseInt(formatJson.bitrate || '-1'),
        contentLength,
        formatJson.audioChannels || 2,
        finalUrl,
        urlParams.get('n') || formatJson.n,
        cipherInfo.s || formatJson.signature,
        cipherInfo.sp || formatJson.signatureKey || StreamingNonMusicClient.DEFAULT_SIGNATURE_KEY,
        formatJson.audioTrack?.audioIsDefault ?? true,
        formatJson.isDrc ?? false
      ))
      return true
    } catch (e) {
      log('debug', 'YouTubeClient', `Failed to parse format itag ${formatJson.itag}, skipping: ${e}`)
      return false
    }
  }
}
