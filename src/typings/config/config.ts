import type { AurisDosConfig } from "./dosProtection.js";
import type { FiltersConfig } from "./filters.js";
import type { RoutePlannerConfig } from "./routePlanner.js";
import type { ClusterConfig } from "./cluster.js";
import type { ConnectionConfig } from "./connection.js";
import type { AurisRateLimitConfig } from "./rateLimit.js";
import type { PluginDefinition } from "../engine/plugin.js";

export interface TlsConfig {
  enabled: boolean
  cert: string
  key: string
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

export interface ClientOptions {
  playback?: boolean
  searching?: boolean
  videoLoading?: boolean
  playlistLoading?: boolean
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

  playerUpdateInterval: number
  statsInterval: number
  trackStuckThresholdMs: number
  zombieThresholdMs: number

  maxSearchResults: number
  maxPlaylistLength: number

  filters?: FiltersConfig
  routePlanner?: RoutePlannerConfig
  cluster?: ClusterConfig
  connection?: ConnectionConfig
  dosProtection?: AurisDosConfig
  rateLimit?: AurisRateLimitConfig
  plugins?: PluginDefinition[]

  lyrics?: {
    enabled: boolean
    providers: ('deezer' | 'lrclib' | 'yandexmusic')[]
    yandexmusic?: {
      accessToken?: string
    }
  }

  sources: {
    soundcloud: {
      enabled: boolean
      clientId: string
    }
    deezer: {
      enabled: boolean
      arl?: string
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
    spotify?: {
      enabled:               boolean
      market?:               string
      playlistLoadLimit?:    number
      albumLoadLimit?:       number
      clientId?:             string
      clientSecret?:         string
      customTokenEndpoint?:  string
      preferAnonymousToken?: boolean
      sp_dc?:                string
    }
    applemusic?: {
      enabled: boolean
      market?: string
      playlistLoadLimit?: number
      albumLoadLimit?: number
    }
    youtube?: {
      enabled: boolean
      allowSearch?: boolean
      allowDirectVideoIds?: boolean
      allowDirectPlaylistIds?: boolean
      pot?: {
        token?: string
        visitorData?: string
      }
      oauth?: {
        enabled: boolean
        refreshToken?: string
        skipInitialization?: boolean
      }
      clients?: string[]
      clientOptions?: Record<string, ClientOptions>
      cipher?: {
        url?: string
        token?: string
      }
    }
    ytmusic?: {
      enabled: boolean
    }
  }
}
