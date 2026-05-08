// src/api/helpers.ts

import type http from 'node:http'

export function sendJson(res: http.ServerResponse, status: number, body: unknown) {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type':   'application/json',
    'content-length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

export function sendError(res: http.ServerResponse, status: number, error: string, message: string) {
  sendJson(res, status, { timestamp: Date.now(), status, error, message, trace: null })
}

export function requireAuth(req: http.IncomingMessage, res: http.ServerResponse, password: string): boolean {
  const auth = req.headers['authorization']
  if (auth === password) return true
  sendError(res, 401, 'Unauthorized', 'Invalid or missing Authorization header')
  return false
}

// Fix #8: centralise body reading so handlers don't duplicate this logic
export function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export async function parseBody<T>(req: http.IncomingMessage, res: http.ServerResponse): Promise<T | null> {
  try {
    const raw = await readBody(req)
    if (!raw.trim()) return {} as T
    return JSON.parse(raw) as T
  } catch {
    sendError(res, 400, 'Bad Request', 'Invalid JSON body')
    return null
  }
}
