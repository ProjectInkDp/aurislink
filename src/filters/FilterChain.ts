// src/filters/FilterChain.ts
// AurisLink filter pipeline — applies enabled filters in priority order.

import type { Filters } from '../core/SessionManager.js'
import { applyVolume }     from './volume.js'
import { applyEqualizer }  from './equalizer.js'
import { applyLowPass }    from './lowPass.js'
import { applyTimescale }  from './timescale.js'
import { applyTremolo }    from './tremolo.js'
import { applyVibrato }    from './vibrato.js'
import { applyRotation }   from './rotation.js'
import { applyChannelMix } from './channelMix.js'
import { applyEcho }       from './echo.js'
import { applyReverb }     from './reverb.js'
import { applyDistortion } from './distortion.js'

import { SAMPLE_RATE, CHANNELS } from './constants.js'
export { SAMPLE_RATE, CHANNELS }

export interface FilterEntry {
  name:     string
  priority: number
  apply:    (chunk: Buffer, filters: Filters) => Buffer
  isActive: (filters: Filters) => boolean
}

const REGISTRY: FilterEntry[] = [
  {
    name:     'volume',
    priority: 0,
    apply:    (c, f) => applyVolume(c, f),
    isActive: f => (f.volume ?? 1.0) !== 1.0,
  },
  {
    name:     'equalizer',
    priority: 1,
    apply:    (c, f) => applyEqualizer(c, f),
    isActive: f => Array.isArray(f.equalizer) && f.equalizer.length > 0,
  },
  {
    name:     'lowPass',
    priority: 2,
    apply:    (c, f) => applyLowPass(c, f),
    isActive: f => f.lowPass != null && (f.lowPass.smoothing ?? 20) > 0,
  },
  {
    name:     'timescale',
    priority: 3,
    apply:    (c, f) => applyTimescale(c, f),
    isActive: f => f.timescale != null,
  },
  {
    name:     'tremolo',
    priority: 4,
    apply:    (c, f) => applyTremolo(c, f),
    isActive: f => f.tremolo != null && (f.tremolo.depth ?? 0) > 0,
  },
  {
    name:     'vibrato',
    priority: 5,
    apply:    (c, f) => applyVibrato(c, f),
    isActive: f => f.vibrato != null && (f.vibrato.depth ?? 0) > 0,
  },
  {
    name:     'rotation',
    priority: 6,
    apply:    (c, f) => applyRotation(c, f),
    isActive: f => f.rotation != null && (f.rotation.rotationHz ?? 0) !== 0,
  },
  {
    name:     'channelMix',
    priority: 7,
    apply:    (c, f) => applyChannelMix(c, f),
    isActive: f => f.channelMix != null,
  },
  {
    name:     'echo',
    priority: 8,
    apply:    (c, f) => applyEcho(c, f),
    isActive: f => f.echo != null && (f.echo.delay ?? 0) > 0,
  },
  {
    name:     'reverb',
    priority: 9,
    apply:    (c, f) => applyReverb(c, f),
    isActive: f => f.reverb != null && (f.reverb.mix ?? 0) > 0,
  },
  {
    name:     'distortion',
    priority: 10,
    apply:    (c, f) => applyDistortion(c, f),
    isActive: f => f.distortion != null,
  },
]

const SORTED = [...REGISTRY].sort((a, b) => a.priority - b.priority)

export function applyFilters(chunk: Buffer, filters: Filters): Buffer {
  let buf = chunk
  for (const entry of SORTED) {
    if (entry.isActive(filters)) {
      buf = entry.apply(buf, filters)
    }
  }
  return buf
}

export function activeFilterNames(filters: Filters): string[] {
  return SORTED.filter(e => e.isActive(filters)).map(e => e.name)
}
