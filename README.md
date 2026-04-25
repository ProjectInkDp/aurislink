# AurisLink

> A high-performance, Lavalink v4-compatible audio server written in TypeScript / Node.js — designed to be a better alternative to both Lavalink and NodeLink.

AurisLink speaks the [Lavalink v4 REST + WebSocket protocol](https://lavalink.dev/api/rest), so any existing Lavalink client (Shoukaku, Lavalink.js, Magmastream, etc.) connects without changes.

---

## Why AurisLink?

| Feature | Lavalink | NodeLink | AurisLink |
|---|---|---|---|
| Runtime | Java / JVM | Node.js | Node.js |
| Memory (idle) | ~200MB+ | ~50MB | ~30MB |
| Android / Termux | ❌ Heavy | ✅ | ✅ |
| Auto client_id refresh | ❌ | ❌ | ✅ |
| Stream URL cache w/ TTL | ❌ | ❌ | ✅ |
| Native TLS | ❌ | ❌ | ✅ |
| Source fallback chain | ❌ | Partial | ✅ Planned |
| Lavalink v4 compatible | ✅ | ✅ | ✅ |

---

## Requirements

- **Node.js 20+**
- **npm 9+**

> Tested on Termux (Android), Ubuntu, and macOS.

---

## Quick start (Termux)

```sh
# 1 – Extract the zip
cd ~
unzip /sdcard/Download/aurislink-main.zip
cd aurislink

# 2 – Install dependencies
npm install

# 3 – (Optional) Copy and edit the config
cp config.default.ts config.ts
# nano config.ts

# 4 – Run
npm start
```

### Test with curl (in another Termux session)

```sh
# Server info
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/info

# Stats
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/stats

# Search SoundCloud
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=scsearch:lofi"

# Load a direct SoundCloud URL
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=https://soundcloud.com/artist/track"

# WebSocket (requires wscat: npm install -g wscat)
wscat \
  -H "Authorization: youshallnotpass" \
  -H "User-Id: YOUR_BOT_ID" \
  -H "Client-Name: MyBot" \
  -c ws://localhost:2333/v4/websocket
```

---

## Configuration

Copy `config.default.ts` → `config.ts` and edit:

| Key | Default | Description |
|---|---|---|
| `server.host` | `0.0.0.0` | Bind address |
| `server.port` | `2333` | Port |
| `server.password` | `youshallnotpass` | Authorization header value |
| `server.tls.enabled` | `false` | Enable HTTPS |
| `server.tls.cert` | `""` | Path to TLS certificate |
| `server.tls.key` | `""` | Path to TLS private key |
| `playerUpdateInterval` | `5000` | Player position update interval (ms) |
| `statsInterval` | `60000` | Stats broadcast interval (ms) |
| `maxSearchResults` | `10` | Max results per search |
| `maxPlaylistLength` | `100` | Max tracks loaded from a playlist |
| `sources.soundcloud.clientId` | `""` | Leave empty for auto-detection |

---

## API — Implemented Endpoints

### REST

| Method | Route | Description |
|---|---|---|
| `GET` | `/v4/info` | Server info, version, sources |
| `GET` | `/v4/stats` | Memory, CPU, player counts |
| `GET` | `/v4/loadtracks` | Search or load tracks |
| `GET` | `/v4/decodetrack` | Decode a single encoded track |
| `POST` | `/v4/decodetracks` | Decode multiple encoded tracks |
| `PATCH` | `/v4/sessions/:sessionId` | Update session resuming/timeout |
| `GET` | `/v4/sessions/:sessionId/players` | List all players in a session |
| `GET` | `/v4/sessions/:sessionId/players/:guildId` | Get a specific player |
| `PATCH` | `/v4/sessions/:sessionId/players/:guildId` | Create/update a player |
| `DELETE` | `/v4/sessions/:sessionId/players/:guildId` | Destroy a player |

### WebSocket

Connect with headers:

```
Authorization: <password>
User-Id: <bot user id>
Client-Name: <your client name>
```

#### Events (server → client)

| op | Description |
|---|---|
| `ready` | Sent on connect with `sessionId` |
| `playerUpdate` | Player position update |
| `stats` | Server stats broadcast |
| `event` | Track events (start, end, exception) |

#### Track event types

| Type | Description |
|---|---|
| `TrackStartEvent` | A track started playing |
| `TrackEndEvent` | A track finished or was stopped |
| `TrackExceptionEvent` | A track threw an error |

---

## Sources

| Source | Status | Search prefix | Notes |
|---|---|---|---|
| SoundCloud | ✅ Ready | `scsearch:` | Auto client_id, stream cache, 401 auto-refresh |
| YouTube | 🔜 Planned | `ytsearch:` | — |
| Spotify | 🔜 Planned | `spsearch:` | — |

---

## Project Structure

```
src/
├── api/
│   ├── helpers.ts       # sendJson, sendError, requireAuth
│   ├── info.ts          # GET /v4/info
│   ├── loadtracks.ts    # GET /v4/loadtracks
│   ├── players.ts       # Session/player CRUD
│   ├── router.ts        # Central request router
│   └── tracks.ts        # Decode endpoints
├── core/
│   ├── SessionManager.ts   # Session + player state
│   └── WebSocketManager.ts # WS server + event emitter
├── sources/
│   └── soundcloud.ts    # SoundCloud source
├── typings/
│   └── index.ts         # Shared TypeScript interfaces
├── utils/
│   ├── http.ts          # Native HTTP client
│   ├── logger.ts        # Colored logger
│   └── track.ts         # Lavalink v4 track encode/decode
├── index.ts             # Entry point
└── server.ts            # HTTP + WebSocket server
```

---

## Contributing

- `v1` — current stable version
- `dev` — development / community PRs

PRs are welcome on the `dev` branch!

---

## License

MIT © AurisLink Contributors
