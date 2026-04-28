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

export interface AurisDosConfig {
  enabled?:   boolean
  thresholds?: Partial<DosProtectionThresholds>
  mitigation?: Partial<DosProtectionMitigation>
  ignore?: {
    userIds?:  string[]
    guildIds?: string[]
    ips?:      string[]
    paths?:    string[]
  }
  trustProxy?: boolean
}

export interface Http2Config {
  enabled: boolean
}

export interface ServerConfig {
  host: string
  port: number
  password: string
  tls: TlsConfig
  http2?: Http2Config
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
    spotify?: {
      enabled:               boolean
      market?:               string   // ISO 3166-1 alpha-2 country code (default: 'US')
      playlistLoadLimit?:    number   // max tracks from playlist (default: 100)
      albumLoadLimit?:       number   // max tracks from album (default: 50)
      clientId?:             string   // OAuth2 clientId — more stable than anonymous token
      clientSecret?:         string   // OAuth2 clientSecret — required with clientId
      customTokenEndpoint?:  string   // custom URL to fetch Spotify token (e.g. self-hosted)
      preferAnonymousToken?: boolean  // true = use TOTP anonymous; false = prefer OAuth2 (default: true)
      sp_dc?:                string   // Spotify session cookie — enables lyrics via sp_dc
    }
  }
}

// ─── Lyrics ───────────────────────────────────────────────────────────────────

export interface LyricsLine {
  text:     string
  time:     number
  duration: number
}

export interface LyricsData {
  name:   string
  synced: boolean
  lines:  LyricsLine[]
}

export type LyricsResult =
  | { loadType: 'lyrics'; data: LyricsData }
  | { loadType: 'empty';  data: Record<string, never> }
  | { loadType: 'error';  data: { message: string; severity: string } }

// ─── DoS Protection ───────────────────────────────────────────────────────────

export interface DosProtectionThresholds {
  burstRequests: number
  timeWindowMs:  number
  warnRatio?:    number
  maxEntries?:   number
}

export interface DosProtectionMitigation {
  delayMs:             number
  blockDurationMs:     number
  backoffMultiplier?:  number
  maxBlockDurationMs?: number
}

export interface DosProtectionConfig {
  enabled:    boolean
  thresholds: DosProtectionThresholds
  mitigation: DosProtectionMitigation
  ignore?: {
    userIds?:  string[]
    guildIds?: string[]
    ips?:      string[]
    paths?:    string[]
  }
  trustProxy?: boolean
}

export interface DosProtectionEntry {
  count:        number
  lastReset:    number
  lastSeen:     number
  blockedUntil: number
  strikes:      number
}

export interface ApiDosProtectionResult {
  allowed: boolean
  status?:  number
  message?: string
  delay?:   number
}

// ─── DoS Protection API types ─────────────────────────────────────────────────

export interface ApiRequest {
  url?:    string
  socket?: { remoteAddress?: string }
  headers: Record<string, string | string[] | undefined>
}
