// src/plugins/resolver.ts
// Resolve declarações de plugin de origens distintas e retorna o caminho
// local do entrypoint pronto para import().

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, createWriteStream } from 'node:fs'
import { join, resolve as pathResolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import https from 'node:https'
import http from 'node:http'
import type { PluginDeclaration } from './types.js'
import { log } from '../utils/logger.js'

const PLUGIN_CACHE_DIR = pathResolve(process.cwd(), '.auris-plugin-cache')

// ─── helpers ─────────────────────────────────────────────────────────────────

function ensureCache() {
  if (!existsSync(PLUGIN_CACHE_DIR)) mkdirSync(PLUGIN_CACHE_DIR, { recursive: true })
}

/** Download simples de uma URL para um arquivo local. */
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(dest)
    const get = url.startsWith('https') ? https.get : http.get
    get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close()
        return downloadFile(res.headers.location!, dest).then(resolve).catch(reject)
      }
      if (res.statusCode !== 200) {
        file.close()
        return reject(new Error(`HTTP ${res.statusCode} ao baixar ${url}`))
      }
      res.pipe(file)
      file.on('finish', () => file.close(() => resolve()))
    }).on('error', reject)
  })
}

/** Converte um caminho de arquivo em URL importável pelo Node ESM. */
function toImportUrl(filePath: string) {
  return pathToFileURL(filePath).href
}

// ─── resolvers por origem ─────────────────────────────────────────────────────

/**
 * LOCAL — `local:./plugins/meu-plugin`
 * O caminho é relativo ao cwd (onde o usuário rodou `npm start`).
 */
async function resolveLocal(ref: string): Promise<string> {
  const dir = pathResolve(process.cwd(), ref)
  if (!existsSync(dir)) throw new Error(`Plugin local não encontrado: ${dir}`)

  const manifestPath = join(dir, 'auris-plugin.json')
  if (!existsSync(manifestPath)) throw new Error(`auris-plugin.json ausente em ${dir}`)

  const manifest = JSON.parse(await import('node:fs').then(fs => fs.readFileSync(manifestPath, 'utf-8')))
  const entrypoint = join(dir, manifest.main ?? 'index.js')
  if (!existsSync(entrypoint)) throw new Error(`Entrypoint não encontrado: ${entrypoint}`)

  return toImportUrl(entrypoint)
}

/**
 * NPM — `npm:nome-do-pacote@1.2.3`
 * Instala o pacote em .auris-plugin-cache/node_modules se ainda não
 * estiver presente (compara a versão do package.json instalado).
 */
async function resolveNpm(ref: string): Promise<string> {
  ensureCache()

  const atIdx = ref.lastIndexOf('@')
  const name = atIdx > 0 ? ref.slice(0, atIdx) : ref
  const version = atIdx > 0 ? ref.slice(atIdx + 1) : 'latest'
  const pkgDir = join(PLUGIN_CACHE_DIR, 'node_modules', name)

  let needsInstall = true
  if (existsSync(join(pkgDir, 'package.json'))) {
    const installed = JSON.parse(
      await import('node:fs').then(fs => fs.readFileSync(join(pkgDir, 'package.json'), 'utf-8'))
    )
    if (version === 'latest' || installed.version === version) needsInstall = false
  }

  if (needsInstall) {
    log('info', 'PluginResolver', `Instalando ${name}@${version} via npm…`)
    // Inicializa package.json mínimo para npm funcionar na pasta de cache
    const cachePkg = join(PLUGIN_CACHE_DIR, 'package.json')
    if (!existsSync(cachePkg)) writeFileSync(cachePkg, JSON.stringify({ name: 'auris-plugin-cache', version: '1.0.0', private: true }))
    execSync(`npm install ${name}@${version} --prefix ${PLUGIN_CACHE_DIR} --no-save --silent`, { stdio: 'pipe' })
    log('info', 'PluginResolver', `${name}@${version} instalado`)
  }

  // Lê o main do package.json do pacote instalado
  const pkgJson = JSON.parse(
    await import('node:fs').then(fs => fs.readFileSync(join(pkgDir, 'package.json'), 'utf-8'))
  )
  const entrypoint = join(pkgDir, pkgJson.main ?? 'index.js')
  return toImportUrl(entrypoint)
}

/**
 * GITHUB — `github:owner/repo#tag`
 * Baixa o tarball do GitHub e descompacta no cache.
 */
async function resolveGithub(ref: string): Promise<string> {
  ensureCache()

  const [repoRef, tagRef] = ref.split('#')
  const [owner, repo] = repoRef!.split('/')
  const tag = tagRef ?? 'main'

  const destDir = join(PLUGIN_CACHE_DIR, `github-${owner}-${repo}-${tag}`)

  if (!existsSync(destDir)) {
    const tarUrl = `https://codeload.github.com/${owner}/${repo}/tar.gz/${tag}`
    const tarDest = join(PLUGIN_CACHE_DIR, `${owner}-${repo}-${tag}.tar.gz`)
    log('info', 'PluginResolver', `Baixando ${tarUrl}…`)
    await downloadFile(tarUrl, tarDest)
    mkdirSync(destDir, { recursive: true })
    execSync(`tar -xzf ${tarDest} -C ${destDir} --strip-components=1`, { stdio: 'pipe' })
    log('info', 'PluginResolver', `${owner}/${repo}#${tag} extraído`)
  }

  const manifestPath = join(destDir, 'auris-plugin.json')
  if (!existsSync(manifestPath)) throw new Error(`auris-plugin.json ausente em ${owner}/${repo}`)

  const manifest = JSON.parse(
    await import('node:fs').then(fs => fs.readFileSync(manifestPath, 'utf-8'))
  )
  const entrypoint = join(destDir, manifest.main ?? 'index.js')
  return toImportUrl(entrypoint)
}

/**
 * URL — `url:https://example.com/meu-plugin.js`
 * Baixa um único arquivo .js (plugin auto-contido) e faz cache local.
 */
async function resolveUrl(ref: string): Promise<string> {
  ensureCache()

  const slug = Buffer.from(ref).toString('base64url').slice(0, 48)
  const destFile = join(PLUGIN_CACHE_DIR, `url-${slug}.js`)

  if (!existsSync(destFile)) {
    log('info', 'PluginResolver', `Baixando plugin de ${ref}…`)
    await downloadFile(ref, destFile)
    log('info', 'PluginResolver', `Plugin baixado → ${destFile}`)
  }

  return toImportUrl(destFile)
}

// ─── entry point ─────────────────────────────────────────────────────────────

/**
 * Resolve uma declaração de plugin e retorna a URL de import() do entrypoint.
 *
 * @param decl Declaração do config.ts
 * @returns URL importável (file://... ou caminho)
 */
export async function resolvePlugin(decl: PluginDeclaration): Promise<string> {
  const dep = decl.dependency.trim()

  if (dep.startsWith('local:')) return resolveLocal(dep.slice(6))
  if (dep.startsWith('npm:'))   return resolveNpm(dep.slice(4))
  if (dep.startsWith('github:')) return resolveGithub(dep.slice(7))
  if (dep.startsWith('url:'))   return resolveUrl(dep.slice(4))

  throw new Error(
    `Formato de dependência inválido: "${dep}"\n` +
    `Use: local:./caminho  |  npm:pacote@versão  |  github:owner/repo#tag  |  url:https://...`
  )
}
