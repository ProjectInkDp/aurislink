// src/filters/vibrato.ts
// Vibrato — modulates pitch with a sine LFO via variable delay line.
// frequency: Hz (default 2.0), depth: 0-1 (default 0.5)

import type { AudioFilters as Filters } from '../engine/SessionManager.js'
import { SAMPLE_RATE } from './constants.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

const MAX_DELAY_SAMPLES = Math.ceil(SAMPLE_RATE * 0.02) // 20ms max

interface VibState {
  phase:  number
  bufL:   Float64Array
  bufR:   Float64Array
  write:  number
}

const stateMap = new WeakMap<NonNullable<Filters['vibrato']>, VibState>()

export function applyVibrato(chunk: Buffer, filters: Filters): Buffer {
  const vb = filters.vibrato
  if (!vb || (vb.depth ?? 0) <= 0) return chunk

  const freq  = Math.max(0, vb.frequency ?? 2.0)
  const depth = Math.max(0, Math.min(1, vb.depth ?? 0.5))
  const maxDelay = depth * MAX_DELAY_SAMPLES
  const step  = (2 * Math.PI * freq) / SAMPLE_RATE
  const bufSize = MAX_DELAY_SAMPLES + 2

  let st = stateMap.get(vb)
  if (!st) {
    st = { phase: 0, bufL: new Float64Array(bufSize), bufR: new Float64Array(bufSize), write: 0 }
    stateMap.set(vb, st)
  }

  for (let i = 0; i < chunk.length; i += 4) {
    const inL = chunk.readInt16LE(i)
    const inR = chunk.readInt16LE(i + 2)

    st.bufL[st.write] = inL
    st.bufR[st.write] = inR

    const delaySamples = maxDelay * (0.5 + 0.5 * Math.sin(st.phase))
    const readF = (st.write - delaySamples + bufSize) % bufSize
    const lo = Math.floor(readF)
    const hi = (lo + 1) % bufSize
    const t  = readF - lo

    const outL = st.bufL[lo]! + (st.bufL[hi]! - st.bufL[lo]!) * t
    const outR = st.bufR[lo]! + (st.bufR[hi]! - st.bufR[lo]!) * t

    chunk.writeInt16LE(clamp16(outL), i)
    chunk.writeInt16LE(clamp16(outR), i + 2)

    st.write = (st.write + 1) % bufSize
    st.phase += step
    if (st.phase > 2 * Math.PI) st.phase -= 2 * Math.PI
  }

  return chunk
}
