// src/typings/index.ts

// ─── Track ───────────────────────────────────────────────────────────────────

export interface TrackInfo {
  identifier: string
  isSeekable: boolean
  author: string
  length: number        // ms
  isStream: boolean
  position: number      // ms
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

// ─── Load result (Lavalink v4) ────────────────────────────────────────────────

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
    | Track                                                        // track
    | { info: PlaylistInfo; pluginInfo: Record<string, unknown>; tracks: Track[] } // playlist
    | Track[]                                                      // search
    | Record<string, never>                                        // empty
    | LoadError                                                    // error
}

// ─── Source interface ─────────────────────────────────────────────────────────

export interface Source {
  /** Unique name used as prefix, e.g. "soundcloud" */
  readonly name: string
  /** Search prefixes accepted, e.g. ["scsearch"] */
  readonly searchPrefixes: string[]

  /** Called once at boot. Return false to disable the source. */
  setup(): Promise<boolean>

  /** Return true if this source can handle the given URL. */
  accepts(url: string): boolean

  /** Load a URL (track or playlist). */
  load(url: string): Promise<LoadResult>

  /** Execute a search query (prefix already stripped). */
  search(query: string): Promise<LoadResult>
}

// ─── Config ───────────────────────────────────────────────────────────────────

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
