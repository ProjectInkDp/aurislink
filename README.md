# AurisLink

> A lightweight, Lavalink v4-compatible audio server written in TypeScript / Node.js.

AurisLink speaks the [Lavalink v4 REST + WebSocket protocol](https://lavalink.dev/api/rest), so any existing Lavalink client (Shoukaku, lavalink-client, Magmastream, etc.) connects without changes.

---

## Why AurisLink?

| Feature | Lavalink | NodeLink | AurisLink |
|---|---|---|---|
| Runtime | Java / JVM | Node.js | Node.js |
| Memory (idle) | ~200 MB+ | ~50 MB | ~30 MB |
| Mobile / Termux / low-end | ❌ | ✅ | ✅ |
| SoundCloud (auto client_id refresh) | ❌ | ❌ | ✅ |
| Deezer search + resolve | ❌ | ✅ | ✅ |
| Deezer full stream (with ARL) | ❌ | ✅ | ✅ |
| JioSaavn search + resolve + stream | ❌ | ✅ | ✅ |
| Stream URL cache w/ TTL | ❌ | ❌ | ✅ |
| Lyrics (synced + plain) | ❌ | ✅ | ✅ |
| Track meaning (bio, tags, stats) | ❌ | ⚠️ Partial | ✅ |
| Audio filter pipeline (PCM) | ⚠️ Partial | ✅ | ✅ |
| Echo filter | ❌ | ❌ | ✅ ★ |
| Reverb filter | ❌ | ❌ | ✅ ★ |
| Native TLS | ❌ | ❌ | ✅ |
| File logging w/ daily rotation | ❌ | ❌ | ✅ |
| encodeTrack / decodeTracks REST | ❌ | ✅ | ✅ |
| Lavalink v4 compatible | ✅ | ✅ | ✅ |

★ AurisLink exclusive

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

---

## Quick test with curl

```sh
# Server info
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/info

# Stats
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/stats

# List active sessions (grab sessionId here)
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/sessions

# Search SoundCloud
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=scsearch:lofi"

# Search Deezer
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=dzsearch:daft punk"

# Apply filters to a player
curl -X PATCH \
  -H "Authorization: youshallnotpass" \
  -H "Content-Type: application/json" \
  -d '{"filters":{"volume":0.5,"rotation":{"rotationHz":0.2}}}' \
  "http://localhost:2333/v4/sessions/SESSION_ID/players/GUILD_ID"

# Check active filters + pipeline health
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/sessions/SESSION_ID/players/GUILD_ID/filters"

# Lyrics for the current track
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/sessions/SESSION_ID/players/GUILD_ID/track/lyrics"

# Track meaning — bio, tags, year, listeners
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/meaning?encodedTrack=BASE64_HERE&language=pt"
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
| `playerUpdateInterval` | `5000` | Player position update interval (ms) |
| `statsInterval` | `60000` | Stats broadcast interval (ms) |
| `filters.defaultVolume` | `1.0` | Default volume for every new player |
| `sources.soundcloud.clientId` | `""` | Leave empty for auto-detection |
| `sources.deezer.enabled` | `false` | Enable Deezer source |
| `sources.deezer.arl` | `""` | Deezer ARL cookie (enables full streams) |
| `sources.deezer.decryptionKey` | `""` | 16-char Blowfish key (required with ARL) |
| `sources.jiosaavn.enabled` | `false` | Enable JioSaavn source |
| `sources.jiosaavn.proxy.url` | `""` | HTTP/HTTPS proxy (useful outside India) |
| `lastFmKey` | `""` | Last.fm API key — enables listeners/playcount in `/v4/meaning` |

---

## Audio Filters

AurisLink runs a PCM filter pipeline applied to every player in priority order. Send filters via `PATCH /v4/sessions/:id/players/:guildId` with `{ "filters": { ... } }`.

| Filter | Field | Parameters | Notes |
|---|---|---|---|
| Volume | `volume` | `0.0–5.0` | 1.0 = normal |
| Equalizer | `equalizer` | `[{ band: 0-14, gain: -0.25..1.0 }]` | 15-band biquad EQ |
| Low Pass | `lowPass` | `{ smoothing: 1–100 }` | Higher = more bass |
| Timescale | `timescale` | `{ speed, pitch, rate }` | Speed/pitch shift |
| Tremolo | `tremolo` | `{ frequency, depth }` | Amplitude LFO |
| Vibrato | `vibrato` | `{ frequency, depth }` | Pitch LFO |
| Rotation | `rotation` | `{ rotationHz }` | 8D audio panning |
| Channel Mix | `channelMix` | `{ leftToLeft, leftToRight, rightToLeft, rightToRight }` | L/R routing |
| Echo | `echo` | `{ delay, feedback, mix }` | ★ AurisLink exclusive |
| Reverb | `reverb` | `{ mix, roomSize, damping }` | ★ AurisLink exclusive |

### Examples

```json
// 8D Audio
{ "filters": { "rotation": { "rotationHz": 0.2 } } }

// Nightcore-style
{ "filters": { "timescale": { "speed": 1.25, "pitch": 1.25 } } }

// Bass boost
{ "filters": { "equalizer": [{ "band": 0, "gain": 0.6 }, { "band": 1, "gain": 0.4 }] } }

// Echo
{ "filters": { "echo": { "delay": 300, "feedback": 0.4, "mix": 0.5 } } }

// Reverb
{ "filters": { "reverb": { "mix": 0.4, "roomSize": 0.7, "damping": 0.5 } } }

// Reset all filters
{ "filters": {} }
```

---

## API — Implemented Endpoints

### REST

| Method | Route | Description |
|---|---|---|
| `GET` | `/v4/info` | Server info, version, sources |
| `GET` | `/v4/stats` | Memory, CPU, player counts |
| `GET` | `/v4/sessions` | List all active sessions |
| `GET` | `/v4/loadtracks` | Search or load tracks |
| `GET` | `/v4/decodetrack` | Decode a single encoded track |
| `POST` | `/v4/decodetracks` | Decode multiple encoded tracks |
| `POST` | `/v4/encodetrack` | Encode a TrackInfo |
| `POST` | `/v4/encodetracks` | Encode multiple TrackInfo objects |
| `PATCH` | `/v4/sessions/:sessionId` | Update session resuming/timeout |
| `GET` | `/v4/sessions/:sessionId/players` | List all players in a session |
| `GET` | `/v4/sessions/:sessionId/players/:guildId` | Get a specific player |
| `PATCH` | `/v4/sessions/:sessionId/players/:guildId` | Create/update a player |
| `DELETE` | `/v4/sessions/:sessionId/players/:guildId` | Destroy a player |
| `GET` | `/v4/sessions/:sessionId/players/:guildId/filters` | Active filters + pipeline health |
| `GET` | `/v4/sessions/:sessionId/players/:guildId/track/lyrics` | Lyrics for the current track |
| `GET` | `/v4/meaning` | Track bio, tags, year, listeners |
| `GET` | `/v4/loadchapters` | Track chapters |

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

---

## Sources

| Source | Status | Search prefix |
|---|---|---|
| SoundCloud | ✅ Ready | `scsearch:` |
| Deezer | ✅ Ready | `dzsearch:` |
| JioSaavn | ✅ Ready | `jssearch:` |
| YouTube | 🔜 Planned | `ytsearch:` |
| Spotify | 🔜 Planned | `spsearch:` |

---

## Project Structure

```
src/
├── api/
│   ├── helpers.ts
│   ├── info.ts
│   ├── loadtracks.ts
│   ├── chapters.ts
│   ├── lyrics.ts
│   ├── meaning.ts
│   ├── players.ts
│   ├── router.ts
│   └── tracks.ts
├── core/
│   ├── SessionManager.ts
│   └── WebSocketManager.ts
├── decrypters/
│   ├── blowfish-cbc.ts
│   └── des-ecb.ts
├── filters/
│   ├── constants.ts
│   ├── FilterChain.ts
│   ├── volume.ts
│   ├── equalizer.ts
│   ├── lowPass.ts
│   ├── timescale.ts
│   ├── tremolo.ts
│   ├── vibrato.ts
│   ├── rotation.ts
│   ├── channelMix.ts
│   ├── echo.ts
│   └── reverb.ts
├── sources/
│   ├── deezer.ts
│   ├── jiosaavn.ts
│   └── soundcloud.ts
├── typings/
│   └── index.ts
├── utils/
│   ├── http.ts
│   ├── logger.ts
│   └── track.ts
├── index.ts
└── server.ts
```

---

## Contributing

- `v1` — current stable branch
- `dev` — development / PRs

PRs are welcome on the `dev` branch.

---

## License

[MIT](./LICENSE) © AurisLink Contributors

