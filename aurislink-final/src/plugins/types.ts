// src/plugins/types.ts
// Contratos de tipo para o sistema de plugins do AurisLink.

import type http from 'node:http'
import type { Source, LoadResult, AurisConfig } from '../typings/index.js'
import type { SessionManager } from '../core/SessionManager.js'
import type { WebSocketManager } from '../core/WebSocketManager.js'

// ─── Contexto injetado nos plugins ───────────────────────────────────────────

export interface AurisPluginContext {
  /** Nome declarado no auris-plugin.json */
  name: string
  /** Versão declarada no auris-plugin.json */
  version: string
  /** Config completa do servidor (somente leitura) */
  config: Readonly<AurisConfig>
  /** Config específica do plugin vinda do config.ts (plugins[name]) */
  pluginConfig: Record<string, unknown>
  /** Logger do servidor — usa o mesmo formato do AurisLink */
  log(level: 'debug' | 'info' | 'warn' | 'error', msg: string): void
}

// ─── Rota HTTP extra registrada por plugin ───────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface PluginRoute {
  method: HttpMethod
  /** Caminho completo, ex: '/v4/meu-plugin/ping' */
  path: string
  handler(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    ctx: { sm: SessionManager; wsm: WebSocketManager },
  ): void | Promise<void>
}

// ─── Source extra registrada por plugin ──────────────────────────────────────

export type PluginSource = Source

// ─── Hook de evento WebSocket ─────────────────────────────────────────────────

export interface PlayerEventPayload {
  /** ID da guilda */
  guildId: string
  /** ID da sessão */
  sessionId: string
  /** Dados arbitrários do evento */
  data: Record<string, unknown>
}

export type PlayerEventHook = (
  event: string,
  payload: PlayerEventPayload,
) => void | Promise<void>

// ─── Hook de carregamento de faixa ───────────────────────────────────────────

export type TrackLoadHook = (
  identifier: string,
  result: LoadResult,
) => LoadResult | Promise<LoadResult>

// ─── Definição principal do plugin ───────────────────────────────────────────

export interface AurisPlugin {
  /**
   * Chamado uma única vez no boot, antes do servidor HTTP subir.
   * Ideal para validar config, pré-carregar cache, criar timers, etc.
   */
  setup?(ctx: AurisPluginContext): void | Promise<void>

  /**
   * Rotas HTTP extras. Montadas no router central antes de qualquer
   * requisição chegar — sem sobreescrever rotas nativas do protocolo.
   */
  routes?: PluginRoute[]

  /**
   * Sources de áudio extras (mesmo contrato de Source nativa).
   * O prefixo de busca é o `searchPrefixes[0]` da source.
   */
  sources?: PluginSource[]

  /**
   * Intercepta eventos de player antes de serem enviados pelo WebSocket.
   * Retornar `null` cancela o envio. Retornar o payload (modificado ou não)
   * continua o fluxo normal.
   */
  onPlayerEvent?: PlayerEventHook

  /**
   * Intercepta qualquer resultado de `/v4/loadtracks`.
   * Pode enriquecer, filtrar ou substituir o resultado.
   */
  onTrackLoad?: TrackLoadHook

  /**
   * Chamado quando o servidor encerra (SIGTERM / SIGINT).
   * Use para fechar conexões, gravar estado em disco, etc.
   */
  onShutdown?(): void | Promise<void>
}

// ─── Manifesto lido do auris-plugin.json ─────────────────────────────────────

export interface PluginManifest {
  name: string
  version: string
  description?: string
  author?: string
  /** Caminho do entrypoint JS/TS relativo à raiz do plugin */
  main: string
}

// ─── Registro interno após carregamento ──────────────────────────────────────

export interface LoadedPlugin {
  manifest: PluginManifest
  plugin: AurisPlugin
  /** Origem: 'local' | 'npm' | 'github' | 'url' */
  origin: string
}

// ─── Declaração no config.ts ──────────────────────────────────────────────────

export interface PluginDeclaration {
  /**
   * Formas aceitas:
   *  - `'local:./plugins/meu-plugin'`       — pasta local
   *  - `'npm:nome-do-pacote@1.2.3'`         — npm registry
   *  - `'github:owner/repo#tag'`             — GitHub (tarball)
   *  - `'url:https://example.com/plugin.js'` — URL direta (único arquivo .js)
   */
  dependency: string
  /** Config livre passada ao plugin via ctx.pluginConfig */
  config?: Record<string, unknown>
}
