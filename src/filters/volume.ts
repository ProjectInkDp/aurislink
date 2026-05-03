import type { AudioFilters as Filters } from '../engine/SessionManager.js'

/**
 * AurisLink Amplitude Controller
 * Adjusts the gain of raw PCM audio data.
 */
export function applyVolume(chunk: Buffer, filters: Filters): Buffer {
  const multiplier = filters.volume ?? 1.0
  if (multiplier === 1.0) return chunk

  for (let i = 0; i < chunk.length; i += 2) {
    const raw = chunk.readInt16LE(i)
    const scaled = Math.max(-32768, Math.min(32767, raw * multiplier))
    chunk.writeInt16LE(Math.round(scaled), i)
  }

  return chunk
}
