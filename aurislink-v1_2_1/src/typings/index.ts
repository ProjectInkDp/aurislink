// src/typings/index.ts

export interface TrackInfo {
  identifier: string
  isSeekable: boolean
  author: string
  length: number
  isStream: boolean
  position: number
  title: string
  uri: string | null
  artworkUrl: string | null
  isrc: string | null
  sourceName: string
}

export interface Track {
  encoded: string
  info: TrackInfo
  pluginInfo: Record<string, unknown>
}

export type LoadType = 'track' | 'playlist' | 'search' | 'empty' | 'error'

export interface LoadError {
  message: string
  severity: 'common' | 'suspicious' | 'fault'
  cause: string
}

export interface PlaylistInfo {
  name: string
  selectedTrack: number
}

export interface LoadResult {
  loadType: LoadType
  data:
    | Track
    | { info: PlaylistInfo; pluginInfo: Record<string, unknown>; tracks: Track[] }
    | Track[]
    | Record<string, never>
    | LoadError
}

export interface Source {
  readonly name: string
  readonly searchPrefixes: string[]
  setup(): Promise<boolean>
  accepts(url: string): boolean
  load(url: string): Promise<LoadResult>
  search(query: string): Promise<LoadResult>
}

export interface TlsConfig {
  enabled: boolean
  cert: string
  key: string
}

export interface ServerConfig {
  host: string
  port: number
  password: string
  tls: TlsConfig
}

export interface AurisConfig {
  server: ServerConfig
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    timestamps: boolean
    colors: boolean
    file?: {
      enabled?: boolean
      path?: string
    }
  }
  playerUpdateInterval: number
  statsInterval: number
  maxSearchResults: number
  maxPlaylistLength: number
  filters?: {
    defaultVolume?: number
    equalizer?:  { band: number; gain: number }[]
    lowPass?:    { smoothing?: number } | null
    timescale?:  { speed?: number; pitch?: number; rate?: number } | null
    tremolo?:    { frequency?: number; depth?: number } | null
    vibrato?:    { frequency?: number; depth?: number } | null
    rotation?:   { rotationHz?: number } | null
    channelMix?: { leftToLeft?: number; leftToRight?: number; rightToLeft?: number; rightToRight?: number } | null
    echo?:       { delay?: number; feedback?: number; mix?: number } | null
    reverb?:     { mix?: number; roomSize?: number; damping?: number } | null
  }
  sources: {
    soundcloud: {
      enabled: boolean
      clientId: string
    }
    deezer: {
      enabled: boolean
      arl?: string          // required for full streams
      decryptionKey?: string
    }
    jiosaavn: {
      enabled: boolean
      playlistLoadLimit?: number
      artistLoadLimit?: number
      secretKey?: string
      proxy?: {
        url?: string
        username?: string
        password?: string
      }
    }
    lastfm?: {
      apiKey?: string
    }
  }
}

// ─── Filter extensions (AurisLink exclusive) ──────────────────────────────────
// Augments the Filters interface in SessionManager with echo + reverb fields.
// These are not part of the Lavalink v4 spec but are fully compatible
// (unknown filter keys are ignored by standard clients).
