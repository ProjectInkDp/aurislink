// src/plugins/index.ts
// Barrel — exporta tudo que o resto do AurisLink precisa do sistema de plugins.

export type {
  AurisPlugin,
  AurisPluginContext,
  PluginDeclaration,
  PluginManifest,
  LoadedPlugin,
  PluginRoute,
  PluginSource,
  PlayerEventHook,
  TrackLoadHook,
  HttpMethod,
} from './types.js'

export { loadPlugins, setupPlugins, shutdownPlugins, getLoadedPlugins } from './loader.js'
