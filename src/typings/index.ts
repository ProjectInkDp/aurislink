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

export interface FiltersConfig {
  // Default filter values applied to every new player.
  // Clients can override per-player via PATCH /v4/sessions/:id/players/:guildId
  defaultVolume?: number
  equalizer?:  { band: number; gain: number }[]
  lowPass?:    { smoothing?: number } | null
  timescale?:  { speed?: number; pitch?: number; rate?: number } | null
  tremolo?:    { frequency?: number; depth?: number } | null
  vibrato?:    { frequency?: number; depth?: number } | null
  rotation?:   { rotationHz?: number } | null
  channelMix?: { leftToLeft?: number; leftToRight?: number; rightToLeft?: number; rightToRight?: number } | null
  echo?:       { delay?: number; feedback?: number; mix?: number } | null        // AurisLink exclusive
  reverb?:     { mix?: number; roomSize?: number; damping?: number } | null      // AurisLink exclusive
}

export interface RoutePlannerConfig {
  enabled: boolean
  ipPool: string[]                          // list of outbound IPs to rotate
  strategy?: 'RotateOnBan' | 'LoadBalance' | 'NanoSwitch'
  cooldownMs?: number                       // how long a banned IP stays blocked (default: 600000)
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
      rotation?: 'daily' | 'weekly' | 'none'
      ttlDays?: number
    }
  }

  // ─── Playback ──────────────────────────────────────────────────────────────
  playerUpdateInterval: number      // ms between playerUpdate WS events
  statsInterval: number             // ms between stats WS broadcasts
  trackStuckThresholdMs: number     // ms without progress before TrackStuck event
  zombieThresholdMs: number         // ms before a player with no voice is destroyed

  // ─── Loading limits ────────────────────────────────────────────────────────
  maxSearchResults: number          // max tracks returned per search query
  maxPlaylistLength: number         // max tracks loaded from a playlist/album

  // ─── Default audio filters ─────────────────────────────────────────────────
  filters?: FiltersConfig

  // ─── Route planner ────────────────────────────────────────────────────────
  routePlanner?: RoutePlannerConfig

  // ─── Sources ───────────────────────────────────────────────────────────────
  sources: {
    soundcloud: {
      enabled: boolean
      clientId: string              // leave empty for auto-detection
    }
    deezer: {
      enabled: boolean
      arl?: string                  // required for full streams
      decryptionKey?: string        // 16-char Blowfish key, required with arl
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
      apiKey?: string               // enables listeners/playcount in /v4/meaning
    }
  }
}
