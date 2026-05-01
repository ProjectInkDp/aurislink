export interface GuardThresholds {
  burstRequests: number
  timeWindowMs:  number
  warnRatio?:    number
  maxEntries?:   number
}

export interface GuardMitigation {
  delayMs:             number
  blockDurationMs:     number
  backoffMultiplier?:  number
  maxBlockDurationMs?: number
}

export interface AurisDosConfig {
  enabled:    boolean
  thresholds: GuardThresholds
  mitigation: GuardMitigation
  ignore?: {
    userIds?:  string[]
    guildIds?: string[]
    ips?:      string[]
    paths?:    string[]
  }
  trustProxy?: boolean
}

export interface GuardEntry {
  count:        number
  lastReset:    number
  lastSeen:     number
  blockedUntil: number
  strikes:      number
}

export interface ApiGuardResult {
  allowed: boolean
  status?:  number
  message?: string
  delay?:   number
}

export interface ApiRequest {
  url?:    string
  socket?: { remoteAddress?: string }
  headers: Record<string, string | string[] | undefined>
}
