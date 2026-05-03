import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { httpGet } from './http.js'
import { log } from './reporter.js'

const GITHUB_API_LATEST = 'https://api.github.com/repos/ProjectInkDp/AurisLink/releases/latest'

export interface VersionStatus {
  current: string
  latest: string
  isOutdated: boolean
  isCritical: boolean
}

let cachedStatus: VersionStatus | null = null
let lastCheck = 0
const CHECK_INTERVAL = 24 * 60 * 60 * 1000 // 24 hours

export async function getVersionStatus(): Promise<VersionStatus> {
  const now = Date.now()
  if (cachedStatus && now - lastCheck < CHECK_INTERVAL) {
    return cachedStatus
  }

  const pkgPath = join(process.cwd(), 'package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const current = pkg.version

  try {
    const res = await httpGet(GITHUB_API_LATEST, {
      headers: { 'User-Agent': 'AurisLink-Version-Checker' }
    })

    if (res && res.status === 200) {
      const data = JSON.parse(res.body)
      const latest = data.tag_name.replace('v', '')
      
      const currentParts = current.split('-')[0].split('.').map(Number)
      const latestParts = latest.split('.').map(Number)

      let isOutdated = false
      let isCritical = false

      for (let i = 0; i < 3; i++) {
        if ((latestParts[i] || 0) > (currentParts[i] || 0)) {
          isOutdated = true
          if (i < 2) isCritical = true // Major or Minor difference is critical
          break
        }
      }

      cachedStatus = { current, latest, isOutdated, isCritical }
      lastCheck = now

      if (isOutdated) {
        log('warn', 'VersionCheck', `⚠️ AurisLink is outdated! Current: ${current}, Latest: ${latest}`)
        if (isCritical) {
          log('error', 'VersionCheck', `🚨 CRITICAL: Your version is significantly behind. Please update to avoid compatibility issues.`)
        }
      }

      return cachedStatus
    }
  } catch (err) {
    log('debug', 'VersionCheck', `Failed to check latest version: ${err}`)
  }

  return { current, latest: 'unknown', isOutdated: false, isCritical: false }
}
