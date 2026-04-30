export interface ClusterConfig {
  enabled: boolean
  workers: number
  commandTimeoutMs: number
  fastCommandTimeoutMs: number
  hibernation: {
    enabled: boolean
    timeoutMs: number
  }
}
