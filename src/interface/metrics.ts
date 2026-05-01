// src/api/metrics.ts
// GET /v4/metrics — Prometheus-compatible plain-text metrics endpoint.
// Inspired by NodeLink's production monitoring approach.

import type http from 'node:http'
import type { SessionManager } from '../engine/SessionManager.js'

const START_TIME = Date.now()

// Measure event loop lag by scheduling a zero-delay timer and seeing
// how long it actually takes — any excess is lag caused by blocking work.
let _eventLoopLagMs = 0
function measureEventLoopLag() {
  const start = process.hrtime.bigint()
  setImmediate(() => {
    const lag = Number(process.hrtime.bigint() - start) / 1_000_000
    _eventLoopLagMs = Math.max(0, lag - 0)
    setTimeout(measureEventLoopLag, 500).unref()
  })
}
measureEventLoopLag()

export function handleMetrics(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  sm: SessionManager,
): void {
  const mem = process.memoryUsage()
  const cpu = process.cpuUsage()
  const uptimeSeconds = process.uptime()

  let totalPlayers = 0
  let playingPlayers = 0
  let totalSessions = 0

  const sessions = sm.getAllSessions()
  totalSessions = sessions.length

  for (const session of sessions) {
    for (const player of session.players.values()) {
      totalPlayers++
      if (player.track && !player.paused) playingPlayers++
    }
  }

  const lines: string[] = [
    // ─── Process memory ────────────────────────────────────────────────
    '# HELP aurislink_memory_rss_bytes Resident Set Size in bytes',
    '# TYPE aurislink_memory_rss_bytes gauge',
    `aurislink_memory_rss_bytes ${mem.rss}`,

    '# HELP aurislink_memory_heap_used_bytes Heap memory currently used in bytes',
    '# TYPE aurislink_memory_heap_used_bytes gauge',
    `aurislink_memory_heap_used_bytes ${mem.heapUsed}`,

    '# HELP aurislink_memory_heap_total_bytes Total heap size allocated in bytes',
    '# TYPE aurislink_memory_heap_total_bytes gauge',
    `aurislink_memory_heap_total_bytes ${mem.heapTotal}`,

    '# HELP aurislink_memory_external_bytes Memory used by C++ objects bound to JS objects',
    '# TYPE aurislink_memory_external_bytes gauge',
    `aurislink_memory_external_bytes ${mem.external}`,

    // ─── CPU ───────────────────────────────────────────────────────────
    '# HELP aurislink_cpu_user_microseconds Total user CPU time used in microseconds',
    '# TYPE aurislink_cpu_user_microseconds counter',
    `aurislink_cpu_user_microseconds ${cpu.user}`,

    '# HELP aurislink_cpu_system_microseconds Total system CPU time used in microseconds',
    '# TYPE aurislink_cpu_system_microseconds counter',
    `aurislink_cpu_system_microseconds ${cpu.system}`,

    // ─── Uptime ────────────────────────────────────────────────────────
    '# HELP aurislink_uptime_seconds Total server uptime in seconds',
    '# TYPE aurislink_uptime_seconds counter',
    `aurislink_uptime_seconds ${uptimeSeconds.toFixed(3)}`,

    '# HELP aurislink_start_time_unix_seconds Unix timestamp when AurisLink started',
    '# TYPE aurislink_start_time_unix_seconds gauge',
    `aurislink_start_time_unix_seconds ${(START_TIME / 1000).toFixed(3)}`,

    // ─── Sessions & players ────────────────────────────────────────────
    '# HELP aurislink_sessions_total Number of active WebSocket sessions',
    '# TYPE aurislink_sessions_total gauge',
    `aurislink_sessions_total ${totalSessions}`,

    '# HELP aurislink_players_total Total number of active players across all sessions',
    '# TYPE aurislink_players_total gauge',
    `aurislink_players_total ${totalPlayers}`,

    '# HELP aurislink_players_playing Number of players currently playing a track',
    '# TYPE aurislink_players_playing gauge',
    `aurislink_players_playing ${playingPlayers}`,

    '# HELP aurislink_players_paused Number of players with a track loaded but paused',
    '# TYPE aurislink_players_paused gauge',
    `aurislink_players_paused ${totalPlayers - playingPlayers}`,

    // ─── Event loop ────────────────────────────────────────────────────
    '# HELP aurislink_event_loop_lag_ms Event loop lag in milliseconds — high values indicate a blocked thread',
    '# TYPE aurislink_event_loop_lag_ms gauge',
    `aurislink_event_loop_lag_ms ${_eventLoopLagMs.toFixed(2)}`,

    // ─── Node.js internals ─────────────────────────────────────────────
    '# HELP aurislink_nodejs_version_info Node.js version info',
    '# TYPE aurislink_nodejs_version_info gauge',
    `aurislink_nodejs_version_info{version="${process.version}",platform="${process.platform}",arch="${process.arch}"} 1`,
    '',
  ]

  res.writeHead(200, {
    'content-type': 'text/plain; version=0.0.4; charset=utf-8',
    'cache-control': 'no-cache, no-store',
  })
  res.end(lines.join('\n'))
}
