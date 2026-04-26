// src/filters/channelMix.ts
// ChannelMix — mix L/R channels into each other.
// Matches Lavalink v4 spec exactly.

import type { Filters } from '../core/SessionManager.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

export function applyChannelMix(chunk: Buffer, filters: Filters): Buffer {
  const cm = filters.channelMix
  if (!cm) return chunk

  const ll = cm.leftToLeft   ?? 1
  const lr = cm.leftToRight  ?? 0
  const rl = cm.rightToLeft  ?? 0
  const rr = cm.rightToRight ?? 1

  for (let i = 0; i < chunk.length; i += 4) {
    const L = chunk.readInt16LE(i)
    const R = chunk.readInt16LE(i + 2)
    chunk.writeInt16LE(clamp16(L * ll + R * rl), i)
    chunk.writeInt16LE(clamp16(L * lr + R * rr), i + 2)
  }

  return chunk
}
