<div align="center">
  <img src="./images/logo.png" alt="AurisLink" width="120"/>
  <h1>AurisLink</h1>
  <p><strong>A high-performance, Lavalink v4-compatible audio server</strong> written in TypeScript / Node.js</p>
  
  ![version](https://img.shields.io/badge/version-1.6.0-a78bfa?style=flat-square) 
  ![node](https://img.shields.io/badge/node-20+-339933?style=flat-square&logo=node.js&logoColor=white) 
  ![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
  ![typescript](https://img.shields.io/badge/typescript-5.0+-3178c6?style=flat-square&logo=typescript&logoColor=white)
  
  [📖 Documentation](https://aurislink-docs.vercel.app) • [🚀 Quick Start](#quick-start) • [💻 GitHub](https://github.com/ProjectInkDp/aurislink) • [📝 License](./LICENSE)
</div>

---

## About AurisLink

**AurisLink** is a lightweight yet powerful audio streaming server that implements the [Lavalink v4 REST + WebSocket protocol](https://lavalink.dev/api/rest). It's designed to be a drop-in replacement for Lavalink, meaning any existing Lavalink client (Shoukaku, Lavalink.js, Magmastream, etc.) works without any modifications.

Whether you're building a Discord music bot, streaming application, or any audio-driven service, AurisLink provides the performance and flexibility you need.

---

## ✨ Key Features

### Performance & Efficiency
- **Lightweight footprint** — ~43 MB idle (tsx) / ~30 MB compiled
- **Low resource usage** — runs comfortably on low-end servers, VPS, and even Android via Termux
- **HTTP/2 support** — with TLS and HTTP/1.1 fallback for maximum compatibility
- **Native TLS** — HTTPS out of the box

### Audio Sources
- **SoundCloud** — auto client_id refresh, stream URL cache with TTL, 401 retry
- **Deezer** — search, metadata, and full 320kbps streams with ARL + Blowfish decryption
- **Spotify** — anonymous TOTP auth, OAuth2, custom token endpoint, recommendations, ISRC-first resolution
- **JioSaavn** — search, resolve, 320kbps stream with DES/ECB decryption and proxy support

### Advanced Features
- **Track cache** — AES-256-GCM encrypted on-disk cache for resolved track metadata with LRU eviction
- **Token store** — AES-256-GCM encrypted on-disk store for service tokens; survives restarts
- **Lyrics support** — synced + plain text, SSE real-time stream
- **Track metadata** — bio, tags, year, listener count via Wikipedia, MusicBrainz, Last.fm
- **Audio filters** — equalizer, timescale, tremolo, vibrato, rotation, channelMix, lowPass, echo, reverb
- **IP Route Planner** — RotateOnBan, LoadBalance, NanoSwitch strategies
- **Rate limiting** — per-IP DoS protection with sliding-window rate limiter

### Reliability & Monitoring
- **Prometheus metrics** — at `/v4/metrics` for comprehensive monitoring
- **Health check** — at `/v4/health` for load balancer integration
- **Graceful shutdown** — clean session teardown on SIGINT/SIGTERM
- **TrackStuck watchdog** + **zombie player cleanup**
- **File logging** — with daily rotation and TTL configuration
- **Source worker** — search/load runs in isolated process, keeping audio loop clean

### Developer-Friendly
- **Lavalink v4 compatible** — drop-in replacement, no client changes needed
- **TypeScript** — fully typed codebase for better IDE support
- **REST + WebSocket** — standard protocols for easy integration
- **Comprehensive logging** — debug, info, warn, error levels with timestamps

---

## 📋 Requirements

- **Node.js** 20.0.0 or higher
- **npm** 9.0.0 or higher
- **Disk space** for track cache and token store (configurable)

---

## 🚀 Quick Start

### Installation

#### Linux / macOS / Windows WSL
```bash
# Clone the repository
git clone https://github.com/ProjectInkDp/aurislink.git
cd aurislink

# Install dependencies
npm install

# Copy and configure
cp config.default.ts config.ts

# Start the server
npm start
```

#### Compiled Version (Lower Memory)
```bash
npm run build
npm run start:dist
```

#### Docker
```bash
docker build -t aurislink .
docker run -p 2333:2333 -v ./config.ts:/app/config.ts aurislink
```

Or with docker-compose:
```bash
docker compose up -d
```

#### PM2 (Production)
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

#### Termux (Android)
```bash
cd ~
unzip /sdcard/Download/aurislink.zip
cd aurislink
npm install
npm start
```

### Verify Installation

```bash
# Check server info
curl -H "Authorization: youshallnotpass" http://localhost:2333/v4/info

# Expected response:
# {
#   "version": "1.6.0",
#   "buildLine": 1234,
#   "git": { "branch": "main", "commit": "abc123", ... },
#   ...
# }
```

---

## ⚙️ Configuration

AurisLink uses a TypeScript configuration file (`config.ts`) for all settings. Here's a minimal example:

```typescript
const config = {
  server: {
    host: '0.0.0.0',
    port: 2333,
    password: 'youshallnotpass',
    tls: { 
      enabled: false, 
      cert: '', 
      key: '' 
    },
  },
  logging: {
    level: 'info',
    timestamps: true,
    colors: true,
  },
  sources: {
    soundcloud: { 
      enabled: true, 
      clientId: '' 
    },
    deezer: { 
      enabled: true, 
      arl: '', 
      decryptionKey: '' 
    },
    spotify: { 
      enabled: true, 
      clientId: '', 
      clientSecret: '' 
    },
    jiosaavn: { 
      enabled: true 
    },
  },
};

export default config;
```

For detailed configuration options, see the [Configuration Guide](https://aurislink-docs.vercel.app/docs/configuration).

---

## 📚 Documentation

Complete documentation is available at **[aurislink-docs.vercel.app](https://aurislink-docs.vercel.app)**

- **[Getting Started](https://aurislink-docs.vercel.app/docs/getting-started)** — Installation and setup guide
- **[Configuration](https://aurislink-docs.vercel.app/docs/configuration)** — All configuration options explained
- **[API Reference](https://aurislink-docs.vercel.app/docs/api)** — REST API and WebSocket documentation
- **[Audio Sources](https://aurislink-docs.vercel.app/docs/sources)** — How to configure each audio source
- **[Audio Filters](https://aurislink-docs.vercel.app/docs/filters)** — Available audio effects and filters

---

## 🔌 API Usage

### REST API Example

```bash
# Get server info
curl -H "Authorization: youshallnotpass" \
  http://localhost:2333/v4/info

# Load tracks
curl -H "Authorization: youshallnotpass" \
  "http://localhost:2333/v4/loadtracks?identifier=ytsearch:never%20gonna%20give%20you%20up"

# Create a player session
curl -X POST \
  -H "Authorization: youshallnotpass" \
  http://localhost:2333/v4/sessions/my-session

# Update player
curl -X PATCH \
  -H "Authorization: youshallnotpass" \
  -H "Content-Type: application/json" \
  -d '{"track":{"encoded":"..."},"volume":100}' \
  http://localhost:2333/v4/sessions/my-session/players/guild-id
```

### WebSocket Connection

```javascript
const ws = new WebSocket('ws://localhost:2333/v4/websocket', {
  headers: {
    'Authorization': 'youshallnotpass'
  }
});

ws.on('message', (data) => {
  const event = JSON.parse(data);
  console.log('Event:', event.op, event);
});
```

For more examples and detailed API documentation, visit the [API Reference](https://aurislink-docs.vercel.app/docs/api).

---

## 🎵 Supported Audio Sources

| Source | Status | Features |
|--------|--------|----------|
| **SoundCloud** | ✅ Supported | Search, metadata, streaming |
| **Deezer** | ✅ Supported | Search, 320kbps streams, metadata |
| **Spotify** | ✅ Supported | Search, playlists, recommendations |
| **JioSaavn** | ✅ Supported | Search, 320kbps streams |
| **YouTube** | ✅ Supported | Search, playlists, streams |

---

## 🎚️ Audio Filters

AurisLink supports a wide range of audio filters for professional audio processing:

- **Equalizer** — Adjust frequency bands (10 bands)
- **Timescale** — Speed and pitch control
- **Tremolo** — Amplitude modulation
- **Vibrato** — Frequency modulation
- **Rotation** — Stereo rotation effect
- **Channel Mix** — Mix stereo channels
- **Low Pass** — Remove high frequencies
- **Echo** — Add echo/delay effect
- **Reverb** — Add reverb effect
- **Volume** — Adjust output volume

---

## 🛠️ Development

### Project Structure

```
aurislink/
├── src/
│   ├── sources/          # Audio source implementations
│   ├── filters/          # Audio filter implementations
│   ├── playback/         # Playback engine
│   ├── utils/            # Utility functions
│   ├── typings/          # TypeScript type definitions
│   ├── server.ts         # HTTP server setup
│   └── index.ts          # Entry point
├── config.default.ts     # Default configuration
├── package.json
├── tsconfig.json
└── README.md
```

### Building from Source

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run compiled version
npm run start:dist

# Development mode with hot reload
npm run dev
```

### Testing

```bash
# Run tests
npm test

# Run tests with coverage
npm test -- --coverage
```

---

## 📊 Monitoring

### Prometheus Metrics

Access metrics at `http://localhost:2333/v4/metrics` for integration with Prometheus, Grafana, and other monitoring tools.

### Health Check

Use `http://localhost:2333/v4/health` for load balancer health checks.

---

## 🚀 Deployment

### Production Recommendations

1. **Use compiled version** — Lower memory footprint
2. **Enable TLS** — Secure connections
3. **Configure rate limiting** — Protect against abuse
4. **Set up monitoring** — Use Prometheus metrics
5. **Use PM2** — Process management and auto-restart
6. **Configure logging** — File logging with rotation

### Example PM2 Configuration

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'aurislink',
    script: './dist/index.js',
    instances: 1,
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

### Guidelines

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.

---

## 🙏 Acknowledgments

- Built with [Node.js](https://nodejs.org/) and [TypeScript](https://www.typescriptlang.org/)
- Inspired by [Lavalink](https://lavalink.dev/)
- Audio processing powered by [Lavaplayer](https://github.com/lavalink-devs/Lavalink)

---

## 📞 Support

- **Documentation** — [aurislink-docs.vercel.app](https://aurislink-docs.vercel.app)
- **Issues** — [GitHub Issues](https://github.com/ProjectInkDp/aurislink/issues)
- **Discussions** — [GitHub Discussions](https://github.com/ProjectInkDp/aurislink/discussions)

---

<div align="center">
  <p>Made with ❤️ by <a href="https://github.com/ProjectInkDp">ProjectInkDp</a></p>
  <p><a href="https://github.com/ProjectInkDp/aurislink">⭐ Star us on GitHub</a></p>
</div>
