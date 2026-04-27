// src/utils/http.ts
// HTTP/1.1-only client using Node's native http/https modules.
// Mirrors NodeLink's approach: real browser User-Agent, br/gzip decompression,
// redirect following, and no HTTP/2 — which SoundCloud requires for scraping.

import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { log } from './logger.js'

export interface HttpResponse {
  status:  number
  headers: Record<string, string | string[] | undefined>
  body:    string
}

export interface HttpOptions {
  method?:          string
  headers?:         Record<string, string>
  body?:            string | Buffer
  timeout?:         number
  followRedirects?: boolean
  maxRedirects?:    number
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const DEFAULT_TIMEOUT = 15_000
const DEFAULT_MAX_REDIRECTS = 5

const keepAliveHttps = new https.Agent({ keepAlive: true })
const keepAliveHttp = new http.Agent({ keepAlive: true })

function decompress(res: http.IncomingMessage): NodeJS.ReadableStream {
  const enc = (res.headers['content-encoding'] ?? '').toLowerCase()
  if (enc === 'br')      return res.pipe(zlib.createBrotliDecompress())
  if (enc === 'gzip')    return res.pipe(zlib.createGunzip())
  if (enc === 'deflate') return res.pipe(zlib.createInflate())
  return res
}

function collectBody(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (c: Buffer) => chunks.push(c))
    stream.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')))
    stream.on('error', reject)
  })
}

export function httpGet(url: string, opts: HttpOptions = {}, _redirects = 0): Promise<HttpResponse | null> {
  return new Promise(resolve => {
    const {
      method = 'GET',
      headers = {},
      body,
      timeout = DEFAULT_TIMEOUT,
      followRedirects = true,
      maxRedirects = DEFAULT_MAX_REDIRECTS,
    } = opts

    let parsed: URL
    try { parsed = new URL(url) } catch {
      log('warn', 'HTTP', `Invalid URL: ${url}`)
      resolve(null)
      return
    }

    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http
    const agent = isHttps ? keepAliveHttps : keepAliveHttp

    const req = lib.request({
      method,
      hostname: parsed.hostname,
      port:     parsed.port || (isHttps ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      headers:  { 'accept-encoding': 'br, gzip, deflate', 'user-agent': UA, ...headers },
      agent,
      timeout,
    }, res => {
      const { statusCode = 0, headers: resHeaders } = res
      const location = Array.isArray(resHeaders.location) ? resHeaders.location[0] : resHeaders.location

      if (followRedirects && location && [301, 302, 303, 307, 308].includes(statusCode)) {
        if (_redirects >= maxRedirects) { res.resume(); resolve(null); return }
        res.resume()
        resolve(httpGet(new URL(location, url).href, opts, _redirects + 1))
        return
      }

      const stream = decompress(res)
      collectBody(stream)
        .then(body => resolve({ status: statusCode, headers: resHeaders as HttpResponse['headers'], body }))
        .catch(() => resolve(null))
    })

    req.on('timeout', () => { req.destroy(); log('warn', 'HTTP', `Timeout: ${url}`); resolve(null) })
    req.on('error',   err => { log('warn', 'HTTP', `${url} → ${err.message}`); resolve(null) })
    if (body) req.write(body)
    req.end()
  })
}

export async function httpGetJson<T = unknown>(url: string, opts: HttpOptions = {}): Promise<T | null> {
  const res = await httpGet(url, { headers: { accept: 'application/json' }, ...opts })
  if (!res || res.status >= 400) return null
  try { return JSON.parse(res.body) as T }
  catch { log('warn', 'HTTP', `JSON parse failed: ${url}`); return null }
}

export function httpStream(url: string, opts: HttpOptions = {}): Promise<http.IncomingMessage | null> {
  return new Promise(resolve => {
    const { headers = {}, timeout = DEFAULT_TIMEOUT } = opts
    let parsed: URL
    try { parsed = new URL(url) } catch { resolve(null); return }

    const isHttps = parsed.protocol === 'https:'
    const lib = isHttps ? https : http

    const req = lib.request({
      method: 'GET', hostname: parsed.hostname,
      port:   parsed.port || (isHttps ? 443 : 80),
      path:   parsed.pathname + parsed.search,
      headers: { 'user-agent': UA, ...headers },
      timeout,
    }, res => {
      if (res.statusCode && res.statusCode >= 400) { res.resume(); resolve(null); return }
      resolve(res)
    })

    req.on('timeout', () => { req.destroy(); resolve(null) })
    req.on('error',   () => resolve(null))
    req.end()
  })
}
