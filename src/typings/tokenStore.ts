// src/typings/tokenStore.ts

/**
 * Token entry stored inside the AurisLink encrypted token store.
 *
 * @example
 * ```ts
 * const entry: TokenEntry<string> = {
 *   value: 'Bearer eyJhbGci...',
 *   createdAt: Date.now(),
 *   refreshedAt: Date.now(),
 *   expiresAt: Date.now() + 3_600_000
 * }
 * ```
 * @public
 */
export interface TokenEntry<T = unknown> {
  /** Stored token value. */
  value: T

  /** Timestamp (ms) when this entry was first written. */
  createdAt: number

  /** Timestamp (ms) of the last write (set/update). */
  refreshedAt: number

  /** Expiry timestamp (ms), or null when the entry never expires. */
  expiresAt: number | null
}

/**
 * Encrypted payload serialised to disk by the Vault.
 * @public
 */
export interface VaultPayload {
  /** File format version — used for future migration. */
  version: number

  /** Timestamp (ms) when the payload was last written. */
  writtenAt: number

  /** Token entries keyed by their identifier. */
  entries: Record<string, TokenEntry<unknown>>
}

/**
 * Runtime statistics reported by the Vault.
 * @public
 */
export interface VaultStats {
  /** Total number of entries currently held in memory. */
  total: number

  /** Number of entries that are already expired but not yet swept. */
  expired: number

  /** Timestamp (ms) of the last successful disk load. */
  lastLoadedAt?: number

  /** Timestamp (ms) of the last successful disk write. */
  lastWrittenAt?: number
}
