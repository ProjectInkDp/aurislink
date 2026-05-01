// src/core/ConnectionMonitor.ts
// Periodically probes outbound connectivity and logs the result.
// Inspired by NodeLink's connection health check — adapted for AurisLink's
// single-process TypeScript architecture (no cluster overhead here).

import http  from 'node:http'
import https from 'node:https'
import type { ConnectionConfig } from '../typings/index.js'
import { log } from '../shared/reporter.js'

const DEFAULT_PROBE_URL     = 'https://speed.cloudflare.com/__down?bytes=1000000'
const DEFAULT_INTERVAL_MS   = 300_000   // 5 min
const DEFAULT_TIMEOUT_MS    = 10_000    // 10 s
const DEFAULT_BAD_MBPS      = 1
const DEFAULT_AVERAGE_MBPS  = 5

// ─── Helpers ─────────────────────────────────────────────────────────────────

function bytesToMbps(bytes: number, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0
  return (bytes * 8) / (elapsedMs / 1000) / 1_000_000
}

function resolveRequest(url: string, timeoutMs: number): Promise<{ bytes: number; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    const parsed   = new URL(url)
    const driver   = parsed.protocol === 'https:' ? https : http
    const start    = Date.now()
    let   received = 0

    const req = driver.get(url, { timeout: timeoutMs }, (res) => {
      res.on('data', (chunk: Buffer) => { received += chunk.length })
      res.on('end',  () => resolve({ bytes: received, elapsedMs: Date.now() - start }))
      res.on('error', reject)
    })

    req.on('timeout', () => { req.destroy(); reject(new Error('Connection probe timed out')) })
    req.on('error',   reject)
  })
}

// ─── ConnectionMonitor ────────────────────────────────────────────────────────

export class ConnectionMonitor {
  private readonly probeUrl:      string
  private readonly intervalMs:    number
  private readonly timeoutMs:     number
  private readonly badMbps:       number
  private readonly averageMbps:   number
  private readonly logAllChecks:  boolean

  private timer: ReturnType<typeof setInterval> | null = null

  constructor(cfg?: ConnectionConfig) {
    this.probeUrl     = cfg?.probeUrl                    ?? DEFAULT_PROBE_URL
    this.intervalMs   = cfg?.intervalMs                  ?? DEFAULT_INTERVAL_MS
    this.timeoutMs    = cfg?.timeoutMs                   ?? DEFAULT_TIMEOUT_MS
    this.badMbps      = cfg?.thresholds?.badMbps         ?? DEFAULT_BAD_MBPS
    this.averageMbps  = cfg?.thresholds?.averageMbps     ?? DEFAULT_AVERAGE_MBPS
    this.logAllChecks = cfg?.logAllChecks                ?? false
  }

  /** Start the recurring probe. Runs immediately on first call. */
  start(): void {
    if (this.timer) return   // already running

    const probe = () => this._probe().catch(err => {
      log('warn', 'ConnectionMonitor', `Probe error: ${err instanceof Error ? err.message : String(err)}`)
    })

    // Fire once right away, then on interval
    probe()
    this.timer = setInterval(probe, this.intervalMs)
    this.timer.unref()   // don't keep the process alive just for monitoring

    log('debug', 'ConnectionMonitor', `Started — probe every ${this.intervalMs / 1000}s → ${this.probeUrl}`)
  }

  /** Stop the recurring probe. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
      log('debug', 'ConnectionMonitor', 'Stopped')
    }
  }

  private async _probe(): Promise<void> {
    let bytes: number
    let elapsedMs: number

    try {
      ;({ bytes, elapsedMs } = await resolveRequest(this.probeUrl, this.timeoutMs))
    } catch (err) {
      log('warn', 'ConnectionMonitor', `Probe failed — ${err instanceof Error ? err.message : String(err)}`)
      return
    }

    const mbps = bytesToMbps(bytes, elapsedMs)
    const speed = `${mbps.toFixed(2)} Mbps (${(elapsedMs / 1000).toFixed(2)}s, ${(bytes / 1024).toFixed(0)} KB)`

    if (mbps < this.badMbps) {
      log('warn', 'ConnectionMonitor', `Connection BAD — ${speed}`)
    } else if (mbps < this.averageMbps) {
      log('info', 'ConnectionMonitor', `Connection AVERAGE — ${speed}`)
    } else if (this.logAllChecks) {
      log('debug', 'ConnectionMonitor', `Connection OK — ${speed}`)
    }
  }
}
