// src/filters/lowPass.ts
// Low-pass filter — single-pole IIR smoothing.
// smoothing: 1–100, higher = more bass (default 20)

import type { Filters } from '../engine/SessionManager.js'

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

interface LPState { prevL: number; prevR: number }
const stateMap = new WeakMap<NonNullable<Filters['lowPass']>, LPState>()

export function applyLowPass(chunk: Buffer, filters: Filters): Buffer {
  const lp = filters.lowPass
  if (!lp) return chunk

  const smoothing = Math.max(1, lp.smoothing ?? 20)
  const alpha = 1 / smoothing  // low alpha = heavy smoothing

  let st = stateMap.get(lp)
  if (!st) { st = { prevL: 0, prevR: 0 }; stateMap.set(lp, st) }

  for (let i = 0; i < chunk.length; i += 4) {
    const L = chunk.readInt16LE(i)
    const R = chunk.readInt16LE(i + 2)
    st.prevL = st.prevL + alpha * (L - st.prevL)
    st.prevR = st.prevR + alpha * (R - st.prevR)
    chunk.writeInt16LE(clamp16(st.prevL), i)
    chunk.writeInt16LE(clamp16(st.prevR), i + 2)
  }

  return chunk
}
