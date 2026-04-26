// src/api/info.ts — GET /v4/info

import type http from 'node:http'
import { sendJson } from './helpers.js'

const INFO = {
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
  filters: ['equalizer', 'karaoke', 'timescale', 'tremolo', 'vibrato', 'rotation', 'distortion', 'channelMix', 'lowPass', 'volume'],
  plugins: [],
}

export function handleInfo(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJson(res, 200, INFO)
}
