// src/api/info.ts — GET /v4/info

import type http from 'node:http'
import { sendJson } from './helpers.js'
import { getLoadedPlugins } from '../plugins/index.js'

const BASE_INFO = {
  version: {
    semver: '1.1.0',
    major: 1,
    minor: 1,
    patch: 0,
    preRelease: null,
    build: null,
  },
  buildTime: Date.now(),
  git: {
    branch: 'v1',
    commit: 'unknown',
    commitTime: 0,
  },
  jvm: null,
  lavaplayer: null,
  sourceManagers: ['soundcloud', 'deezer'],
  filters: [
    'equalizer', 'karaoke', 'timescale', 'tremolo',
    'vibrato', 'rotation', 'distortion', 'channelMix',
    'lowPass', 'volume',
  ],
}

export function handleInfo(_req: http.IncomingMessage, res: http.ServerResponse) {
  // Plugins são lidos em tempo real — reflete o estado atual sem precisar
  // reiniciar o handler ou manter estado global mutable aqui.
  const plugins = getLoadedPlugins().map(({ manifest, origin }) => ({
    name:    manifest.name,
    version: manifest.version,
    origin,  // 'local' | 'npm' | 'github' | 'url'
  }))

  sendJson(res, 200, { ...BASE_INFO, plugins })
}
