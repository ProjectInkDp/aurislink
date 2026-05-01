// src/filters/equalizer.ts
// AurisLink 15-Band Parametric Equalizer
// Implements a series of biquad peaking filters for precise frequency control.

import type { AudioFilters } from '../engine/SessionManager.js'
import { SAMPLE_RATE } from './constants.js'

// Standard Lavalink v4 center frequencies (Hz)
const FREQUENCY_MAP = [25, 40, 63, 100, 160, 250, 400, 630, 1000, 1600, 2500, 4000, 6300, 10000, 16000]

/**
 * Biquad filter coefficients and state buffers using Direct Form II.
 */
interface FilterNode {
  // Coefficients
  b0: number; b1: number; b2: number
  a1: number; a2: number
  // Delay lines (Left)
  z1L: number; z2L: number
  // Delay lines (Right)
  z1R: number; z2R: number
}

/**
 * Computes peaking biquad coefficients based on frequency and gain.
 * @param frequency Center frequency in Hz
 * @param gain Gain in dB
 * @param bandwidth Bandwidth in octaves (default 1.0)
 */
function calculatePeakingNode(frequency: number, gain: number, bandwidth = 1.0): FilterNode {
  const A = Math.pow(10, gain / 40)
  const omega = 2 * Math.PI * frequency / SAMPLE_RATE
  const sn = Math.sin(omega)
  const cs = Math.cos(omega)
  const alpha = sn * Math.sinh(Math.log(2) / 2 * bandwidth * omega / sn)

  const b0 = 1 + alpha * A
  const b1 = -2 * cs
  const b2 = 1 - alpha * A
  const a0 = 1 + alpha / A
  const a1 = -2 * cs
  const a2 = 1 - alpha / A

  return {
    b0: b0 / a0, b1: b1 / a0, b2: b2 / a0,
    a1: a1 / a0, a2: a2 / a0,
    z1L: 0, z2L: 0, z1R: 0, z2R: 0
  }
}

export class Equalizer {
  private nodes: FilterNode[] = []
  private activeBands: number[] = new Array(15).fill(0)

  constructor() {
    this._resetNodes()
  }

  private _resetNodes(): void {
    this.nodes = FREQUENCY_MAP.map(f => calculatePeakingNode(f, 0))
  }

  /**
   * Updates the equalizer configuration.
   * @param config The filter settings from the client.
   */
  update(config: AudioFilters): void {
    const bands = config.equalizer || []
    
    // Reset to neutral if no bands provided
    if (bands.length === 0) {
      this.activeBands.fill(0)
      this._resetNodes()
      return
    }

    for (const entry of bands) {
      if (entry.band >= 0 && entry.band < 15) {
        this.activeBands[entry.band] = entry.gain
        // Convert Lavalink gain (-0.25 to 1.0) to dB for the filter
        const gainDb = entry.gain * 12 
        this.nodes[entry.band] = calculatePeakingNode(FREQUENCY_MAP[entry.band], gainDb)
      }
    }
  }

  /**
   * Processes a chunk of 16-bit PCM audio data.
   * @param buffer Input PCM buffer (stereo, interleaved)
   */
  process(buffer: Buffer): Buffer {
    // Skip processing if all bands are neutral
    if (this.activeBands.every(g => g === 0)) return buffer

    for (let i = 0; i < buffer.length; i += 4) {
      let left  = buffer.readInt16LE(i)
      let right = buffer.readInt16LE(i + 2)

      for (const node of this.nodes) {
        // Left Channel (Direct Form II)
        const outL = node.b0 * left + node.z1L
        node.z1L = node.b1 * left - node.a1 * outL + node.z2L
        node.z2L = node.b2 * left - node.a2 * outL
        left = outL

        // Right Channel (Direct Form II)
        const outR = node.b0 * right + node.z1R
        node.z1R = node.b1 * right - node.a1 * outR + node.z2R
        node.z2R = node.b2 * right - node.a2 * outR
        right = outR
      }

      // Clamp and write back
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, left)), i)
      buffer.writeInt16LE(Math.max(-32768, Math.min(32767, right)), i + 2)
    }

    return buffer
  }

  /**
   * Clears internal delay buffers.
   */
  flush(): void {
    for (const node of this.nodes) {
      node.z1L = node.z2L = node.z1R = node.z2R = 0
    }
  }
}
