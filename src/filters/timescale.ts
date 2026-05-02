// src/filters/timescale.ts
// Speed / pitch / rate via linear resampling.
// speed  — playback speed multiplier (default 1.0)
// pitch  — pitch multiplier (default 1.0)
// rate   — combined speed+pitch shorthand (default 1.0)

import type { AudioFilters as Filters } from '../engine/SessionManager.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

// Per-player leftover samples from previous chunk (keyed by filter reference)
const remainderMap = new WeakMap<NonNullable<Filters['timescale']>, number[]>()

export function applyTimescale(chunk: Buffer, filters: Filters): Buffer {
  const ts = filters.timescale
  if (!ts) return chunk

  const speed = (ts.speed ?? 1.0) * (ts.rate ?? 1.0)
  const pitch = ts.pitch ?? 1.0

  // Nothing to do
  if (Math.abs(speed - 1.0) < 0.001 && Math.abs(pitch - 1.0) < 0.001) return chunk

  // ── Convert input buffer to Float64 samples ──────────────────────────────
  const inSamples = chunk.length / 2  // Int16 = 2 bytes each
  const rawIn: number[] = []
  for (let i = 0; i < chunk.length; i += 2) rawIn.push(chunk.readInt16LE(i))

  // ── Pitch shift via sample-rate change trick ──────────────────────────────
  // We resample at ratio = 1/pitch to shift pitch, then resample back at speed.
  const ratio = speed / pitch
  const outCount = Math.floor(rawIn.length / (2 * ratio)) * 2  // keep stereo pairs

  if (outCount <= 0) return Buffer.alloc(0)

  const out = Buffer.allocUnsafe(outCount * 2)

  for (let i = 0; i < outCount; i += 2) {
    const srcIdx = (i / 2) * ratio * 2  // float index into stereo pairs

    const lo = Math.floor(srcIdx / 2) * 2
    const hi = lo + 2
    const t  = (srcIdx - lo) / 2  // interpolation factor 0-1

    const sL0 = rawIn[lo]     ?? 0
    const sR0 = rawIn[lo + 1] ?? 0
    const sL1 = rawIn[hi]     ?? sL0
    const sR1 = rawIn[hi + 1] ?? sR0

    const L = sL0 + (sL1 - sL0) * t
    const R = sR0 + (sR1 - sR0) * t

    out.writeInt16LE(clamp16(L), i * 2)
    out.writeInt16LE(clamp16(R), i * 2 + 2)
  }

  return out
}
