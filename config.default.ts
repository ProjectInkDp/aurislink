// config.default.ts
// Copy to config.ts and fill in your credentials.
// AurisLink loads config.ts from the project root at startup.

import type { AurisConfig } from './src/typings/index.js'

const config: AurisConfig = {

  // ─── Server ────────────────────────────────────────────────────────────────
  server: {
    host: '0.0.0.0',
    port: 2333,
    password: 'youshallnotpass',
    tls: {
      enabled: false,
      cert: '',   // path to TLS certificate file
      key: '',    // path to TLS private key file
    },
    http2: {
      enabled: false,  // requires tls.enabled = true; enables HTTP/2 with HTTP/1.1 fallback
    },
  },

  // ─── Logging ───────────────────────────────────────────────────────────────
  logging: {
    level: 'info',        // 'debug' | 'info' | 'warn' | 'error'
    timestamps: true,
    colors: true,
    file: {
      enabled: false,
      path: 'logs',       // directory for log files
      rotation: 'daily',  // 'daily' | 'weekly' | 'none'
      ttlDays: 7,         // delete logs older than N days (0 = keep forever)
    },
  },

  // ─── Playback timings ──────────────────────────────────────────────────────
  playerUpdateInterval: 5_000,    // ms between playerUpdate WebSocket events
  statsInterval: 60_000,          // ms between stats WebSocket broadcasts
  trackStuckThresholdMs: 10_000,  // ms without progress before TrackStuck fires
  zombieThresholdMs: 60_000,      // ms before a playerless voice connection is destroyed

  // ─── Loading limits ────────────────────────────────────────────────────────
  maxSearchResults: 10,           // max tracks returned per search query
  maxPlaylistLength: 100,         // max tracks loaded from a playlist or album

  // ─── Audio filters ─────────────────────────────────────────────────────────
  // These are the default values applied to every new player.
  // Clients can override any filter at any time via:
  //   PATCH /v4/sessions/:sessionId/players/:guildId  { "filters": { ... } }
  filters: {
    defaultVolume: 1.0,       // 0.0 = silence | 1.0 = normal | 5.0 = max

    equalizer: [],            // [{ band: 0–14, gain: -0.25..1.0 }] — 15-band biquad EQ

    lowPass: null,            // { smoothing: 1–100 } — higher = more bass cut | null = off

    timescale: null,          // { speed: 1.0, pitch: 1.0, rate: 1.0 } | null = off

    tremolo: null,            // { frequency: 2.0, depth: 0.5 } — amplitude LFO | null = off

    vibrato: null,            // { frequency: 2.0, depth: 0.5 } — pitch LFO | null = off

    rotation: null,           // { rotationHz: 0.2 } — 8D audio panning | null = off

    channelMix: null,         // { leftToLeft, leftToRight, rightToLeft, rightToRight } | null = off

    echo: null,               // { delay: 300, feedback: 0.4, mix: 0.5 } — AurisLink exclusive | null = off

    reverb: null,             // { mix: 0.3, roomSize: 0.5, damping: 0.5 } — AurisLink exclusive | null = off
  },

  // ─── Route planner ────────────────────────────────────────────────────────
  // Rotates outbound IPs when one gets rate-limited or banned.
  // Leave ipPool empty to disable.
  routePlanner: {
    enabled: false,
    ipPool: [],                   // e.g. ["1.2.3.4", "1.2.3.5"]
    strategy: 'RotateOnBan',      // RotateOnBan | LoadBalance | NanoSwitch
    cooldownMs: 600_000,          // 10 minutes — how long a banned IP stays blocked
  },

  // ─── Cluster ──────────────────────────────────────────────────────────────
  // Controls multi-worker source isolation.
  // Source operations (search, load, lyrics) run in a dedicated worker process
  // so heavy I/O never blocks the main audio loop.
  // Set enabled: false to run sources in-process (useful for very low-memory devices).
  cluster: {
    enabled: true,
    workers: 1,                    // number of source worker processes (0 = os.cpus().length)
    commandTimeoutMs: 10_000,      // timeout for heavy ops like loadTracks / playlist fetch
    fastCommandTimeoutMs: 5_000,   // timeout for quick player commands (play, pause, seek)
    hibernation: {
      enabled: false,              // kill idle source workers to reclaim memory
      timeoutMs: 1_200_000,        // idle time before hibernation — 20 min
    },
  },

  // ─── Connection health monitor ────────────────────────────────────────────
  // Periodically probes outbound connectivity and logs the result.
  // Handy on Termux / VPS to catch network degradation before it causes playback errors.
  connection: {
    logAllChecks: false,           // true = log every probe result, not only degraded ones
    intervalMs:   300_000,         // how often to probe — 5 min
    timeoutMs:    10_000,          // HTTP timeout for the probe request — 10 s
    thresholds: {
      badMbps:     1,              // below this speed → warn log
      averageMbps: 5,              // below this speed → info log (above = debug / skipped)
    },
    probeUrl: 'https://speed.cloudflare.com/__down?bytes=1000000', // 1 MB test file
  },

  // ─── DoS protection ───────────────────────────────────────────────────────
  // Burst detection with exponential backoff applied before routing.
  // Tune thresholds to match your expected traffic.
  dosProtection: {
    enabled: false,
    thresholds: {
      burstRequests: 100,     // max requests per window per IP
      timeWindowMs:  10_000,  // sliding window size (ms)
      warnRatio:     0.8,     // log a warning when this ratio of the limit is reached
      maxEntries:    10_000,  // max number of tracked IPs before LRU eviction
    },
    mitigation: {
      delayMs:            500,      // delay added to requests that exceed the warn ratio
      blockDurationMs:    30_000,   // block duration when hard limit is exceeded
      backoffMultiplier:  2,        // multiply blockDurationMs on repeated violations
      maxBlockDurationMs: 600_000,  // cap on backoff block duration (10 min)
    },
    ignore: {
      ips:   [],   // IPs exempt from DoS checks (e.g. your own bot host)
      paths: [],   // URL paths exempt (e.g. ['/v4/health'])
    },
    trustProxy: false,  // set true if AurisLink is behind a reverse proxy (uses X-Forwarded-For)
  },

  // ─── Rate limiting ────────────────────────────────────────────────────────
  // Multi-scope sliding-window rate limiter.
  // Tracks independent limits for global traffic, per-IP, per-User-Id header,
  // and per-Guild-Id (extracted from player URL).
  // Emits X-RateLimit-* headers on every response.
  rateLimit: {
    enabled: true,
    trustProxy: false,      // set true if behind a reverse proxy (uses X-Forwarded-For)
    maxEntries: 8_000,      // max tracked entries before LRU eviction

    global: {
      maxRequests: 2_000,   // max requests across all clients combined
      windowMs:    60_000,  // 1 minute
    },
    perIp: {
      maxRequests: 120,     // max requests per client IP
      windowMs:    60_000,  // 1 minute
    },
    perUserId: {
      maxRequests: 60,      // max requests per User-Id header
      windowMs:    60_000,  // 1 minute
    },
    perGuildId: {
      maxRequests: 30,      // max requests per Guild-Id (from player URL)
      windowMs:    60_000,  // 1 minute
    },

    // Paths that bypass rate limiting entirely
    ignorePaths: ['/v4/health', '/v4/metrics', '/v4/version'],
  },

  // ─── Lyrics providers ─────────────────────────────────────────────────────
  lyrics: {
    // Providers tried in order: LRCLib → Genius → Deezer → Musixmatch → Letras.mus.br → Yandex Music
    yandexmusic: {
      accessToken: '',  // Yandex Music OAuth2 token (optional — provider skipped if empty)
      // Obtain at https://oauth.yandex.com — scope: login:info music:read
    },
  },

  // ─── Sources ───────────────────────────────────────────────────────────────
  sources: {

    soundcloud: {
      enabled: true,
      clientId: '',   // leave empty for auto-detection from soundcloud.com
    },

    deezer: {
      enabled: false,
      arl: '',            // your Deezer ARL cookie — enables full audio streams
      decryptionKey: '',  // 16-char Blowfish key — required alongside arl
      // Without arl, Deezer works for search and metadata only (no audio).
    },

    jiosaavn: {
      enabled: false,
      playlistLoadLimit: 50,   // max tracks loaded from a JioSaavn playlist/album
      artistLoadLimit: 20,     // max tracks loaded from a JioSaavn artist page
      secretKey: '38346591',   // DES/ECB decryption key — leave as default
      proxy: {
        url: '',          // HTTP/HTTPS proxy URL (useful if hosted outside India)
        username: '',     // optional proxy username
        password: '',     // optional proxy password
      },
    },

    lastfm: {
      apiKey: '',   // Last.fm API key — enables listeners/playcount in /v4/meaning
    },

    spotify: {
      enabled: false,
      market: 'US',               // ISO 3166-1 alpha-2 country code
      playlistLoadLimit: 100,     // max tracks from a playlist
      albumLoadLimit: 50,         // max tracks from an album

      // ── Auth ──────────────────────────────────────────────────────────────
      // Option A: anonymous TOTP (default — no credentials needed)
      preferAnonymousToken: true,

      // Option B: OAuth2 clientId + clientSecret (most stable)
      // Get yours at: https://developer.spotify.com/dashboard
      clientId: '',
      clientSecret: '',

      // Option C: custom token endpoint (e.g. self-hosted proxy)
      customTokenEndpoint: '',

      // Optional: sp_dc cookie for lyrics support
      sp_dc: '',
    },

  },

}

export default config
