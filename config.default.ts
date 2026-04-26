// config.default.ts
// Copy to config.ts and adjust as needed.
// AurisLink loads config.ts from the project root at startup.

import type { AurisConfig } from './src/typings/index.js'

const config: AurisConfig = {
  server: {
    host: '0.0.0.0',
    port: 2333,
    password: 'youshallnotpass',
    tls: {
      enabled: false,
      cert: '',
      key: '',
    },
  },

  logging: {
    level: 'info',
    timestamps: true,
    colors: true,
    file: {
      enabled: false,
      path: 'logs',
    },
  },

  playerUpdateInterval: 5_000,
  statsInterval: 60_000,
  maxSearchResults: 10,
  maxPlaylistLength: 100,

  // ─── Audio Filters ────────────────────────────────────────────────────────
  // Default filter values applied to every new player.
  // These are the starting values — clients can override per-player at any
  // time via PATCH /v4/sessions/:id/players/:guildId with { filters: { ... } }
  filters: {
    defaultVolume: 1.0,       // 0.0 = silence, 1.0 = normal, 5.0 = max

    equalizer: [],            // [{ band: 0-14, gain: -0.25..1.0 }] — 15-band biquad EQ

    lowPass: null,            // { smoothing: 1–100 } — higher = more bass, null = off

    timescale: null,          // { speed: 1.0, pitch: 1.0, rate: 1.0 } — null = off

    tremolo: null,            // { frequency: 2.0, depth: 0.5 } — amplitude LFO, null = off

    vibrato: null,            // { frequency: 2.0, depth: 0.5 } — pitch LFO, null = off

    rotation: null,           // { rotationHz: 0.2 } — 8D audio panning, null = off

    channelMix: null,         // { leftToLeft, leftToRight, rightToLeft, rightToRight } — null = off

    echo: null,               // { delay: 300, feedback: 0.4, mix: 0.5 } — AurisLink exclusive, null = off

    reverb: null,             // { mix: 0.3, roomSize: 0.5, damping: 0.5 } — AurisLink exclusive, null = off
  },

  sources: {
    soundcloud: {
      enabled: true,
      clientId: '',
    },
    jiosaavn: {
      enabled: false,
      playlistLoadLimit: 50,
      artistLoadLimit: 20,
      secretKey: '38346591',
      proxy: {
        url: '',
        username: '',
        password: '',
      },
    },
    deezer: {
      enabled: false,
      arl: '',
      decryptionKey: '',
    },
    lastfm: {
      apiKey: '',
    },
  },
}

export default config
