// config.default.ts
// Copie para config.ts e ajuste conforme necessário.
// AurisLink carrega config.ts da raiz do projeto no startup.

import type { AurisConfig } from './src/typings/index.js'

const config: AurisConfig = {
  server: {
    host: '0.0.0.0',
    port: 2333,
    password: 'youshallnotpass',
    tls: {
      enabled: false,
      cert: '',
      key: '',
    },
  },

  logging: {
    level: 'info',
    timestamps: true,
    colors: true,
    file: {
      enabled: false,
      path: 'logs',
    },
  },

  playerUpdateInterval: 5_000,
  statsInterval: 60_000,
  maxSearchResults: 10,
  maxPlaylistLength: 100,

  sources: {
    soundcloud: {
      enabled: true,
      clientId: '',
    },
    deezer: {
      enabled: false,
      // arl: '',
      // decryptionKey: '',
    },
    lastfm: {
      apiKey: '', // opcional — habilita listeners/playcount em /v4/meaning
    },
  },

  // ─── Plugins ───────────────────────────────────────────────────────────────
  // Descomente e configure conforme necessário.
  // Cada plugin é carregado e inicializado no boot, antes do servidor subir.
  //
  // plugins: [
  //
  //   // Pasta local (relativa ao cwd)
  //   { dependency: 'local:./plugins/meu-plugin' },
  //
  //   // Pacote do npm (instala automaticamente em .auris-plugin-cache/)
  //   { dependency: 'npm:aurislink-plugin-exemplo@1.0.0' },
  //
  //   // Repositório do GitHub (baixa tarball e descompacta em cache)
  //   { dependency: 'github:seu-usuario/aurislink-plugin-exemplo#v1.0.0' },
  //
  //   // URL direta para um único arquivo .js auto-contido
  //   { dependency: 'url:https://example.com/meu-plugin.js' },
  //
  //   // Com configuração específica passada ao plugin via ctx.pluginConfig
  //   {
  //     dependency: 'local:./plugins/meu-plugin',
  //     config: { apiKey: 'abc123', maxItems: 50 },
  //   },
  //
  // ],
}

export default config
