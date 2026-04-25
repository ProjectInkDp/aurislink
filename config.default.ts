// config.default.ts
// Copy this file to config.ts and adjust as needed.
// AurisLink will load config.ts from the project root at startup.

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
  },
}

export default config
