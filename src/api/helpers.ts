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

/**
 * Validates the Authorization header against the configured password.
 * Returns true if authorized, false if already responded with 401.
 */
export function requireAuth(req: http.IncomingMessage, res: http.ServerResponse, password: string): boolean {
  const auth = req.headers['authorization']
  if (auth === password) return true
  sendError(res, 401, 'Unauthorized', 'Invalid or missing Authorization header')
  return false
}
