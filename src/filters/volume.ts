// src/filters/volume.ts
// Volume — scales PCM amplitude.
// filters.volume: 0.0–5.0 (1.0 = normal, 0.0 = silence, 2.0 = double)

import type { Filters } from '../core/SessionManager.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

export function applyVolume(chunk: Buffer, filters: Filters): Buffer {
  const vol = filters.volume ?? 1.0
  if (vol === 1.0) return chunk

  for (let i = 0; i < chunk.length; i += 2) {
    chunk.writeInt16LE(clamp16(chunk.readInt16LE(i) * vol), i)
  }

  return chunk
}
