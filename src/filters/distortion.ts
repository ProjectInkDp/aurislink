import type { AudioFilters as Filters } from '../engine/SessionManager.js'

/**
 * AurisLink Distortion Processor
 * Implements non-linear waveshaping for audio signals.
 */
export function applyDistortion(chunk: Buffer, filters: Filters): Buffer {
  const cfg = filters.distortion
  if (!cfg) return chunk

  const {
    sinOffset = 0, sinScale = 1,
    cosOffset = 0, cosScale = 1,
    tanOffset = 0, tanScale = 1,
    offset = 0, scale = 1
  } = cfg

  for (let i = 0; i < chunk.length; i += 4) {
    // Process stereo 16-bit samples
    for (let offsetIdx = i; offsetIdx < i + 4; offsetIdx += 2) {
      let val = chunk.readInt16LE(offsetIdx) / 32768

      // Apply non-linear transformation
      val = Math.sin(val * sinScale + sinOffset) * 
            Math.cos(val * cosScale + cosOffset) * 
            Math.tan(val * tanScale + tanOffset) * 
            scale + offset

      // Clamp to 16-bit range
      const out = Math.max(-32768, Math.min(32767, val * 32768))
      chunk.writeInt16LE(Math.round(out), offsetIdx)
    }
  }

  return chunk
}
