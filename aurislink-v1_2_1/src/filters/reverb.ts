// src/filters/reverb.ts
// Reverb — Freeverb / Schroeder reverberator.
// mix:      wet/dry 0-1 (default 0.3)
// roomSize: 0-1 (default 0.5)
// damping:  0-1 (default 0.5)

import type { Filters } from '../core/SessionManager.js'
import { SAMPLE_RATE } from './FilterChain.js'

// Extend Filters with reverb (exclusive AurisLink filter)
declare module '../core/SessionManager.js' {
  interface Filters {
    reverb?: { mix?: number; roomSize?: number; damping?: number } | null
  }
}

const COMB_DELAYS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
const AP_DELAYS   = [556, 441, 341, 225]
const STEREO_SPREAD = 23
const SCALE_ROOM = 0.28
const OFFSET_ROOM = 0.7
const SCALE_DAMP = 0.4

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

class CombFilter {
  private buf: Float64Array
  private w = 0
  private store = 0
  private fb = 0
  private d1 = 0
  private d2 = 1

  constructor(size: number) { this.buf = new Float64Array(Math.max(1, size)) }

  set(fb: number, damp: number) { this.fb = fb; this.d1 = damp; this.d2 = 1 - damp }

  process(x: number): number {
    const out = this.buf[this.w] ?? 0
    this.store = out * this.d2 + this.store * this.d1
    this.buf[this.w] = x + this.store * this.fb
    this.w = (this.w + 1) % this.buf.length
    return out
  }
}

class AllpassFilter {
  private buf: Float64Array
  private w = 0
  constructor(size: number) { this.buf = new Float64Array(Math.max(1, size)) }
  process(x: number): number {
    const delayed = this.buf[this.w] ?? 0
    const out = -x + delayed + 0.5 * x
    this.buf[this.w] = x + 0.5 * delayed
    this.w = (this.w + 1) % this.buf.length
    return out
  }
}

interface ReverbState {
  combL:  CombFilter[]
  combR:  CombFilter[]
  apL:    AllpassFilter[]
  apR:    AllpassFilter[]
  lastMix:      number
  lastRoomSize: number
  lastDamping:  number
}

const stateMap = new WeakMap<NonNullable<Filters['reverb']>, ReverbState>()

function buildState(): ReverbState {
  return {
    combL: COMB_DELAYS.map(d => new CombFilter(Math.floor(d * SAMPLE_RATE / 44100))),
    combR: COMB_DELAYS.map(d => new CombFilter(Math.floor((d + STEREO_SPREAD) * SAMPLE_RATE / 44100))),
    apL:   AP_DELAYS.map(d => new AllpassFilter(Math.floor(d * SAMPLE_RATE / 44100))),
    apR:   AP_DELAYS.map(d => new AllpassFilter(Math.floor((d + STEREO_SPREAD) * SAMPLE_RATE / 44100))),
    lastMix: -1, lastRoomSize: -1, lastDamping: -1,
  }
}

export function applyReverb(chunk: Buffer, filters: Filters): Buffer {
  const rv = filters.reverb
  if (!rv || (rv.mix ?? 0) <= 0) return chunk

  const mix      = Math.max(0, Math.min(rv.mix ?? 0.3, 1))
  const roomSize = Math.max(0, Math.min(rv.roomSize ?? 0.5, 1))
  const damping  = Math.max(0, Math.min(rv.damping ?? 0.5, 1))

  let st = stateMap.get(rv)
  if (!st) { st = buildState(); stateMap.set(rv, st) }

  // Rebuild coefficients only when params changed
  if (st.lastMix !== mix || st.lastRoomSize !== roomSize || st.lastDamping !== damping) {
    const fb   = roomSize * SCALE_ROOM + OFFSET_ROOM
    const damp = damping  * SCALE_DAMP
    for (const c of [...st.combL, ...st.combR]) c.set(fb, damp)
    st.lastMix = mix; st.lastRoomSize = roomSize; st.lastDamping = damping
  }

  const wet = mix
  const dry = 1 - mix
  const norm = 0.12 * Math.max(0.02, 1 - (roomSize * SCALE_ROOM + OFFSET_ROOM))

  for (let i = 0; i < chunk.length; i += 4) {
    const inL = chunk.readInt16LE(i)
    const inR = chunk.readInt16LE(i + 2)
    const mono = (inL + inR) * 0.5

    let wL = 0, wR = 0
    for (let j = 0; j < st.combL.length; j++) { wL += st.combL[j]!.process(mono); wR += st.combR[j]!.process(mono) }
    for (const ap of st.apL) wL = ap.process(wL)
    for (const ap of st.apR) wR = ap.process(wR)
    wL *= norm; wR *= norm

    // Soft-clip wet signal
    wL = Math.tanh(wL / 32767) * 32767
    wR = Math.tanh(wR / 32767) * 32767

    chunk.writeInt16LE(clamp16(inL * dry + wL * wet), i)
    chunk.writeInt16LE(clamp16(inR * dry + wR * wet), i + 2)
  }

  return chunk
}
