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
    deezer: {
      enabled: false,
      // arl: '',            // your Deezer ARL cookie (optional, enables full streams)
      // decryptionKey: '',  // 16-char Blowfish key (required when arl is set)
    },
  },
}

export default config
