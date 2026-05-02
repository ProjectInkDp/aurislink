// src/filters/rotation.ts
// Stereo rotation (8D audio) — pans L/R continuously using a sine LFO.
// rotationHz: rotation speed in Hz (e.g. 0.2 for slow 8D)

import type { AudioFilters as Filters } from '../engine/SessionManager.js'
import { SAMPLE_RATE } from './constants.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

const phaseMap = new WeakMap<NonNullable<Filters['rotation']>, { phase: number }>()

export function applyRotation(chunk: Buffer, filters: Filters): Buffer {
  const rot = filters.rotation
  if (!rot || (rot.rotationHz ?? 0) === 0) return chunk

  const step = (2 * Math.PI * (rot.rotationHz ?? 0.2)) / SAMPLE_RATE

  let state = phaseMap.get(rot)
  if (!state) { state = { phase: 0 }; phaseMap.set(rot, state) }

  let { phase } = state

  for (let i = 0; i < chunk.length; i += 4) {
    const L = chunk.readInt16LE(i)
    const R = chunk.readInt16LE(i + 2)

    const panL = 0.5 + 0.5 * Math.sin(phase)        // 0 → 1
    const panR = 0.5 + 0.5 * Math.sin(phase + Math.PI)

    const mono = (L + R) * 0.5

    chunk.writeInt16LE(clamp16(mono * panL * 2), i)
    chunk.writeInt16LE(clamp16(mono * panR * 2), i + 2)

    phase += step
    if (phase > 2 * Math.PI) phase -= 2 * Math.PI
  }

  state.phase = phase
  return chunk
}
