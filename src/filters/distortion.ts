// src/filters/distortion.ts
// Distortion — applies non-linear mapping to audio samples.
// sinOffset, sinScale, cosOffset, cosScale, tanOffset, tanScale, offset, scale
import type { Filters } from '../core/SessionManager.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

export function applyDistortion(chunk: Buffer, filters: Filters): Buffer {
  const d = filters.distortion
  if (!d) return chunk

  const sinOffset = d.sinOffset ?? 0
  const sinScale  = d.sinScale  ?? 1
  const cosOffset = d.cosOffset ?? 0
  const cosScale  = d.cosScale  ?? 1
  const tanOffset = d.tanOffset ?? 0
  const tanScale  = d.tanScale  ?? 1
  const offset    = d.offset    ?? 0
  const scale     = d.scale     ?? 1

  for (let i = 0; i < chunk.length; i += 4) {
    // Read 16-bit samples and normalize to [-1, 1]
    let L = chunk.readInt16LE(i) / 32768
    let R = chunk.readInt16LE(i + 2) / 32768

    // Apply distortion formula:
    // sample = sin(sample * sinScale + sinOffset) * cos(sample * cosScale + cosOffset) * tan(sample * tanScale + tanOffset) * scale + offset
    L = Math.sin(L * sinScale + sinOffset) * Math.cos(L * cosScale + cosOffset) * Math.tan(L * tanScale + tanOffset) * scale + offset
    R = Math.sin(R * sinScale + sinOffset) * Math.cos(R * cosScale + cosOffset) * Math.tan(R * tanScale + tanOffset) * scale + offset

    // Denormalize and write back
    chunk.writeInt16LE(clamp16(L * 32768), i)
    chunk.writeInt16LE(clamp16(R * 32768), i + 2)
  }

  return chunk
}
