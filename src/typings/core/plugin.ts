import type { AurisConfig } from '../config/config.js';

export type PluginSource = 'local' | 'npm' | 'github' | 'url';

export interface PluginDefinition {
  name: string;
  source: PluginSource;
  /**
   * For 'local': relative path from plugins directory.
   * For 'npm': package name.
   * For 'github': "owner/repo" or "owner/repo#branch".
   * For 'url': direct URL to a .js or .ts file.
   */
  path: string;
  /**
   * Optional configuration specific to this plugin.
   */
  config?: Record<string, any>;
}

export interface PluginMeta {
  name: string;
  version: string;
  author?: string;
  description?: string;
  homepage?: string;
}

export interface PluginContext {
  config: AurisConfig;
  pluginConfig: Record<string, any>;
  meta: PluginMeta;
  logger: (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void;
}

export type PluginExecutor = (ctx: PluginContext) => Promise<void> | void;

export interface PluginModule {
  default: PluginExecutor;
}

export interface AurisPlugin {
  meta: PluginMeta;
  module: PluginModule;
}
