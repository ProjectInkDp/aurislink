// src/api/info.ts — GET /v4/info

import type http from 'node:http'
import { sendJson } from './helpers.js'

const AURIS_VERSION = '1.5.0'
const [MAJOR, MINOR, PATCH] = AURIS_VERSION.split('.').map(Number)

const INFO = {
  version: {
    semver:     AURIS_VERSION,
    major:      MAJOR,
    minor:      MINOR,
    patch:      PATCH,
    preRelease: null,
    build:      null,
  },
  buildTime:      Date.now(),
  git: {
    branch:     'v1',
    commit:     'unknown',
    commitTime: 0,
  },
  jvm:         null,
  lavaplayer:  null,
  sourceManagers: ['soundcloud', 'deezer', 'jiosaavn', 'spotify'],
  filters: [
    'equalizer', 'timescale', 'tremolo', 'vibrato',
    'rotation', 'channelMix', 'lowPass', 'echo', 'reverb', 'volume',
  ],
  plugins: [],
}

export function handleInfo(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJson(res, 200, INFO)
}
