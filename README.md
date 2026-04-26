<div align="center">
  <img src="./images/logo.png" alt="AurisLink" width="120"/>
  <h1>AurisLink</h1>
  <p>A lightweight, Lavalink v4-compatible audio server written in TypeScript / Node.js.</p>
</div>

AurisLink speaks the [Lavalink v4 REST + WebSocket protocol](https://lavalink.dev/api/rest), so any existing Lavalink client (Shoukaku, Lavalink.js, Magmastream, etc.) connects without changes.

---

## Why AurisLink?

| Feature | Lavalink | NodeLink | AurisLink |
|---|---|---|---|
| Runtime | Java / JVM | Node.js | Node.js |
| Memory (idle) | ~200 MB+ | ~50 MB | ~30 MB |
| Mobile / low-end environments | ❌ Heavy | ✅ | ✅ |
| SoundCloud (auto client_id refresh) | ❌ | ❌ | ✅ |
| Deezer search + resolve | ❌ | ✅ | ✅ |
| Deezer full stream (with ARL) | ❌ | ✅ | ✅ |
| JioSaavn search + resolve + stream | ❌ | ✅ | ✅ |
| JioSaavn proxy support | ❌ | ✅ | ✅ |
| Stream URL cache w/ TTL | ❌ | ❌ | ✅ |
| Lyrics (synced + plain) | ❌ | ✅ | ✅ |
| Track meaning (bio, tags, stats) | ❌ | ⚠️ Partial | ✅ |
| Native TLS | ❌ | ❌ | ✅ |
| File logging w/ daily rotation | ❌ | ❌ | ✅ |
| TrackStuck watchdog | ❌ | ✅ | ✅ |
| Zombie player cleanup | ❌ | ✅ | ✅ |
| encodeTrack / decodeTracks REST | ❌ | ✅ | ✅ |
| Lavalink v4 compatible | ✅ | ✅ | ✅ |

---

## Requirements

- **Node.js 20+**
- **npm 9+**

---

## Running AurisLink

### Linux / macOS / Windows WSL

```sh
unzip aurislink.zip
cd aurislink
npm install
npm start
```

### Termux (Android)

```sh
cd ~
unzip /sdcard/Download/aurislink.zip
cd aurislink
npm install
npm start
```

### Docker

```sh
docker build -t aurislink .
docker run -p 2333:2333 aurislink
```

The Dockerfile is included. It builds the TypeScript project and runs the compiled output, so no JVM is required.

---

## Quick test with curl

```sh
# Server info
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/info

# Stats
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/stats

# Search SoundCloud
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=scsearch:lofi"

# Search Deezer
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=dzsearch:daft punk"

# Load a Deezer track URL
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=https://www.deezer.com/track/3135556"

# Load a Deezer album
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=https://www.deezer.com/album/302127"

# Search JioSaavn
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=jssearch:arijit singh"

# Load a JioSaavn track URL
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=https://www.jiosaavn.com/song/apna-bana-le/ATIfejZ9bWw"

# Lyrics for the current track in a player
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/sessions/SESSION_ID/players/GUILD_ID/track/lyrics"

# Track meaning — bio, tags, year, listeners (Wikipedia + MusicBrainz + Last.fm)
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/meaning?encodedTrack=BASE64_HERE&language=pt"

# Decode a track
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/decodetrack?encodedTrack=<base64>"

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
| `trackStuckThresholdMs` | `10000` | ms without progress before TrackStuck fires |
| `zombieThresholdMs` | `60000` | ms before an idle disconnected player is destroyed |
| `maxSearchResults` | `10` | Max results per search |
| `maxPlaylistLength` | `100` | Max tracks loaded from a playlist |
| `logging.file.enabled` | `false` | Save logs to files |
| `logging.file.path` | `"logs"` | Directory for log files |
| `logging.file.rotation` | `"daily"` | Log rotation — `daily`, `weekly`, or `none` |
| `logging.file.ttlDays` | `7` | Delete logs older than N days (0 = keep forever) |
| `sources.soundcloud.clientId` | `""` | Leave empty for auto-detection |
| `sources.deezer.enabled` | `false` | Enable Deezer source |
| `sources.deezer.arl` | `""` | Deezer ARL cookie (enables full streams) |
| `sources.deezer.decryptionKey` | `""` | 16-char Blowfish key (required with ARL) |
| `sources.jiosaavn.enabled` | `false` | Enable JioSaavn source |
| `sources.jiosaavn.playlistLoadLimit` | `50` | Max tracks loaded from a playlist/album |
| `sources.jiosaavn.artistLoadLimit` | `20` | Max tracks loaded from an artist |
| `sources.jiosaavn.secretKey` | `"38346591"` | DES/ECB key — leave as default |
| `sources.jiosaavn.proxy.url` | `""` | HTTP/HTTPS proxy (useful if hosted outside India) |
| `sources.lastfm.apiKey` | `""` | Last.fm API key — enables listeners/playcount in `/v4/meaning` |

### Deezer setup

Without `arl`, Deezer works for search and metadata only (no actual audio stream). To enable full streams:

```ts
deezer: {
  enabled: true,
  arl: 'your_arl_here',
  decryptionKey: '0123456789abcdef',  // exactly 16 characters
}
```

### JioSaavn setup

JioSaavn works out of the box — no account or API key required:

```ts
jiosaavn: {
  enabled: true,
}
```

> If hosted outside India, configure a proxy:
> ```ts
> jiosaavn: {
>   enabled: true,
>   proxy: {
>     url: 'https://your-india-proxy.example.com',
>     username: 'user',   // optional
>     password: 'pass',   // optional
>   },
> }
> ```

---

## API — Implemented Endpoints

### REST

| Method | Route | Description |
|---|---|---|
| `GET` | `/v4/info` | Server info, version, sources |
| `GET` | `/v4/stats` | Memory, CPU, player counts |
| `GET` | `/v4/loadtracks` | Search or load tracks |
| `GET` | `/v4/decodetrack` | Decode a single encoded track |
| `POST` | `/v4/decodetracks` | Decode multiple encoded tracks (batch) |
| `POST` | `/v4/encodetrack` | Encode a TrackInfo into a Lavalink v4 string |
| `POST` | `/v4/encodetracks` | Encode multiple TrackInfo objects (batch) |
| `PATCH` | `/v4/sessions/:sessionId` | Update session resuming/timeout |
| `GET` | `/v4/sessions/:sessionId/players` | List all players in a session |
| `GET` | `/v4/sessions/:sessionId/players/:guildId` | Get a specific player |
| `PATCH` | `/v4/sessions/:sessionId/players/:guildId` | Create/update a player |
| `DELETE` | `/v4/sessions/:sessionId/players/:guildId` | Destroy a player |
| `GET` | `/v4/sessions/:sessionId/players/:guildId/track/lyrics` | Lyrics for the current track |
| `GET` | `/v4/meaning` | Track bio, tags, year, listeners |
| `GET` | `/v4/loadchapters` | Track chapters (Deezer podcast / SoundCloud parsed) |
| `GET` | `/v4/metrics` | Prometheus-compatible plain-text metrics |
| `GET` | `/v4/health` | Liveness check — `{ status, version, uptime }` |
| `GET` | `/v4/sessions/:sessionId/players/:guildId/lyrics/subscribe` | SSE stream of synced lyrics lines |

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
| `event` | Track events (start, end, exception, stuck) |

---

## Sources

| Source | Status | Search prefix | Notes |
|---|---|---|---|
| SoundCloud | ✅ Ready | `scsearch:` | Auto client_id refresh, stream cache, 401 retry |
| Deezer | ✅ Ready | `dzsearch:` | Public API (metadata); full streams with ARL |
| JioSaavn | ✅ Ready | `jssearch:` | DES/ECB stream decryption, proxy support, 320kbps |
| YouTube | 🔜 Planned | `ytsearch:` | — |
| Spotify | 🔜 Planned | `spsearch:` | — |

---

## Project Structure

```
images/
├── logo.svg                # Vector logo
└── logo.png                # Raster logo (400×400)
src/
├── api/
│   ├── helpers.ts          # sendJson, sendError, requireAuth
│   ├── info.ts             # GET /v4/info
│   ├── loadtracks.ts       # GET /v4/loadtracks
│   ├── chapters.ts         # GET /v4/loadchapters
│   ├── lyrics.ts           # GET /v4/sessions/:id/players/:id/track/lyrics
│   ├── meaning.ts          # GET /v4/meaning
│   ├── players.ts          # Session/player CRUD
│   ├── router.ts           # Central request router
│   └── tracks.ts           # encode/decode endpoints
├── core/
│   ├── SessionManager.ts   # Session + player state
│   └── WebSocketManager.ts # WS server + event emitter
├── decrypters/
│   ├── blowfish-cbc.ts     # Blowfish-CBC (Deezer stream decryption)
│   └── des-ecb.ts          # DES/ECB (JioSaavn stream decryption)
├── filters/
│   ├── FilterChain.ts      # Filter pipeline
│   ├── channelMix.ts
│   ├── echo.ts
│   ├── equalizer.ts
│   ├── lowPass.ts
│   ├── reverb.ts
│   ├── rotation.ts
│   ├── timescale.ts
│   ├── tremolo.ts
│   ├── vibrato.ts
│   └── volume.ts
├── sources/
│   ├── deezer.ts           # Deezer source
│   ├── jiosaavn.ts         # JioSaavn source
│   └── soundcloud.ts       # SoundCloud source
├── typings/
│   └── index.ts            # Shared TypeScript interfaces
├── utils/
│   ├── http.ts             # Native HTTP client
│   ├── logger.ts           # Colored logger with file rotation
│   └── track.ts            # Lavalink v4 track encode/decode
├── index.ts                # Entry point
└── server.ts               # HTTP + WebSocket server
```

---

## Contributing

- `v1` — current stable version
- `dev` — development / community PRs

PRs are welcome on the `dev` branch.

---

## License

[MIT](./LICENSE) © AurisLink Contributors
