<div align="center">
  <img src="./images/logo.png" alt="AurisLink" width="120"/>
  <h1>AurisLink</h1>
  <p>A lightweight, Lavalink v4-compatible audio server written in TypeScript / Node.js.</p>

  ![version](https://img.shields.io/badge/version-1.5.0-a78bfa?style=flat-square) ![node](https://img.shields.io/badge/node-20+-339933?style=flat-square&logo=node.js&logoColor=white) ![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
</div>

AurisLink speaks the [Lavalink v4 REST + WebSocket protocol](https://lavalink.dev/api/rest), so any existing Lavalink client (Shoukaku, Lavalink.js, Magmastream, etc.) connects without changes.

---

## Features

- **~30 MB idle memory** — runs comfortably on low-end servers, VPS, and Android via Termux
- **Track cache** — AES-256-GCM encrypted on-disk cache for resolved track metadata; LRU eviction, configurable TTL (default 6 h) and entry limit
- **Token store** — AES-256-GCM encrypted on-disk store for service tokens (Spotify, Deezer, etc.); atomic writes, TTL-aware, survives restarts
- **SoundCloud** — auto client_id refresh, stream URL cache with TTL, 401 retry
- **Deezer** — search, metadata, and full 320kbps streams with ARL + Blowfish decryption
- **JioSaavn** — search, resolve, 320kbps stream with DES/ECB decryption and proxy support
- **Spotify** — anonymous TOTP auth (no credentials needed), OAuth2, custom token endpoint, recommendations (`sprec:`), ISRC-first stream resolution, album/playlist/artist loading
- **Lyrics** — synced + plain text, SSE real-time stream
- **Track meaning** — bio, tags, year, listener count via Wikipedia + MusicBrainz + Last.fm
- **Audio filters** — equalizer, timescale, tremolo, vibrato, rotation, channelMix, lowPass, echo, reverb
- **HTTP/2** — with TLS and HTTP/1.1 fallback
- **Native TLS** — HTTPS out of the box
- **Prometheus metrics** at `/v4/metrics`
- **Health check** at `/v4/health`
- **IP Route Planner** — RotateOnBan, LoadBalance, NanoSwitch strategies
- **Per-IP rate limiting** — sliding window per client
- **Source worker** — search/load runs in an isolated process, keeping the audio loop clean
- **Graceful shutdown** — clean session teardown on SIGINT/SIGTERM
- **TrackStuck watchdog** + **zombie player cleanup**
- **File logging** with daily rotation and TTL
- **Lavalink v4 compatible** — drop-in replacement, no client changes needed

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

# Search Spotify
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=spsearch:the weeknd"

# Spotify recommendations — by genre
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=sprec:pop"

# Spotify recommendations — full seed params
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=sprec:seed_genres=pop%26seed_artists=1Xyo4u8uXC1ZmMpatF05PJ%26limit=10"

# Load a Spotify track URL
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT"

# Load a Spotify playlist
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"

# Search JioSaavn
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=jssearch:arijit singh"

# Lyrics for the current track in a player
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/sessions/SESSION_ID/players/GUILD_ID/track/lyrics"

# Track meaning — bio, tags, year, listeners (Wikipedia + MusicBrainz + Last.fm)
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/meaning?encodedTrack=BASE64_HERE&language=pt"

# Health check
curl http://localhost:2333/v4/health

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
| `server.http2.enabled` | `false` | Enable HTTP/2 (requires TLS; HTTP/1.1 fallback active) |
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
| `sources.spotify.enabled` | `false` | Enable Spotify source |
| `sources.spotify.market` | `US` | ISO country code for catalog lookups |
| `sources.spotify.playlistLoadLimit` | `100` | Max tracks from a playlist |
| `sources.spotify.albumLoadLimit` | `50` | Max tracks from an album |
| `sources.spotify.preferAnonymousToken` | `true` | Use anonymous TOTP token (no credentials needed) |
| `sources.spotify.clientId` | `""` | OAuth2 client ID — more stable than anonymous token |
| `sources.spotify.clientSecret` | `""` | OAuth2 client secret — required with clientId |
| `sources.spotify.customTokenEndpoint` | `""` | Custom URL to fetch Spotify token |
| `sources.spotify.sp_dc` | `""` | Spotify session cookie (enables lyrics) |
| `routePlanner.enabled` | `false` | Enable IP rotation |
| `routePlanner.ipPool` | `[]` | List of outbound IPs to rotate between |
| `routePlanner.strategy` | `RotateOnBan` | `RotateOnBan` \| `LoadBalance` \| `NanoSwitch` |
| `routePlanner.cooldownMs` | `600000` | How long a banned IP stays blocked (ms) |

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

### Spotify setup

Spotify works out of the box with anonymous TOTP — no credentials required:

```ts
spotify: {
  enabled: true,
}
```

For a more stable connection, use OAuth2 credentials from the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):

```ts
spotify: {
  enabled: true,
  preferAnonymousToken: false,
  clientId: 'your_client_id',
  clientSecret: 'your_client_secret',
}
```

Or point to a custom token endpoint (e.g. self-hosted proxy):

```ts
spotify: {
  enabled: true,
  customTokenEndpoint: 'https://your-token-server.example.com/spotify/token',
}
```

#### Spotify search prefixes

| Prefix | Description |
|---|---|
| `spsearch:<query>` | Search tracks by name/artist |
| `sprec:<genres>` | Recommendations by genre — e.g. `sprec:pop` |
| `sprec:<seed params>` | Full recommendations — e.g. `sprec:seed_genres=pop&seed_artists=ID&limit=10` |

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
| `GET` | `/v4/routeplanner/status` | Route planner status and failing addresses |
| `POST` | `/v4/routeplanner/free/address` | Unban a specific IP address |
| `POST` | `/v4/routeplanner/free/all` | Unban all addresses |

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
| Spotify | ✅ Ready | `spsearch:` `sprec:` | Anonymous TOTP or OAuth2. Recommendations, ISRC-first resolve. Streams delegated to SoundCloud/Deezer |
| YouTube | 🔜 Planned | `ytsearch:` | — |

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
│   ├── health.ts           # GET /v4/health
│   ├── lyrics.ts           # GET /v4/sessions/:id/players/:id/track/lyrics
│   ├── lyricsSubscribe.ts  # GET /v4/sessions/:id/players/:id/lyrics/subscribe (SSE)
│   ├── metrics.ts          # GET /v4/metrics (Prometheus)
│   ├── meaning.ts          # GET /v4/meaning
│   ├── players.ts          # Session/player CRUD
│   ├── router.ts           # Central request router
│   ├── routePlanner.ts     # GET/POST /v4/routeplanner/*
│   └── tracks.ts           # encode/decode endpoints
├── core/
│   ├── RoutePlanner.ts     # IP rotation pool with strategy + ban management
│   ├── SessionManager.ts   # Session + player state
│   ├── TokenStore.ts       # AES-256-GCM encrypted token store (Spotify, Deezer, etc.)
│   ├── TrackCache.ts       # AES-256-GCM encrypted track cache with LRU eviction
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
│   ├── soundcloud.ts       # SoundCloud source
│   └── spotify.ts          # Spotify source
├── typings/
│   ├── index.ts            # Shared TypeScript interfaces
│   ├── tokenStore.ts       # TokenStore entry/payload/stats interfaces
│   └── trackCache.ts       # TrackCacheEntry interface
├── utils/
│   ├── http.ts             # Native HTTP client
│   ├── logger.ts           # Colored logger with file rotation
│   ├── rateLimit.ts        # Per-IP sliding window rate limiter
│   ├── spotifyAuth.ts      # Spotify token manager (anonymous / OAuth2 / custom endpoint)
│   └── track.ts            # Lavalink v4 track encode/decode
├── index.ts                # Entry point
├── server.ts               # HTTP + WebSocket server (HTTP/1.1, HTTPS, HTTP/2)
└── worker.ts               # Source worker process (isolates search/load from audio loop)
```

---

## Contributing

- `v1` — current stable version
- `dev` — development / community PRs

PRs are welcome on the `dev` branch.

---

## License

[MIT](./LICENSE) © AurisLink Contributors
