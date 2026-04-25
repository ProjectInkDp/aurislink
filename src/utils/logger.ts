// src/utils/logger.ts

import fs from 'node:fs'
import path from 'node:path'

type Level = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 }

const C = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
} as const

const LEVEL_COLOR: Record<Level, string> = {
  debug: C.gray,
  info: C.cyan,
  warn: C.yellow,
  error: C.red,
}

const LEVEL_TAG: Record<Level, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
}

let _min = 1
let _timestamps = true
let _colors = true
let _fileEnabled = false
let _filePath = 'logs'
let _fileStream: fs.WriteStream | null = null
let _currentDay = ''

function getDay(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

function getLogFilePath(dir: string): string {
  return path.join(dir, `aurislink-${getDay()}.log`)
}

function openFileStream(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
  const day = getDay()
  const file = getLogFilePath(dir)
  _fileStream = fs.createWriteStream(file, { flags: 'a' })
  _currentDay = day
}

function rotateIfNeeded() {
  if (!_fileEnabled || !_fileStream) return
  const today = getDay()
  if (today !== _currentDay) {
    _fileStream.end()
    openFileStream(_filePath)
  }
}

export function initLogger(opts: {
  level?: string
  timestamps?: boolean
  colors?: boolean
  file?: { enabled?: boolean; path?: string }
}) {
  _min = LEVELS[(opts.level as Level) ?? 'info'] ?? 1
  _timestamps = opts.timestamps ?? true
  _colors = opts.colors ?? true

  if (opts.file?.enabled) {
    _fileEnabled = true
    _filePath = opts.file.path ?? 'logs'
    openFileStream(_filePath)
  }
}

export function log(level: Level, tag: string, msg: string) {
  if ((LEVELS[level] ?? 0) < _min) return

  rotateIfNeeded()

  const now = new Date().toISOString()
  const ts = _timestamps ? `${C.gray}${now}${C.reset} ` : ''
  const lbl = _colors ? `${LEVEL_COLOR[level]}${LEVEL_TAG[level]}${C.reset}` : LEVEL_TAG[level]
  const t = _colors ? `${C.blue}[${tag}]${C.reset}` : `[${tag}]`
  const line = `${ts}${lbl} ${t} ${msg}\n`

  if (level === 'error') process.stderr.write(line)
  else process.stdout.write(line)

  if (_fileEnabled && _fileStream) {
    const plain = `${now} ${LEVEL_TAG[level]} [${tag}] ${msg}\n`
    _fileStream.write(plain)
  }
}
