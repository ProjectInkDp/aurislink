// src/typings/index.ts

// Track

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

// Load result (Lavalink v4)

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

// Source interface

export interface Source {
  readonly name: string
  readonly searchPrefixes: string[]
  setup(): Promise<boolean>
  accepts(url: string): boolean
  load(url: string): Promise<LoadResult>
  search(query: string): Promise<LoadResult>
}

// Config

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
  sources: {
    soundcloud: {
      enabled: boolean
      clientId: string
    }
  }
}
