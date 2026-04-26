// src/filters/echo.ts
// Echo — delay line with feedback. Full Float64 internal precision.
// delay:    delay in ms (default 300)
// feedback: 0-1 (default 0.4)
// mix:      wet/dry 0-1 (default 0.5)

import type { Filters } from '../core/SessionManager.js'
import { SAMPLE_RATE } from './constants.js'

// Extend Filters type with echo (exclusive AurisLink filter)
declare module '../core/SessionManager.js' {
  interface Filters {
    echo?: { delay?: number; feedback?: number; mix?: number } | null
  }
}

const MAX_DELAY_MS = 2000
const BUF_SIZE = Math.ceil(SAMPLE_RATE * MAX_DELAY_MS / 1000)

function clamp16(v: number): number {
  return v > 32767 ? 32767 : v < -32768 ? -32768 : v | 0
}

interface EchoState {
  bufL: Float64Array
  bufR: Float64Array
  write: number
}

const stateMap = new WeakMap<NonNullable<Filters['echo']>, EchoState>()

function lerp(buf: Float64Array, pos: number): number {
  const lo = Math.floor(pos) % buf.length
  const hi = (lo + 1) % buf.length
  const t  = pos - Math.floor(pos)
  return (buf[lo] ?? 0) + ((buf[hi] ?? 0) - (buf[lo] ?? 0)) * t
}

export function applyEcho(chunk: Buffer, filters: Filters): Buffer {
  const ec = filters.echo
  if (!ec || (ec.delay ?? 0) <= 0) return chunk

  const delay    = Math.min(ec.delay ?? 300, MAX_DELAY_MS)
  const feedback = Math.max(0, Math.min(ec.feedback ?? 0.4, 0.95))
  const wet      = Math.max(0, Math.min(ec.mix ?? 0.5, 1))
  const dry      = 1 - wet
  const delaySamples = (delay * SAMPLE_RATE) / 1000

  let st = stateMap.get(ec)
  if (!st) {
    st = { bufL: new Float64Array(BUF_SIZE), bufR: new Float64Array(BUF_SIZE), write: 0 }
    stateMap.set(ec, st)
  }

  for (let i = 0; i < chunk.length; i += 4) {
    const inL = chunk.readInt16LE(i)
    const inR = chunk.readInt16LE(i + 2)

    const readPos = (st.write - delaySamples + BUF_SIZE) % BUF_SIZE
    const delL = lerp(st.bufL, readPos)
    const delR = lerp(st.bufR, readPos)

    const fbL = inL + delL * feedback
    const fbR = inR + delR * feedback
    st.bufL[st.write] = fbL > 65534 ? 65534 : fbL < -65534 ? -65534 : fbL
    st.bufR[st.write] = fbR > 65534 ? 65534 : fbR < -65534 ? -65534 : fbR

    chunk.writeInt16LE(clamp16(inL * dry + delL * wet), i)
    chunk.writeInt16LE(clamp16(inR * dry + delR * wet), i + 2)

    st.write = (st.write + 1) % BUF_SIZE
  }

  return chunk
}
