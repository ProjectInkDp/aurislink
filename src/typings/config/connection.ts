export interface ConnectionConfig {
  logAllChecks: boolean
  intervalMs: number
  timeoutMs: number
  thresholds: {
    badMbps: number
    averageMbps: number
  }
  probeUrl: string
}
