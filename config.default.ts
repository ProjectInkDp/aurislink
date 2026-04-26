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

  sources: {
    soundcloud: {
      enabled: true,
      clientId: '',
    },
    jiosaavn: {
      enabled: false,
      playlistLoadLimit: 50,    // max tracks loaded from a playlist/album
      artistLoadLimit: 20,      // max tracks loaded from an artist
      // secretKey: '38346591', // DES/ECB key — leave empty to use built-in default
      // proxy: {
      //   url: '',             // HTTP/HTTPS proxy (useful outside India)
      //   username: '',
      //   password: '',
      // },
    },
    deezer: {
      enabled: false,
      // arl: '',
      // decryptionKey: '',
    },
    lastfm: {
      apiKey: '',  // optional — enables listener/playcount stats in /v4/meaning
    },
  },
}

export default config
