import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { reporter } from '../shared/reporter.js';
import type { AurisConfig } from '../typings/index.js';
import type { 
  PluginDefinition, 
  PluginContext, 
  PluginModule, 
  PluginMeta 
} from '../typings/engine/plugin.js';

/**
 * PluginManager for AurisLink.
 * Supports loading plugins from Local, NPM, GitHub, and direct URLs.
 */
export class PluginManager {
  private readonly config: AurisConfig;
  private readonly pluginsDir: string;
  private readonly loadedPlugins = new Map<string, PluginMeta>();

  constructor(config: AurisConfig) {
    this.config = config;
    this.pluginsDir = path.join(process.cwd(), 'plugins');
  }

  /**
   * Initializes the plugin system and loads all configured plugins.
   */
  public async setup(): Promise<void> {
    const plugins = this.config.plugins;
    if (!plugins || !Array.isArray(plugins) || plugins.length === 0) {
      return;
    }

    reporter('info', 'PluginManager', `Initializing ${plugins.length} plugins...`);

    try {
      await fs.mkdir(this.pluginsDir, { recursive: true });
    } catch (err) {
      reporter('error', 'PluginManager', `Failed to create plugins directory: ${err}`);
      return;
    }

    for (const pluginDef of plugins) {
      try {
        await this._loadPlugin(pluginDef);
      } catch (err) {
        reporter('error', 'PluginManager', `Failed to load plugin "${pluginDef.name}": ${err}`);
      }
    }
  }

  private async _loadPlugin(def: PluginDefinition): Promise<void> {
    let entryPoint: string | null = null;
    const meta: PluginMeta = {
      name: def.name,
      version: '0.0.0',
    };

    switch (def.source) {
      case 'local':
        entryPoint = await this._resolveLocal(def, meta);
        break;
      case 'npm':
        entryPoint = await this._resolveNpm(def, meta);
        break;
      case 'github':
        entryPoint = await this._resolveGitHub(def, meta);
        break;
      case 'url':
        entryPoint = await this._resolveUrl(def, meta);
        break;
      default:
        throw new Error(`Unsupported plugin source: ${(def as any).source}`);
    }

    if (!entryPoint) return;

    const fileUrl = pathToFileURL(entryPoint).href;
    const module = await import(fileUrl) as PluginModule;

    if (typeof module.default !== 'function') {
      throw new Error(`Plugin "${def.name}" does not have a default export function.`);
    }

    const context: PluginContext = {
      config: this.config,
      pluginConfig: def.config || {},
      meta,
      reporter: (level, message) => reporter(level, `Plugin:${def.name}`, message),
    };

    await module.default(context);

    this.loadedPlugins.set(def.name, meta);
    reporter('info', 'PluginManager', `Loaded plugin: ${meta.name} v${meta.version}${meta.author ? ` by ${meta.author}` : ''}`);
  }

  private async _resolveLocal(def: PluginDefinition, meta: PluginMeta): Promise<string> {
    const pluginPath = path.resolve(this.pluginsDir, def.path);
    const stats = await fs.stat(pluginPath);

    if (stats.isDirectory()) {
      return this._readPackageAndGetEntry(pluginPath, meta);
    }
    return pluginPath;
  }

  private async _resolveNpm(def: PluginDefinition, meta: PluginMeta): Promise<string> {
    const pkgName = def.path;
    reporter('debug', 'PluginManager', `Resolving NPM package: ${pkgName}`);
    
    try {
      const resolvedPath = (import.meta as any).resolve(pkgName);
      const entryPoint = new URL(resolvedPath).pathname;
      
      let currentDir = path.dirname(entryPoint);
      while (currentDir !== path.parse(currentDir).root) {
        const pkgJsonPath = path.join(currentDir, 'package.json');
        try {
          const data = JSON.parse(await fs.readFile(pkgJsonPath, 'utf-8'));
          if (data.name === pkgName) {
            meta.version = data.version || meta.version;
            meta.author = typeof data.author === 'string' ? data.author : data.author?.name;
            meta.description = data.description;
            break;
          }
        } catch {}
        currentDir = path.dirname(currentDir);
      }
      
      return entryPoint;
    } catch (err) {
      reporter('info', 'PluginManager', `NPM package ${pkgName} not found, attempting to install...`);
      execSync(`npm install ${pkgName}`, { cwd: process.cwd() });
      const resolvedPath = (import.meta as any).resolve(pkgName);
      return new URL(resolvedPath).pathname;
    }
  }

  private async _resolveGitHub(def: PluginDefinition, meta: PluginMeta): Promise<string> {
    const [repo, branch] = def.path.split('#');
    const targetDir = path.join(this.pluginsDir, def.name);
    
    if (!existsSync(targetDir)) {
      reporter('info', 'PluginManager', `Cloning GitHub plugin: ${repo}${branch ? `#${branch}` : ''}`);
      const branchFlag = branch ? `-b ${branch}` : '';
      execSync(`git clone --depth 1 ${branchFlag} https://github.com/${repo}.git ${targetDir}`);
      
      if (existsSync(path.join(targetDir, 'package.json'))) {
        reporter('debug', 'PluginManager', `Installing dependencies for ${def.name}...`);
        execSync('npm install --production', { cwd: targetDir });
      }
    } else {
      reporter('debug', 'PluginManager', `GitHub plugin ${def.name} already exists, skipping clone.`);
    }

    return this._readPackageAndGetEntry(targetDir, meta);
  }

  private async _resolveUrl(def: PluginDefinition, meta: PluginMeta): Promise<string> {
    const url = def.path;
    const fileName = path.basename(new URL(url).pathname) || `${def.name}.js`;
    const targetPath = path.join(this.pluginsDir, fileName);

    reporter('info', 'PluginManager', `Downloading plugin from URL: ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to download plugin from ${url}: ${response.statusText}`);
    
    const content = await response.text();
    await fs.writeFile(targetPath, content);
    
    meta.version = 'remote';
    return targetPath;
  }

  private async _readPackageAndGetEntry(dir: string, meta: PluginMeta): Promise<string> {
    const pkgPath = path.join(dir, 'package.json');
    try {
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
      meta.version = pkg.version || meta.version;
      meta.author = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
      meta.description = pkg.description;
      
      if (pkg.main) return path.resolve(dir, pkg.main);
    } catch {}

    for (const file of ['index.ts', 'index.js', 'main.ts', 'main.js']) {
      const fullPath = path.join(dir, file);
      if (existsSync(fullPath)) return fullPath;
    }

    throw new Error(`Could not find entry point in ${dir}`);
  }
}
