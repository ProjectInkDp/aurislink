// config.default.ts
// Copy this file to config.ts and adjust as needed.
// AurisLink will load config.ts from the project root at startup.

import type { AurisConfig } from './src/typings/index.js'

const config: AurisConfig = {
  server: {
    host: '0.0.0.0',
    port: 2333,
    password: 'youshallnotpass',

    // TLS — set enabled: true and point cert/key to your certificate files
    // to run on HTTPS (e.g. port 443).
    tls: {
      enabled: false,
      cert: '', // /etc/letsencrypt/live/example.com/fullchain.pem
      key:  '', // /etc/letsencrypt/live/example.com/privkey.pem
    },
  },

  logging: {
    level:      'info',
    timestamps: true,
    colors:     true,
  },

  // How often connected clients receive a playerUpdate event (ms)
  playerUpdateInterval: 5_000,

  // How often the /stats payload is broadcast to clients (ms)
  statsInterval: 60_000,

  maxSearchResults: 10,
  maxPlaylistLength: 100,

  sources: {
    soundcloud: {
      enabled: true,
      // Leave empty to auto-detect from the SoundCloud web app.
      clientId: '',
    },
  },
}

export default config
