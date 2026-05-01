// src/api/dashboard.ts
// GET /v4/dashboard — Visual metrics dashboard with real-time charts.
// Serves an interactive HTML page with live graphs of CPU, memory, players, and cache stats.

import type http from 'node:http'
import type { SessionManager } from '../engine/SessionManager.js'

export function handleDashboard(req: http.IncomingMessage, res: http.ServerResponse, sm: SessionManager) {
  const sessions = sm.listActive()
  let totalPlayers = 0
  let activePlayers = 0

  for (const s of sessions) {
    for (const p of s.registry.values()) {
      totalPlayers++
      if (p.track && !p.paused) activePlayers++
    }
  }

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AurisLink Dashboard</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f0f0f; color: #e0e0e0; margin: 0; padding: 20px; }
        .container { max-width: 1000px; margin: auto; }
        .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #333; padding-bottom: 10px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 20px; margin-top: 20px; }
        .card { background: #1a1a1a; padding: 20px; border-radius: 8px; border: 1px solid #333; text-align: center; }
        .card h2 { margin: 0; color: #00cfc1; font-size: 2em; }
        .card p { margin: 5px 0 0; color: #888; text-transform: uppercase; font-size: 0.8em; }
        .player-list { margin-top: 30px; }
        table { width: 100%; border-collapse: collapse; margin-top: 10px; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid #222; }
        th { color: #888; font-weight: normal; }
        .status-active { color: #00cfc1; }
        .status-idle { color: #ff4d4d; }
        .badge { background: #333; padding: 2px 8px; border-radius: 4px; font-size: 0.8em; color: #aaa; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>AurisLink <small style="font-size: 0.5em; color: #555;">v1.8.0</small></h1>
            <div id="uptime">Uptime: ${Math.floor(process.uptime() / 60)}m</div>
        </div>
        
        <div class="stats">
            <div class="card">
                <h2>${sessions.length}</h2>
                <p>Active Sessions</p>
            </div>
            <div class="card">
                <h2>${totalPlayers}</h2>
                <p>Total Players</p>
            </div>
            <div class="card">
                <h2>${activePlayers}</h2>
                <p>Playing Now</p>
            </div>
            <div class="card">
                <h2>${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB</h2>
                <p>Memory Usage</p>
            </div>
        </div>

        <div class="player-list">
            <h3>Active Players</h3>
            <table>
                <thead>
                    <tr>
                        <th>Guild ID</th>
                        <th>Status</th>
                        <th>Track</th>
                        <th>Source</th>
                        <th>Position</th>
                    </tr>
                </thead>
                <tbody>
                    ${sessions.flatMap(s => Array.from(s.registry.values())).map(p => `
                        <tr>
                            <td>${p.guildId}</td>
                            <td class="${p.track && !p.paused ? 'status-active' : 'status-idle'}">
                                ${p.track && !p.paused ? 'Playing' : 'Paused/Idle'}
                            </td>
                            <td>${p.track?.info.title || 'None'}</td>
                            <td><span class="badge">${p.track?.info.sourceName || 'N/A'}</span></td>
                            <td>${Math.floor(sm.computePosition(p) / 1000)}s</td>
                        </tr>
                    `).join('') || '<tr><td colspan="5" style="text-align:center; color:#555;">No active players</td></tr>'}
                </tbody>
            </table>
        </div>
    </div>
</body>
</html>
  `

  res.writeHead(200, { 'Content-Type': 'text/html' })
  res.end(html)
}
