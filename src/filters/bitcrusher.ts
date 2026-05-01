// src/filters/bitcrusher.ts
// AurisLink Exclusive Bitcrusher Filter
// Reduces audio fidelity by reducing bit depth and sample rate for a Lo-Fi effect.

export interface BitcrusherConfig {
  bits?: number      // Target bit depth (e.g., 8, 4, 2)
  downsample?: number // Downsampling factor (e.g., 2, 4, 8)
}

export class Bitcrusher {
  private bits = 16
  private downsample = 1
  private stepCount = 0
  private lastL = 0
  private lastR = 0

  /**
   * Updates the bitcrusher configuration.
   */
  update(config: BitcrusherConfig): void {
    this.bits = config.bits ?? 16
    this.downsample = Math.max(1, config.downsample ?? 1)
  }

  /**
   * Processes a chunk of 16-bit PCM audio data.
   */
  process(buffer: Buffer): Buffer {
    if (this.bits >= 16 && this.downsample <= 1) return buffer

    const step = Math.pow(2, 16 - this.bits)

    for (let i = 0; i < buffer.length; i += 4) {
      this.stepCount++

      if (this.stepCount >= this.downsample) {
        let left  = buffer.readInt16LE(i)
        let right = buffer.readInt16LE(i + 2)

        // Bit depth reduction
        left  = Math.round(left / step) * step
        right = Math.round(right / step) * step

        this.lastL = left
        this.lastR = right
        this.stepCount = 0
      }

      buffer.writeInt16LE(this.lastL, i)
      buffer.writeInt16LE(this.lastR, i + 2)
    }

    return buffer
  }
}
