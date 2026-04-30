// src/api/dashboard.ts
// GET /v4/dashboard — Visual metrics dashboard with real-time charts.
// Serves an interactive HTML page with live graphs of CPU, memory, players, and cache stats.

import type http from 'node:http'
import type { SessionManager } from '../core/SessionManager.js'

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AurisLink Dashboard</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #1e1e2e 0%, #2d2d44 100%);
      color: #e0e0e0;
      padding: 20px;
      min-height: 100vh;
    }
    .container {
      max-width: 1400px;
      margin: 0 auto;
    }
    header {
      margin-bottom: 30px;
      padding-bottom: 20px;
      border-bottom: 2px solid #404060;
    }
    h1 {
      font-size: 2.5em;
      color: #a78bfa;
      margin-bottom: 10px;
    }
    .status {
      display: flex;
      gap: 20px;
      font-size: 0.95em;
      color: #b0b0c0;
    }
    .status-item {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #10b981;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
      gap: 20px;
      margin-bottom: 20px;
    }
    .card {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      padding: 20px;
      backdrop-filter: blur(10px);
    }
    .card h2 {
      font-size: 1.2em;
      margin-bottom: 15px;
      color: #a78bfa;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      padding-bottom: 10px;
    }
    .stat-row {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    }
    .stat-row:last-child {
      border-bottom: none;
    }
    .stat-label {
      color: #b0b0c0;
      font-size: 0.9em;
    }
    .stat-value {
      color: #10b981;
      font-weight: 600;
      font-family: 'Monaco', 'Courier New', monospace;
    }
    .chart-container {
      position: relative;
      height: 300px;
      margin-top: 15px;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .error {
      background: rgba(239, 68, 68, 0.1);
      border-color: rgba(239, 68, 68, 0.3);
      color: #fca5a5;
    }
    .error-text {
      color: #fca5a5;
      font-size: 0.9em;
    }
    footer {
      text-align: center;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid rgba(255, 255, 255, 0.1);
      color: #707080;
      font-size: 0.85em;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>🎵 AurisLink Dashboard</h1>
      <div class="status">
        <div class="status-item">
          <div class="status-dot"></div>
          <span>Live Monitoring</span>
        </div>
        <div class="status-item">
          <span id="uptime">Uptime: --</span>
        </div>
        <div class="status-item">
          <span id="lastUpdate">Updated: --</span>
        </div>
      </div>
    </header>

    <div class="grid">
      <!-- Memory & CPU -->
      <div class="card">
        <h2>Memory Usage</h2>
        <div class="stat-row">
          <span class="stat-label">Heap Used</span>
          <span class="stat-value" id="heapUsed">-- MB</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Heap Total</span>
          <span class="stat-value" id="heapTotal">-- MB</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">RSS</span>
          <span class="stat-value" id="rss">-- MB</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">External</span>
          <span class="stat-value" id="external">-- MB</span>
        </div>
      </div>

      <!-- CPU & Event Loop -->
      <div class="card">
        <h2>CPU & Performance</h2>
        <div class="stat-row">
          <span class="stat-label">Event Loop Lag</span>
          <span class="stat-value" id="eventLoopLag">-- ms</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">CPU User</span>
          <span class="stat-value" id="cpuUser">-- ms</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">CPU System</span>
          <span class="stat-value" id="cpuSystem">-- ms</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Node.js Version</span>
          <span class="stat-value" id="nodeVersion">--</span>
        </div>
      </div>

      <!-- Players & Sessions -->
      <div class="card">
        <h2>Players & Sessions</h2>
        <div class="stat-row">
          <span class="stat-label">Active Sessions</span>
          <span class="stat-value" id="sessions">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Total Players</span>
          <span class="stat-value" id="totalPlayers">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Playing</span>
          <span class="stat-value" id="playingPlayers">--</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Paused</span>
          <span class="stat-value" id="pausedPlayers">--</span>
        </div>
      </div>

      <!-- Memory Chart -->
      <div class="card">
        <h2>Memory Trend</h2>
        <div class="chart-container">
          <canvas id="memoryChart"></canvas>
        </div>
      </div>

      <!-- CPU Chart -->
      <div class="card">
        <h2>CPU Trend</h2>
        <div class="chart-container">
          <canvas id="cpuChart"></canvas>
        </div>
      </div>

      <!-- Players Chart -->
      <div class="card">
        <h2>Players Trend</h2>
        <div class="chart-container">
          <canvas id="playersChart"></canvas>
        </div>
      </div>
    </div>

    <footer>
      <p>AurisLink Dashboard • Real-time metrics • Updates every 2 seconds</p>
    </footer>
  </div>

  <script>
    const MAX_POINTS = 60; // Keep last 2 minutes of data
    const UPDATE_INTERVAL = 2000; // 2 seconds

    const data = {
      timestamps: [],
      memory: [],
      cpu: [],
      players: [],
    };

    // Initialize charts
    const chartConfig = {
      type: 'line',
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#b0b0c0' } } },
        scales: {
          y: { ticks: { color: '#b0b0c0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          x: { ticks: { color: '#b0b0c0' }, grid: { color: 'rgba(255,255,255,0.05)' } },
        },
      },
    };

    const memoryChart = new Chart(document.getElementById('memoryChart'), {
      ...chartConfig,
      data: {
        labels: data.timestamps,
        datasets: [
          { label: 'Heap Used (MB)', data: data.memory, borderColor: '#f59e0b', tension: 0.4 },
        ],
      },
    });

    const cpuChart = new Chart(document.getElementById('cpuChart'), {
      ...chartConfig,
      data: {
        labels: data.timestamps,
        datasets: [
          { label: 'Event Loop Lag (ms)', data: data.cpu, borderColor: '#ef4444', tension: 0.4 },
        ],
      },
    });

    const playersChart = new Chart(document.getElementById('playersChart'), {
      ...chartConfig,
      data: {
        labels: data.timestamps,
        datasets: [
          { label: 'Playing', data: data.players, borderColor: '#10b981', tension: 0.4 },
        ],
      },
    });

    async function fetchMetrics() {
      try {
        const [statsRes, metricsRes] = await Promise.all([
          fetch('/v4/stats', { headers: { 'Authorization': localStorage.getItem('aurislink-auth') || '' } }),
          fetch('/v4/metrics'),
        ]);

        if (!statsRes.ok || !metricsRes.ok) throw new Error('Failed to fetch metrics');

        const stats = await statsRes.json();
        const metricsText = await metricsRes.text();

        // Parse Prometheus metrics
        const metrics = {};
        metricsText.split('\\n').forEach(line => {
          if (!line.startsWith('#') && line.trim()) {
            const [key, value] = line.split(' ');
            if (key && value) metrics[key] = parseFloat(value);
          }
        });

        // Update UI
        const heapUsedMB = (stats.memory.used / 1024 / 1024).toFixed(1);
        const heapTotalMB = (stats.memory.allocated / 1024 / 1024).toFixed(1);
        const rssMB = (stats.memory.reservable / 1024 / 1024).toFixed(1);
        const externalMB = (stats.memory.external / 1024 / 1024).toFixed(1);

        document.getElementById('heapUsed').textContent = heapUsedMB + ' MB';
        document.getElementById('heapTotal').textContent = heapTotalMB + ' MB';
        document.getElementById('rss').textContent = rssMB + ' MB';
        document.getElementById('external').textContent = externalMB + ' MB';
        document.getElementById('eventLoopLag').textContent = metrics.aurislink_event_loop_lag_ms?.toFixed(2) + ' ms' || '--';
        document.getElementById('cpuUser').textContent = (metrics.aurislink_cpu_user_microseconds / 1000).toFixed(0) + ' ms' || '--';
        document.getElementById('cpuSystem').textContent = (metrics.aurislink_cpu_system_microseconds / 1000).toFixed(0) + ' ms' || '--';
        document.getElementById('nodeVersion').textContent = stats.node.version || '--';
        document.getElementById('sessions').textContent = metrics.aurislink_sessions_total || '--';
        document.getElementById('totalPlayers').textContent = metrics.aurislink_players_total || '--';
        document.getElementById('playingPlayers').textContent = metrics.aurislink_players_playing || '--';
        document.getElementById('pausedPlayers').textContent = metrics.aurislink_players_paused || '--';
        document.getElementById('uptime').textContent = 'Uptime: ' + formatUptime(stats.uptime);
        document.getElementById('lastUpdate').textContent = 'Updated: ' + new Date().toLocaleTimeString();

        // Update charts
        const now = new Date().toLocaleTimeString();
        data.timestamps.push(now);
        data.memory.push(parseFloat(heapUsedMB));
        data.cpu.push(metrics.aurislink_event_loop_lag_ms || 0);
        data.players.push(metrics.aurislink_players_playing || 0);

        if (data.timestamps.length > MAX_POINTS) {
          data.timestamps.shift();
          data.memory.shift();
          data.cpu.shift();
          data.players.shift();
        }

        memoryChart.update('none');
        cpuChart.update('none');
        playersChart.update('none');
      } catch (err) {
        console.error('Failed to fetch metrics:', err);
      }
    }

    function formatUptime(ms) {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);
      if (days > 0) return days + 'd ' + (hours % 24) + 'h';
      if (hours > 0) return hours + 'h ' + (minutes % 60) + 'm';
      if (minutes > 0) return minutes + 'm ' + (seconds % 60) + 's';
      return seconds + 's';
    }

    // Fetch metrics immediately and then every 2 seconds
    fetchMetrics();
    setInterval(fetchMetrics, UPDATE_INTERVAL);
  </script>
</body>
</html>
`

export function handleDashboard(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): void {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache, no-store',
  })
  res.end(DASHBOARD_HTML)
}
