import { YoutubeClient, ClientConfig } from './base.js'

export class AndroidClient extends YoutubeClient {
  public getIdentifier(): string { return 'ANDROID' }
  public getBaseClientConfig(): ClientConfig {
    return {
      name: 'ANDROID',
      clientName: 'ANDROID',
      clientVersion: '19.19.35',
      platform: 'MOBILE',
      hl: 'en-US',
      gl: 'US',
      remoteHost: 'www.youtube.com'
    }
  }
}

export class AndroidMusicClient extends YoutubeClient {
  public getIdentifier(): string { return 'ANDROID_MUSIC' }
  public getBaseClientConfig(): ClientConfig {
    return {
      name: 'ANDROID_MUSIC',
      clientName: 'ANDROID_MUSIC',
      clientVersion: '6.52.51',
      platform: 'MOBILE',
      hl: 'en-US',
      gl: 'US',
      remoteHost: 'music.youtube.com'
    }
  }
}

export class TvHtml5SimplyClient extends YoutubeClient {
  public getIdentifier(): string { return 'TVHTML5_SIMPLY' }
  public getBaseClientConfig(): ClientConfig {
    return {
      name: 'TVHTML5_SIMPLY',
      clientName: 'TVHTML5_SIMPLY',
      clientVersion: '2.20240522.01.00',
      platform: 'TV',
      hl: 'en-US',
      gl: 'US',
      remoteHost: 'www.youtube.com'
    }
  }
}

export class IosClient extends YoutubeClient {
  public getIdentifier(): string { return 'IOS' }
  public getBaseClientConfig(): ClientConfig {
    return {
      name: 'IOS',
      clientName: 'IOS',
      clientVersion: '19.19.3',
      platform: 'MOBILE',
      hl: 'en-US',
      gl: 'US',
      remoteHost: 'www.youtube.com'
    }
  }
}
