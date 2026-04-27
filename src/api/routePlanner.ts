// src/api/routePlanner.ts
// Handles GET /v4/routeplanner/status
//         POST /v4/routeplanner/free/address
//         POST /v4/routeplanner/free/all

import type http from 'node:http'
import type { RoutePlanner } from '../core/RoutePlanner.js'
import { sendError } from './helpers.js'

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(data)
}

export function handleRoutePlannerStatus(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  rp: RoutePlanner | null,
): void {
  if (!rp) {
    return sendJson(res, 200, { class: null, details: null })
  }
  sendJson(res, 200, rp.status)
}

export async function handleRoutePlannerFreeAddress(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  rp: RoutePlanner | null,
): Promise<void> {
  if (!rp) return sendError(res, 500, 'Internal Server Error', 'Route planner is not configured')

  const body = await readBody(req)
  const address = body?.address

  if (typeof address !== 'string' || address.trim().length === 0) {
    return sendError(res, 400, 'Bad Request', 'Field "address" is required')
  }

  const freed = rp.freeAddress(address.trim())
  if (!freed) return sendError(res, 404, 'Not Found', `Address ${address} is not in the failing list`)

  res.writeHead(204)
  res.end()
}

export function handleRoutePlannerFreeAll(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  rp: RoutePlanner | null,
): void {
  if (!rp) return sendError(res, 500, 'Internal Server Error', 'Route planner is not configured')

  rp.freeAll()
  res.writeHead(204)
  res.end()
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise(resolve => {
    let raw = ''
    req.on('data', chunk => { raw += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(raw)) } catch { resolve(null) }
    })
    req.on('error', () => resolve(null))
  })
}
