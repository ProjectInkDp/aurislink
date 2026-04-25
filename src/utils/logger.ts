// src/utils/logger.ts

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const C = {
  reset:  '\x1b[0m',
  gray:   '\x1b[90m',
  cyan:   '\x1b[36m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  blue:   '\x1b[34m',
  white:  '\x1b[37m',
} as const

const LEVEL_COLOR: Record<Level, string> = {
  debug: C.gray,
  info:  C.cyan,
  warn:  C.yellow,
  error: C.red,
}

const LEVEL_TAG: Record<Level, string> = {
  debug: 'DBG',
  info:  'INF',
  warn:  'WRN',
  error: 'ERR',
}

let _min        = 1     // info
let _timestamps = true
let _colors     = true

export function initLogger(opts: { level?: string; timestamps?: boolean; colors?: boolean }) {
  _min        = LEVELS[(opts.level as Level) ?? 'info'] ?? 1
  _timestamps = opts.timestamps ?? true
  _colors     = opts.colors ?? true
}

export function log(level: Level, tag: string, msg: string) {
  if ((LEVELS[level] ?? 0) < _min) return

  const ts  = _timestamps ? `${C.gray}${new Date().toISOString()}${C.reset} ` : ''
  const lbl = _colors ? `${LEVEL_COLOR[level]}${LEVEL_TAG[level]}${C.reset}` : LEVEL_TAG[level]
  const t   = _colors ? `${C.blue}[${tag}]${C.reset}` : `[${tag}]`

  const line = `${ts}${lbl} ${t} ${msg}\n`

  if (level === 'error') process.stderr.write(line)
  else process.stdout.write(line)
}
