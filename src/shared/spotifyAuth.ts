// src/utils/spotifyAuth.ts
// AurisLink Spotify token manager.
// Supports three auth tiers:
//   1. OAuth2 clientId + clientSecret
//   2. Anonymous Web Player TOTP (default)
//   3. Mobile Web Player with sp_dc cookie

import crypto from 'node:crypto'
import { httpGet, httpGetJson } from './http.js'
import { log } from './reporter.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SpotifyTokenResponse {
  accessToken: string
  accessTokenExpirationTimestampMs: number
  clientId?: string
}

export interface SpotifyServerTimeResponse {
  serverTime: number
}

export type SpotifyTokenTier = 'official' | 'anonymous' | 'mobile'

// ─── Hardcoded TOTP secrets used as primary or fallback ──────────────────────

interface EncodedSecret { secret: string; version: number }

const ENCODED_SECRETS: EncodedSecret[] = [
  { secret: ',7/*F("rLJ2oxaKL^f+E1xvP@N', version: 61 },
  { secret: 'OmE{ZA.J^":0FG\\Uz?[@WW',    version: 60 },
  { secret: '{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH', version: 59 },
]

// Currently active TOTP secret (hex).
let currentTotpSecret: string | null = null

// Version string matching the active TOTP secret.
let currentTotpVersion: string | null = null

// Timestamp of last successful remote secret fetch.
let lastSecretFetchTime = 0

// How often to re-fetch secrets from remote (1 hour).
const SECRET_FETCH_INTERVAL = 60 * 60 * 1000

// Remote URL for updated TOTP secret dictionary.
const SECRETS_URL = 'https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json'

// User-Agent sent to Spotify web endpoints.
const AURIS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'

// ─── Auth config (set via configureSpotifyAuth) ───────────────────────────────

let _clientId     = ''
let _clientSecret = ''
let _customEndpoint = ''
let _preferAnonymous = true
let _spDc = ''

export function configureSpotifyAuth(opts: {
  clientId?: string
  clientSecret?: string
  customTokenEndpoint?: string
  preferAnonymousToken?: boolean
  sp_dc?: string
}): void {
  _clientId        = opts.clientId        ?? ''
  _clientSecret    = opts.clientSecret    ?? ''
  _customEndpoint  = opts.customTokenEndpoint ?? ''
  _preferAnonymous = opts.preferAnonymousToken ?? true
  _spDc            = opts.sp_dc ?? ''
}

// ─── Token cache ──────────────────────────────────────────────────────────────

interface CachedToken {
  accessToken:  string
  expiresAt:    number
  clientId?:    string
}

const _cache = new Map<SpotifyTokenTier, CachedToken>()
const _locks = new Map<SpotifyTokenTier, Promise<boolean>>()

const RATE_MARGIN = 300_000

export async function getSpotifyToken(): Promise<CachedToken> {
  const tier: SpotifyTokenTier = (!_preferAnonymous && _clientId && _clientSecret)
    ? 'official'
    : 'anonymous'
  await _ensureTier(tier)
  const cached = _cache.get(tier)
  if (!cached) throw new Error('No Spotify token available')
  return cached
}

export async function getMobileToken(): Promise<CachedToken | null> {
  if (!_spDc) return null
  await _ensureTier('mobile')
  return _cache.get('mobile') ?? null
}

async function _ensureTier(tier: SpotifyTokenTier): Promise<boolean> {
  const cached = _cache.get(tier)
  if (cached && Date.now() < cached.expiresAt - RATE_MARGIN) return true

  const inflight = _locks.get(tier)
  if (inflight) return inflight

  const p = _refreshTier(tier)
  _locks.set(tier, p)
  try { return await p } finally { _locks.delete(tier) }
}

async function _refreshTier(tier: SpotifyTokenTier): Promise<boolean> {
  try {
    if (tier === 'official') return await _fetchOAuth2Token()
    if (tier === 'mobile')   return await _fetchMobileToken()
    return await _fetchAnonymousToken()
  } catch (err) {
    log('error', 'SpotifyAuth', `Refresh failed (${tier}): ${err}`)
    return false
  }
}

// ─── OAuth2 (clientId + clientSecret) ────────────────────────────────────────

async function _fetchOAuth2Token(): Promise<boolean> {
  const credentials = Buffer.from(`${_clientId}:${_clientSecret}`).toString('base64')
  const res = await httpGet('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  })
  if (!res || res.status !== 200) return false
  const data = JSON.parse(res.body) as { access_token: string; expires_in: number }
  if (!data.access_token) return false
  _cache.set('official', {
    accessToken: data.access_token,
    expiresAt:   Date.now() + data.expires_in * 1000,
    clientId:    _clientId,
  })
  log('info', 'SpotifyAuth', 'OAuth2 token acquired')
  return true
}

// ─── Anonymous TOTP ───────────────────────────────────────────────────────────

async function _fetchAnonymousToken(): Promise<boolean> {
  // Custom endpoint
  if (_customEndpoint) {
    try {
      const data = await httpGetJson<SpotifyTokenResponse>(_customEndpoint)
      if (data?.accessToken) {
        _cache.set('anonymous', {
          accessToken: data.accessToken,
          expiresAt:   data.accessTokenExpirationTimestampMs ?? (Date.now() + 3_600_000),
          clientId:    data.clientId,
        })
        log('info', 'SpotifyAuth', 'Token acquired via custom endpoint')
        return true
      }
    } catch (err) {
      log('warn', 'SpotifyAuth', `Custom endpoint failed: ${err} — falling back to TOTP`)
    }
  }

  // TOTP anonymous
  const data = await getAurisLocalToken(null, 'web-player')
  if (!data?.accessToken) return false
  _cache.set('anonymous', {
    accessToken: data.accessToken,
    expiresAt:   data.accessTokenExpirationTimestampMs ?? (Date.now() + 3_600_000),
    clientId:    data.clientId,
  })
  log('info', 'SpotifyAuth', 'Anonymous token acquired')
  return true
}

// ─── Mobile TOTP (sp_dc) ─────────────────────────────────────────────────────

async function _fetchMobileToken(): Promise<boolean> {
  if (!_spDc) return false
  const data = await getAurisLocalToken(_spDc, 'mobile-web-player')
  if (!data?.accessToken) return false
  _cache.set('mobile', {
    accessToken: data.accessToken,
    expiresAt:   data.accessTokenExpirationTimestampMs ?? (Date.now() + 3_600_000),
    clientId:    data.clientId,
  })
  log('info', 'SpotifyAuth', 'Mobile token acquired (sp_dc)')
  return true
}

// ─── TOTP core ────────────────────────────────────────────────────────────────

// Decodes an obfuscated TOTP secret into raw bytes.
function _decodeSecret(encoded: string): Buffer {
  const bytes = encoded.split('').map((c, i) => c.charCodeAt(0) ^ ((i % 33) + 9))
  return Buffer.from(Buffer.from(bytes.join(''), 'utf8').toString('hex'), 'hex')
}

// Ensures the TOTP secret cache is fresh, falling back to hardcoded values.
async function _ensureSecret(): Promise<void> {
  const now = Date.now()
  if (currentTotpSecret && now - lastSecretFetchTime < SECRET_FETCH_INTERVAL) return

  try {
    const secrets = await httpGetJson<Record<string, number[]>>(SECRETS_URL)
    if (!secrets) throw new Error('Empty response')

    const latest = String(Math.max(...Object.keys(secrets).map(Number)))
    const raw = secrets[latest]!
    const mapped = raw.map((v, i) => v ^ ((i % 33) + 9))
    currentTotpSecret = Buffer.from(mapped.join(''), 'utf8').toString('hex')
    currentTotpVersion = latest
    lastSecretFetchTime = now
    log('debug', 'SpotifyAuth', `TOTP secret refreshed — version ${latest}`)
  } catch (err) {
    log('warn', 'SpotifyAuth', `Secret fetch failed: ${err} — using fallback`)
    if (!currentTotpSecret) {
      const fb = ENCODED_SECRETS[0]!
      currentTotpSecret = _decodeSecret(fb.secret).toString('hex')
      currentTotpVersion = String(fb.version)
    }
  }
}

// Fetches Spotify server time for TOTP sync.
// Falls back to local time if unavailable.
async function _getServerTime(spDc?: string | null): Promise<number> {
  try {
    const headers: Record<string, string> = { 'User-Agent': AURIS_UA }
    if (spDc) headers.Cookie = `sp_dc=${spDc}`
    const res = await httpGet('https://open.spotify.com/api/server-time', { headers })
    if (!res || res.status !== 200) throw new Error('bad status')
    const data = JSON.parse(res.body) as SpotifyServerTimeResponse
    return typeof data.serverTime === 'number' ? data.serverTime : Date.now()
  } catch {
    return Date.now()
  }
}

// Generates a 6-digit TOTP code.
function _generateTOTP(secretHex: string, timestampMs: number, step = 30): string {
  const counter = Math.floor(timestampMs / 1000 / step)
  const buf = Buffer.alloc(8)
  buf.writeBigInt64BE(BigInt(counter))
  const hmac = crypto.createHmac('sha1', Buffer.from(secretHex, 'hex'))
  hmac.update(buf)
  const digest = hmac.digest()
  const offset = (digest[digest.length - 1] ?? 0) & 0xf
  const code =
    ((((digest[offset]     ?? 0) & 0x7f) << 24) |
     (((digest[offset + 1] ?? 0) & 0xff) << 16) |
     (((digest[offset + 2] ?? 0) & 0xff) << 8)  |
      ((digest[offset + 3] ?? 0) & 0xff)) % 1_000_000
  return code.toString().padStart(6, '0')
}

// Acquires a Spotify token via TOTP (anonymous or sp_dc).
export async function getAurisLocalToken(
  spDc?: string | null,
  productType = 'mobile-web-player'
): Promise<SpotifyTokenResponse> {
  // Try primary hardcoded secret first, then remote
  try {
    const fb = ENCODED_SECRETS[0]!
    const secret  = _decodeSecret(fb.secret).toString('hex')
    const version = String(fb.version)
    return await _performTokenRequest(secret, version, spDc, productType)
  } catch {
    await _ensureSecret()
    if (!currentTotpSecret) throw new Error('No TOTP secret available')
    return await _performTokenRequest(currentTotpSecret, currentTotpVersion ?? '19', spDc, productType)
  }
}

// Sends a token request to Spotify using TOTP.
async function _performTokenRequest(
  secret: string,
  version: string,
  spDc: string | null | undefined,
  productType: string
): Promise<SpotifyTokenResponse> {
  const isWebPlayer = productType === 'web-player'
  const serverTimeMs = isWebPlayer ? Date.now() : await _getServerTime(spDc)
  const localTimeMs  = Date.now()

  const totpLocal  = _generateTOTP(secret, localTimeMs, 30)
  const totpServer = _generateTOTP(secret, serverTimeMs, 900)

  const url = new URL('https://open.spotify.com/api/token')
  url.searchParams.append('reason', 'init')
  url.searchParams.append('productType', productType)
  if (!isWebPlayer) url.searchParams.append('platform', 'web')
  url.searchParams.append('totp', totpLocal)
  url.searchParams.append('totpServer', isWebPlayer ? totpLocal : totpServer)
  url.searchParams.append('totpVer', version)

  const headers: Record<string, string> = {
    'User-Agent': AURIS_UA,
    'Origin':     'https://open.spotify.com/',
    'Referer':    'https://open.spotify.com/',
    'Accept':     'application/json',
  }
  if (spDc && !isWebPlayer) headers.Cookie = `sp_dc=${spDc}`

  const res = await httpGet(url.toString(), { headers })
  if (!res || res.status !== 200) throw new Error(`Spotify token HTTP ${res?.status}`)
  return JSON.parse(res.body) as SpotifyTokenResponse
}
