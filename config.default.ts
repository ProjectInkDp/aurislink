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

  },

}

export default config
