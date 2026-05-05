import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type http from 'node:http'
import { sendJson } from './helpers.js'

/**
 * AurisLink Information Endpoint
 * Dynamically retrieves versioning and capability data.
 */

// Cache package data to avoid redundant I/O
const packageData = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'))

const SERVER_INFO = {
  version: {
    semver: packageData.version,
    major: parseInt(packageData.version.split('.')[0]),
    minor: parseInt(packageData.version.split('.')[1]),
    patch: parseInt(packageData.version.split('.')[2].split('-')[0]),
    preRelease: packageData.version.includes('-') ? packageData.version.split('-')[1] : null
  },
  buildTime: Date.now(),
  git: {
    branch: 'dev',
    commit: 'unknown'
  },
  jvm: process.version,
  lavalink: 'AurisLink',
  sourceManagers: ['youtube', 'ytmusic', 'soundcloud', 'deezer', 'jiosaavn', 'spotify', 'applemusic'],
  filters: [
    'equalizer', 'timescale', 'tremolo', 'vibrato',
    'rotation', 'channelMix', 'lowPass', 'echo', 'reverb', 'volume', 'distortion'
  ],
  plugins: []
}

/**
 * Handles the /v4/info request.
 */
export function handleInfo(_req: http.IncomingMessage, res: http.ServerResponse): void {
  sendJson(res, 200, SERVER_INFO)
}
