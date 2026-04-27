// src/plugins/loader.ts
// Carrega todos os plugins declarados no config.ts, valida a estrutura
// e expõe o registro para o router, info e WebSocketManager.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { AurisConfig } from '../typings/index.js'
import type {
  AurisPlugin,
  LoadedPlugin,
  PluginDeclaration,
  PluginManifest,
  AurisPluginContext,
} from './types.js'
import { resolvePlugin } from './resolver.js'
import { log } from '../utils/logger.js'

// ─── Registro global ──────────────────────────────────────────────────────────

const _registry: LoadedPlugin[] = []

/** Lista somente leitura de plugins carregados. */
export function getLoadedPlugins(): ReadonlyArray<LoadedPlugin> {
  return _registry
}

// ─── Validação do módulo ──────────────────────────────────────────────────────

function assertPlugin(mod: unknown, name: string): AurisPlugin {
  const raw = (mod as { default?: unknown }).default ?? mod
  if (typeof raw !== 'object' || raw === null)
    throw new Error(`Plugin "${name}" não exporta um objeto válido como default`)
  return raw as AurisPlugin
}

// ─── Leitura do manifesto ─────────────────────────────────────────────────────

/**
 * Tenta ler auris-plugin.json do mesmo diretório do entrypoint resolvido.
 * Para plugins de URL única (sem manifesto), usa valores inferidos.
 */
function readManifest(entrypointUrl: string, fallbackName: string): PluginManifest {
  try {
    const dir = new URL('.', entrypointUrl).pathname
    const manifestPath = join(dir, 'auris-plugin.json')
    if (existsSync(manifestPath)) {
      return JSON.parse(readFileSync(manifestPath, 'utf-8')) as PluginManifest
    }
  } catch {
    // silencioso — fallback abaixo
  }

  return {
    name: fallbackName,
    version: '0.0.0',
    main: new URL(entrypointUrl).pathname.split('/').pop() ?? 'index.js',
  }
}

// ─── Contexto injetado ────────────────────────────────────────────────────────

function makeContext(
  manifest: PluginManifest,
  config: AurisConfig,
  pluginConfig: Record<string, unknown>,
): AurisPluginContext {
  return {
    name: manifest.name,
    version: manifest.version,
    config,
    pluginConfig,
    log(level, msg) {
      log(level, `Plugin:${manifest.name}`, msg)
    },
  }
}

// ─── Loader principal ─────────────────────────────────────────────────────────

/**
 * Lê a lista de plugins do config, resolve cada origem, importa o módulo,
 * valida e registra. Erros em plugins individuais são logados e não derrubam
 * o servidor.
 */
export async function loadPlugins(config: AurisConfig): Promise<void> {
  const declarations: PluginDeclaration[] = (config as AurisConfig & {
    plugins?: PluginDeclaration[]
  }).plugins ?? []

  if (declarations.length === 0) return

  log('info', 'PluginLoader', `Carregando ${declarations.length} plugin(s)…`)

  for (const decl of declarations) {
    const depLabel = decl.dependency

    try {
      // 1. Resolve a origem e obtém a URL de import
      const entrypointUrl = await resolvePlugin(decl)

      // 2. Importa o módulo
      const mod = await import(entrypointUrl)

      // 3. Lê manifesto
      const inferredName = depLabel.split(':').pop()?.split('@')[0] ?? depLabel
      const manifest = readManifest(entrypointUrl, inferredName)

      // 4. Valida e extrai a instância do plugin
      const plugin = assertPlugin(mod, manifest.name)

      // 5. Detecta a origem para exibição no /v4/info
      const origin = decl.dependency.split(':')[0] ?? 'unknown'

      // 6. Registra
      _registry.push({ manifest, plugin, origin })

      log('info', 'PluginLoader', `✓ "${manifest.name}" v${manifest.version} [${origin}]`)
    } catch (err) {
      log('error', 'PluginLoader', `✗ Falha ao carregar "${depLabel}": ${err}`)
    }
  }
}

/**
 * Chama `plugin.setup()` de cada plugin carregado com seu contexto.
 * Deve ser chamado depois de `loadPlugins()` e antes de `createServer()`.
 */
export async function setupPlugins(config: AurisConfig): Promise<void> {
  for (const { manifest, plugin } of _registry) {
    if (!plugin.setup) continue

    const pluginConfig =
      (config as AurisConfig & { plugins?: Array<PluginDeclaration & { config?: Record<string, unknown> }> })
        .plugins
        ?.find(d => d.dependency.includes(manifest.name))
        ?.config ?? {}

    const ctx = makeContext(manifest, config, pluginConfig)

    try {
      await plugin.setup(ctx)
      log('debug', 'PluginLoader', `setup() de "${manifest.name}" concluído`)
    } catch (err) {
      log('error', 'PluginLoader', `Erro no setup() de "${manifest.name}": ${err}`)
    }
  }
}

/**
 * Chama `plugin.onShutdown()` de cada plugin carregado.
 * Deve ser conectado ao SIGTERM / SIGINT no index.ts.
 */
export async function shutdownPlugins(): Promise<void> {
  for (const { manifest, plugin } of _registry) {
    if (!plugin.onShutdown) continue
    try {
      await plugin.onShutdown()
      log('debug', 'PluginLoader', `onShutdown() de "${manifest.name}" concluído`)
    } catch (err) {
      log('error', 'PluginLoader', `Erro no onShutdown() de "${manifest.name}": ${err}`)
    }
  }
}
