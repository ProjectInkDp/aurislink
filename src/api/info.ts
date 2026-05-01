// src/api/info.ts — GET /v4/info

import type http from 'node:http'
import { sendJson } from './helpers.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// Read version from package.json dynamically
const pkgPath = join(process.cwd(), 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
const AURIS_VERSION = pkg.version

const [semverBase, preRelease] = AURIS_VERSION.split('-')
const [MAJOR, MINOR, PATCH] = semverBase.split('.').map(Number)

const INFO = {
  version: {
    semver:     AURIS_VERSION,
    major:      MAJOR,
    minor:      MINOR,
    patch:      PATCH,
    preRelease: preRelease || null,
    build:      null,
  },
  buildTime:      Date.now(),
  git: {
    branch:     'dev',
    commit:     'unknown',
    commitTime: 0,
  },
  jvm:         null,
  lavaplayer:  null,
  sourceManagers: ['soundcloud', 'deezer', 'jiosaavn', 'spotify'],
  filters: [
    'equalizer', 'timescale', 'tremolo', 'vibrato',
    'rotation', 'channelMix', 'lowPass', 'echo', 'reverb', 'volume', 'distortion'
  ],
  plugins: [],
}

export function handleInfo(_req: http.IncomingMessage, res: http.ServerResponse) {
  sendJson(res, 200, INFO)
}
