// src/api/plugins.ts
//
// Plugin REST endpoints:
//
//   GET  /v4/plugins                        — list all loaded plugins
//   GET  /v4/plugins/:name                  — metadata for a specific plugin
//   GET  /v4/plugins/:name/lyrics           — lyrics via plugin's handleLyrics()
//                                             query: title, author, duration? (ms)

import type http from 'node:http'
import { sendJson, sendError } from './helpers.js'
import type { AurisPlugin } from '../typings/index.js'

// ─── GET /v4/plugins ─────────────────────────────────────────────────────────

export function handleListPlugins(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  plugins: Map<string, AurisPlugin>,
) {
  const list = Array.from(plugins.values()).map(p => p.meta)
  sendJson(res, 200, list)
}

// ─── GET /v4/plugins/:name ───────────────────────────────────────────────────

export function handleGetPlugin(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  name: string,
  plugins: Map<string, AurisPlugin>,
) {
  const plugin = plugins.get(name)
  if (!plugin) {
    return sendError(res, 404, 'Not Found', `Plugin "${name}" is not loaded`)
  }
  sendJson(res, 200, plugin.meta)
}

// ─── GET /v4/plugins/:name/lyrics ────────────────────────────────────────────
//
// Query params:
//   title    (required) — track title
//   author   (required) — track artist
//   duration (optional) — track duration in milliseconds

export async function handlePluginLyrics(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  name: string,
  url: URL,
  plugins: Map<string, AurisPlugin>,
) {
  const plugin = plugins.get(name)
  if (!plugin) {
    return sendError(res, 404, 'Not Found', `Plugin "${name}" is not loaded`)
  }

  if (!plugin.handleLyrics) {
    return sendError(res, 400, 'Bad Request', `Plugin "${name}" does not provide a lyrics handler`)
  }

  const title  = url.searchParams.get('title')?.trim()
  const author = url.searchParams.get('author')?.trim()
  const rawDur = url.searchParams.get('duration')

  if (!title || !author) {
    return sendError(res, 400, 'Bad Request', 'Query params "title" and "author" are required')
  }

  const duration = rawDur ? parseInt(rawDur, 10) : undefined

  let lyrics
  try {
    lyrics = await plugin.handleLyrics(title, author, duration)
  } catch (err) {
    return sendError(res, 500, 'Internal Server Error', `Plugin lyrics handler threw: ${err}`)
  }

  if (!lyrics) {
    return sendError(res, 404, 'Not Found', `No lyrics found via plugin "${name}"`)
  }

  sendJson(res, 200, { ...lyrics, plugin: name })
}
