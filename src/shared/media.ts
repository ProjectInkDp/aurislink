// src/utils/media.ts
// Lavalink v4 track encoding / decoding.
// Wire format (big-endian):
//   4 bytes  – flags (upper 2 bits) + payload length (lower 30 bits)
//   1 byte   – version (always 3)
//   utf8     – title
//   utf8     – author
//   8 bytes  – length (ms, Int64)
//   utf8     – identifier
//   1 byte   – isStream  (0 | 1)
//   1 byte   – hasUri
//   [utf8]   – uri  (if hasUri)
//   1 byte   – hasArtwork
//   [utf8]   – artworkUrl (if hasArtwork)
//   1 byte   – hasIsrc
//   [utf8]   – isrc (if hasIsrc)
//   utf8     – sourceName
//   8 bytes  – position (ms, Int64)

import type { TrackInfo } from '../typings/index.js'

const VERSION = 3
const FLAG_VERSION_ENCODED = 1

// ─── Encode ──────────────────────────────────────────────────────────────────

function writeString(buf: number[], str: string) {
  const encoded = Buffer.from(str, 'utf8')
  // 2-byte length prefix (big-endian)
  buf.push((encoded.length >> 8) & 0xff, encoded.length & 0xff)
  for (const b of encoded) buf.push(b)
}

function writeBool(buf: number[], v: boolean) {
  buf.push(v ? 1 : 0)
}

function writeLong(buf: number[], v: number) {
  // JS only has 53-bit safe integers; BigInt for correctness
  const big = BigInt(Math.round(v))
  for (let i = 7; i >= 0; i--) {
    buf.push(Number((big >> BigInt(i * 8)) & 0xffn))
  }
}

export function encodeTrack(info: TrackInfo): string {
  const payload: number[] = []

  payload.push(VERSION)
  writeString(payload, info.title)
  writeString(payload, info.author)
  writeLong(payload, info.length)
  writeString(payload, info.identifier)
  writeBool(payload, info.isStream)

  writeBool(payload, info.uri !== null)
  if (info.uri !== null) writeString(payload, info.uri)

  writeBool(payload, info.artworkUrl !== null)
  if (info.artworkUrl !== null) writeString(payload, info.artworkUrl)

  writeBool(payload, info.isrc !== null)
  if (info.isrc !== null) writeString(payload, info.isrc)

  writeString(payload, info.sourceName)
  writeLong(payload, info.position)

  const payloadBuf = Buffer.from(payload)
  const flags = (FLAG_VERSION_ENCODED << 30) | payloadBuf.length
  const header = Buffer.alloc(4)
  header.writeUInt32BE(flags >>> 0, 0)

  return Buffer.concat([header, payloadBuf]).toString('base64')
}

// ─── Decode ──────────────────────────────────────────────────────────────────

class Reader {
  private pos = 0
  constructor(private buf: Buffer) {}

  readByte(): number {
    return this.buf[this.pos++]!
  }

  readBool(): boolean {
    return this.readByte() === 1
  }

  readString(): string {
    const len = (this.readByte() << 8) | this.readByte()
    const str = this.buf.subarray(this.pos, this.pos + len).toString('utf8')
    this.pos += len
    return str
  }

  readLong(): number {
    let big = 0n
    for (let i = 0; i < 8; i++) {
      big = (big << 8n) | BigInt(this.readByte())
    }
    return Number(big)
  }

  readOptionalString(): string | null {
    return this.readBool() ? this.readString() : null
  }
}

export function decodeTrack(encoded: string): TrackInfo {
  const full = Buffer.from(encoded, 'base64')
  const flags = full.readUInt32BE(0)
  const length = flags & 0x3fffffff
  const payload = full.subarray(4, 4 + length)

  const r = new Reader(payload)
  const version = r.readByte()

  if (version !== VERSION) {
    throw new Error(`Unsupported track version: ${version}`)
  }

  return {
    title:      r.readString(),
    author:     r.readString(),
    length:     r.readLong(),
    identifier: r.readString(),
    isStream:   r.readBool(),
    uri:        r.readOptionalString(),
    artworkUrl: r.readOptionalString(),
    isrc:       r.readOptionalString(),
    sourceName: r.readString(),
    position:   r.readLong(),
    isSeekable: true, // set by source after decode if needed
  }
}
