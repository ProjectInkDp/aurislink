// src/utils/logger.ts

import fs from 'node:fs'
import path from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

// ─── ANSI colors ─────────────────────────────────────────────────────────────
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
  bgRed:   '\x1b[41m',
  bgYellow:'\x1b[43m',
} as const

// ─── Level styling ────────────────────────────────────────────────────────────
const LEVEL_STYLE: Record<Level, { badge: string; color: string }> = {
  debug: { badge: ' DBG ', color: C.gray },
  info:  { badge: ' INF ', color: C.cyan },
  warn:  { badge: ' WRN ', color: C.yellow },
  error: { badge: ' ERR ', color: C.red },
}

// ─── Tag colors — each module gets its own color ──────────────────────────────
const TAG_COLORS = [C.green, C.magenta, C.blue, C.cyan, C.yellow]
const _tagColorCache = new Map<string, string>()
let _tagColorIdx = 0

function tagColor(tag: string): string {
  if (!_tagColorCache.has(tag)) {
    _tagColorCache.set(tag, TAG_COLORS[_tagColorIdx++ % TAG_COLORS.length]!)
  }
  return _tagColorCache.get(tag)!
}

// ─── State ────────────────────────────────────────────────────────────────────
let _min        = 1
let _timestamps = true
let _colors     = true
let _fileEnabled = false
let _filePath   = 'logs'
let _fileStream: fs.WriteStream | null = null
let _currentDay = ''

function getDay(): string {
  return new Date().toISOString().slice(0, 10)
}

function openFileStream(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  _currentDay = getDay()
  _fileStream = fs.createWriteStream(path.join(dir, `aurislink-${_currentDay}.log`), { flags: 'a' })
}

function rotateIfNeeded() {
  if (!_fileEnabled || !_fileStream) return
  if (getDay() !== _currentDay) {
    _fileStream.end()
    openFileStream(_filePath)
  }
}

// ─── Init ─────────────────────────────────────────────────────────────────────
export function initLogger(opts: {
  level?: string
  timestamps?: boolean
  colors?: boolean
  file?: { enabled?: boolean; path?: string }
}) {
  _min        = LEVELS[(opts.level as Level) ?? 'info'] ?? 1
  _timestamps = opts.timestamps ?? true
  _colors     = opts.colors ?? true

  if (opts.file?.enabled) {
    _fileEnabled = true
    _filePath    = opts.file.path ?? 'logs'
    openFileStream(_filePath)
  }
}

// ─── Core log function ────────────────────────────────────────────────────────
export function log(level: Level, tag: string, msg: string) {
  if ((LEVELS[level] ?? 0) < _min) return

  rotateIfNeeded()

  const now  = new Date()
  const time = now.toISOString().replace('T', ' ').replace('Z', '')

  let line: string

  if (_colors) {
    const { badge, color } = LEVEL_STYLE[level]!
    const ts   = _timestamps ? `${C.dim}${time}${C.reset} ` : ''
    const lbl  = `${C.bold}${color}${badge}${C.reset}`
    const tc   = tagColor(tag)
    const t    = `${tc}${C.bold}[${tag}]${C.reset}`
    line = `${ts}${lbl} ${t} ${msg}\n`
  } else {
    const ts  = _timestamps ? `${time} ` : ''
    const lbl = LEVEL_STYLE[level]!.badge.trim()
    line = `${ts}${lbl} [${tag}] ${msg}\n`
  }

  if (level === 'error') process.stderr.write(line)
  else process.stdout.write(line)

  if (_fileEnabled && _fileStream) {
    const plain = `${time} ${LEVEL_STYLE[level]!.badge.trim()} [${tag}] ${msg}\n`
    _fileStream.write(plain)
  }
}
