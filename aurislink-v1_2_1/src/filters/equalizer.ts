// src/filters/equalizer.ts
// 15-band biquad peaking EQ — matches Lavalink v4 spec exactly.
// Each band: { band: 0-14, gain: -0.25..1.0 }

import type { Filters } from '../core/SessionManager.js'
import { SAMPLE_RATE } from './FilterChain.js'

// Centre frequencies (Hz) for bands 0-14
const BAND_FREQS = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000]

interface BiquadState {
  b0: number; b1: number; b2: number
  a1: number; a2: number
  x1L: number; x2L: number; y1L: number; y2L: number
  x1R: number; x2R: number; y1R: number; y2R: number
}

function makePeakingBiquad(freq: number, gain: number, Q = 1.0): BiquadState {
  const A  = Math.pow(10, gain / 40)
  const w0 = 2 * Math.PI * freq / SAMPLE_RATE
  const alpha = Math.sin(w0) / (2 * Q)

  const b0 =  1 + alpha * A
  const b1 = -2 * Math.cos(w0)
  const b2 =  1 - alpha * A
  const a0 =  1 + alpha / A
  const a1 = -2 * Math.cos(w0)
  const a2 =  1 - alpha / A

  return { b0: b0/a0, b1: b1/a0, b2: b2/a0, a1: a1/a0, a2: a2/a0,
           x1L: 0, x2L: 0, y1L: 0, y2L: 0, x1R: 0, x2R: 0, y1R: 0, y2R: 0 }
}

function processBiquad(s: BiquadState, inL: number, inR: number): [number, number] {
  const outL = s.b0 * inL + s.b1 * s.x1L + s.b2 * s.x2L - s.a1 * s.y1L - s.a2 * s.y2L
  s.x2L = s.x1L; s.x1L = inL; s.y2L = s.y1L; s.y1L = outL

  const outR = s.b0 * inR + s.b1 * s.x1R + s.b2 * s.x2R - s.a1 * s.y1R - s.a2 * s.y2R
  s.x2R = s.x1R; s.x1R = inR; s.y2R = s.y1R; s.y1R = outR

  return [outL, outR]
}

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

// Cache biquad states per filter config (keyed by JSON fingerprint)
const stateCache = new WeakMap<NonNullable<Filters['equalizer']>, BiquadState[]>()

function getOrBuildStates(bands: NonNullable<Filters['equalizer']>): BiquadState[] {
  if (stateCache.has(bands)) return stateCache.get(bands)!
  const states = BAND_FREQS.map((freq, i) => {
    const band = bands.find(b => b.band === i)
    return makePeakingBiquad(freq, (band?.gain ?? 0) * 40)
  })
  stateCache.set(bands, states)
  return states
}

export function applyEqualizer(chunk: Buffer, filters: Filters): Buffer {
  if (!filters.equalizer || filters.equalizer.length === 0) return chunk

  const states = getOrBuildStates(filters.equalizer)

  for (let i = 0; i < chunk.length; i += 4) {
    let L = chunk.readInt16LE(i)
    let R = chunk.readInt16LE(i + 2)

    for (const s of states) {
      ;[L, R] = processBiquad(s, L, R)
    }

    chunk.writeInt16LE(clamp16(L), i)
    chunk.writeInt16LE(clamp16(R), i + 2)
  }

  return chunk
}
