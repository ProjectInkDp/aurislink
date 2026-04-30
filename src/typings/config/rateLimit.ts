export interface AurisRateLimitScopeConfig {
  maxRequests: number
  windowMs: number
}

export interface AurisRateLimitConfig {
  enabled: boolean
  trustProxy: boolean
  maxEntries: number
  global: AurisRateLimitScopeConfig
  perIp: AurisRateLimitScopeConfig
  perUserId: AurisRateLimitScopeConfig
  perGuildId: AurisRateLimitScopeConfig
  ignorePaths: string[]
}

export interface AurisRateLimitResult {
  allowed: boolean
  limit?: number
  remaining?: number
  reset?: number
  scope?: AurisRateLimitScope
}

export type AurisRateLimitScope = 'global' | 'ip' | 'user' | 'guild'
