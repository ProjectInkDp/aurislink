// plugins/example-plugin/index.ts
// Plugin de exemplo para o AurisLink.
// Demonstra todos os hooks disponíveis: rota REST, source, onTrackLoad e onShutdown.

import type { AurisPlugin, AurisPluginContext } from '../../src/plugins/types.js'
import type { LoadResult } from '../../src/typings/index.js'
import { sendJson } from '../../src/api/helpers.js'

// ─── Estado interno do plugin ─────────────────────────────────────────────────

let ctx: AurisPluginContext
let requestCount = 0

// ─── Plugin ───────────────────────────────────────────────────────────────────

const plugin: AurisPlugin = {

  // ── Setup ────────────────────────────────────────────────────────────────
  async setup(context) {
    ctx = context
    ctx.log('info', `Inicializado! pluginConfig: ${JSON.stringify(ctx.pluginConfig)}`)
  },

  // ── Rotas REST extras ────────────────────────────────────────────────────
  routes: [
    {
      method: 'GET',
      path: '/v4/exemplo/ping',
      handler(_req, res) {
        requestCount++
        sendJson(res, 200, {
          plugin:   'exemplo-plugin',
          version:  '1.0.0',
          pong:     true,
          requests: requestCount,
        })
      },
    },
    {
      method: 'GET',
      path: '/v4/exemplo/players',
      handler(_req, res, { sm }) {
        // Acesso ao SessionManager passado pelo router
        const sessions = sm.getAllSessions()
        const total = sessions.reduce((acc, s) => acc + s.players.size, 0)
        sendJson(res, 200, { totalPlayers: total })
      },
    },
  ],

  // ── Source extra ──────────────────────────────────────────────────────────
  sources: [
    {
      name: 'exemplo',
      searchPrefixes: ['exemplo:'],

      async setup() {
        return true // pronto
      },

      accepts(url: string) {
        return url.startsWith('exemplo:')
      },

      async load(_url: string): Promise<LoadResult> {
        return { loadType: 'empty', data: {} }
      },

      async search(_query: string): Promise<LoadResult> {
        // Exemplo: retorna uma faixa fictícia
        return {
          loadType: 'search',
          data: [
            {
              encoded: '',
              info: {
                identifier:  'exemplo-001',
                isSeekable:  true,
                author:      'Artista Exemplo',
                length:      180_000,
                isStream:    false,
                position:    0,
                title:       'Faixa de Exemplo',
                uri:         'https://example.com/track/001',
                artworkUrl:  null,
                isrc:        null,
                sourceName:  'exemplo',
              },
              pluginInfo: {},
            },
          ],
        }
      },
    },
  ],

  // ── Hook de TrackLoad ────────────────────────────────────────────────────
  async onTrackLoad(identifier, result) {
    // Exemplo: injeta um campo extra em pluginInfo de cada faixa
    if (result.loadType === 'search' && Array.isArray(result.data)) {
      result.data = result.data.map(track => ({
        ...track,
        pluginInfo: { ...track.pluginInfo, enrichedBy: 'exemplo-plugin' },
      }))
    }
    return result
  },

  // ── Shutdown ──────────────────────────────────────────────────────────────
  async onShutdown() {
    ctx?.log('info', `Encerrando. Total de requests: ${requestCount}`)
  },
}

export default plugin
