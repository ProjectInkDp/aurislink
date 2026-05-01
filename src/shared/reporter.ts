import fs from 'node:fs'
import path from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const C = {
  reset:   '\x1b[0m',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  gray:    '\x1b[90m',
  white:   '\x1b[97m',
  cyan:    '\x1b[36m',
  green:   '\x1b[32m',
  yellow:  '\x1b[33m',
  red:     '\x1b[31m',
  magenta: '\x1b[35m',
  blue:    '\x1b[34m',
} as const

const LEVEL_STYLE: Record<Level, { badge: string; color: string }> = {
  debug: { badge: ' DBG ', color: C.gray },
  info:  { badge: ' INF ', color: C.cyan },
  warn:  { badge: ' WRN ', color: C.yellow },
  error: { badge: ' ERR ', color: C.red },
}

const TAG_COLORS = [C.green, C.magenta, C.blue, C.cyan, C.yellow]
const _tagColorCache = new Map<string, string>()
let _tagColorIdx = 0

function tagColor(tag: string): string {
  if (!_tagColorCache.has(tag)) {
    _tagColorCache.set(tag, TAG_COLORS[_tagColorIdx++ % TAG_COLORS.length]!)
  }
  return _tagColorCache.get(tag)!
}

let _min = 1
let _timestamps = true
let _colors = true

export function initLogger(opts: any) {
  _min = LEVELS[(opts.level as Level) ?? 'info'] ?? 1
  _timestamps = opts.timestamps ?? true
  _colors = opts.colors ?? true
}

/**
 * AurisLink Reporter
 * Centralized logging and reporting utility.
 */
export function reporter(level: Level, tag: string, msg: string) {
  if ((LEVELS[level] ?? 0) < _min) return

  const now = new Date()
  const time = now.toISOString().replace('T', ' ').replace('Z', '')

  let line: string
  if (_colors) {
    const { badge, color } = LEVEL_STYLE[level]!
    const ts = _timestamps ? `${C.dim}${time}${C.reset} ` : ''
    const lbl = `${C.bold}${color}${badge}${C.reset}`
    const tc = tagColor(tag)
    const t = `${tc}${C.bold}[${tag}]${C.reset}`
    line = `${ts}${lbl} ${t} ${msg}\n`
  } else {
    const ts = _timestamps ? `${time} ` : ''
    const lbl = LEVEL_STYLE[level]!.badge.trim()
    line = `${ts}${lbl} [${tag}] ${msg}\n`
  }

  if (level === 'error') process.stderr.write(line)
  else process.stdout.write(line)
}

// Alias for backward compatibility during refactoring
export const log = reporter
