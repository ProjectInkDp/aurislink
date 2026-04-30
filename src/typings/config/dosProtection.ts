export interface DosProtectionThresholds {
  burstRequests: number
  timeWindowMs:  number
  warnRatio?:    number
  maxEntries?:   number
}

export interface DosProtectionMitigation {
  delayMs:             number
  blockDurationMs:     number
  backoffMultiplier?:  number
  maxBlockDurationMs?: number
}

export interface AurisDosConfig {
  enabled:    boolean
  thresholds: DosProtectionThresholds
  mitigation: DosProtectionMitigation
  ignore?: {
    userIds?:  string[]
    guildIds?: string[]
    ips?:      string[]
    paths?:    string[]
  }
  trustProxy?: boolean
}

export interface DosProtectionEntry {
  count:        number
  lastReset:    number
  lastSeen:     number
  blockedUntil: number
  strikes:      number
}

export interface ApiDosProtectionResult {
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
