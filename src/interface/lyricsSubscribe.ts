// src/api/lyricsSubscribe.ts
// GET /v4/sessions/:sessionId/players/:guildId/lyrics/subscribe
//
// Streams synced lyrics lines to the client via Server-Sent Events (SSE).
// Each event fires when the current playback position crosses a lyric timestamp.
// The stream closes automatically when the track ends or the player is destroyed.
//
// AurisLink-exclusive — inspired by initial research's lyrics subscribe concept,
// but implemented from scratch with a simpler interval-based approach.

import type http from 'node:http'
import { sendError } from './helpers.js'
import { httpGetJson } from '../shared/http.js'
import { decodeTrack } from '../shared/media.js'
import type { SessionManager } from '../engine/SessionManager.js'

interface LrcLibResult {
  syncedLyrics?: string
  plainLyrics?: string
}

interface LyricLine {
  timestamp: number   // ms
  line: string
}

// ─── LRC parser ──────────────────────────────────────────────────────────────

function parseLrc(raw: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const row of raw.split('\n')) {
    const m = /^\[(\d+):(\d+\.\d+)\](.*)$/.exec(row.trim())
    if (!m) continue
    const ms = (parseInt(m[1]!, 10) * 60 + parseFloat(m[2]!)) * 1000
    lines.push({ timestamp: ms, line: m[3]!.trim() })
  }
  return lines.sort((a, b) => a.timestamp - b.timestamp)
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export async function handleLyricsSubscribe(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sessionId: string,
  guildId: string,
  sm: SessionManager,
): Promise<void> {
  const player = sm.getPlayer(sessionId, guildId)
  if (!player) return sendError(res, 404, 'Not Found', 'Player not found')

  const encoded = player.track?.encoded ?? null
  if (!encoded) return sendError(res, 404, 'Not Found', 'No track currently playing')

  let info: ReturnType<typeof decodeTrack>
  try { info = decodeTrack(encoded) } catch {
    return sendError(res, 400, 'Bad Request', 'Could not decode track')
  }

  // Fetch synced lyrics
  const params = new URLSearchParams({ track_name: info.title, artist_name: info.author })
  if (info.length) params.set('duration', String(Math.round(info.length / 1000)))
  const lrclib = await httpGetJson<LrcLibResult>(`https://lrclib.net/api/get?${params}`)

  if (!lrclib?.syncedLyrics) {
    return sendError(res, 404, 'Not Found', 'No synced lyrics available for this track')
  }

  const lines = parseLrc(lrclib.syncedLyrics)
  if (lines.length === 0) {
    return sendError(res, 404, 'Not Found', 'Could not parse synced lyrics')
  }

  // ─── Open SSE stream ──────────────────────────────────────────────────────
  res.writeHead(200, {
    'content-type':  'text/event-stream',
    'cache-control': 'no-cache',
    'connection':    'keep-alive',
    'x-accel-buffering': 'no',   // disable nginx buffering
  })
  res.flushHeaders()

  // Send all lines metadata upfront so clients can pre-render
  res.write(`event: ready\ndata: ${JSON.stringify({ total: lines.length, title: info.title, author: info.author })}\n\n`)

  let lastSentIndex = -1

  const interval = setInterval(() => {
    const currentPlayer = sm.getPlayer(sessionId, guildId)

    // Stop if player gone or track changed
    if (!currentPlayer || currentPlayer.track?.encoded !== encoded) {
      res.write('event: end\ndata: {"reason":"track_changed"}\n\n')
      clearInterval(interval)
      res.end()
      return
    }

    // Calculate current position
    const pos = currentPlayer.paused
      ? currentPlayer.state.position
      : currentPlayer.state.position + (Date.now() - currentPlayer.state.time)

    // Find all lines that should have fired by now
    for (let i = lastSentIndex + 1; i < lines.length; i++) {
      const line = lines[i]!
      if (line.timestamp <= pos) {
        res.write(`event: line\ndata: ${JSON.stringify({ index: i, timestamp: line.timestamp, line: line.line })}\n\n`)
        lastSentIndex = i
      } else {
        break
      }
    }

    // All lines sent
    if (lastSentIndex >= lines.length - 1) {
      res.write('event: end\ndata: {"reason":"completed"}\n\n')
      clearInterval(interval)
      res.end()
    }
  }, 250)

  // Client disconnected
  req.on('close', () => {
    clearInterval(interval)
  })
}
