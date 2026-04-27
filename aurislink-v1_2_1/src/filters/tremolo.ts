// src/filters/tremolo.ts
// Tremolo — modulates amplitude with a sine LFO.
// frequency: Hz (default 2.0), depth: 0-1 (default 0.5)

import type { Filters } from '../core/SessionManager.js'
import { SAMPLE_RATE } from './FilterChain.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

// Phase state per filter reference
const phaseMap = new WeakMap<NonNullable<Filters['tremolo']>, { phase: number }>()

export function applyTremolo(chunk: Buffer, filters: Filters): Buffer {
  const tr = filters.tremolo
  if (!tr || (tr.depth ?? 0) <= 0) return chunk

  const freq  = Math.max(0, tr.frequency ?? 2.0)
  const depth = Math.max(0, Math.min(1, tr.depth ?? 0.5))
  const step  = (2 * Math.PI * freq) / SAMPLE_RATE

  let state = phaseMap.get(tr)
  if (!state) { state = { phase: 0 }; phaseMap.set(tr, state) }

  let { phase } = state

  for (let i = 0; i < chunk.length; i += 4) {
    const gain = 1 - depth * (0.5 + 0.5 * Math.sin(phase))
    const L = chunk.readInt16LE(i)
    const R = chunk.readInt16LE(i + 2)
    chunk.writeInt16LE(clamp16(L * gain), i)
    chunk.writeInt16LE(clamp16(R * gain), i + 2)
    phase += step
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI
  }

  state.phase = phase
  return chunk
}
