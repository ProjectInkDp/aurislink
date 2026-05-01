<p align="center">
  <img src="assets/logo.png" alt="AurisLink Logo" width="200" />
</p>

# 🚀 AurisLink

**AurisLink** is a high-performance, Lavalink-compatible audio server built for the **Auris Ecosystem**. It provides a robust and scalable solution for audio streaming, featuring a clean-room rewrite of core modules to ensure originality, performance, and technical superiority.

> [!IMPORTANT]
> **Independence Declaration:** AurisLink is an independent project. We have **no involvement, affiliation, or connection** with other projects such as NodeLink or similar TypeScript-based implementations. This project is a separate effort with its own architecture, exclusive features, and development guidelines.

## 🏗️ Architecture

The project has been deeply restructured to follow a modern and modular architecture:

- **`src/interface`**: External communication layer (API handlers and routing).
- **`src/engine`**: Core processing engine, session management, and security guards.
- **`src/providers`**: Audio and streaming source managers (Spotify, Deezer, SoundCloud, etc.).
- **`src/content`**: Metadata and lyrics providers.
- **`src/security`**: Advanced decryption and security modules.
- **`src/shared`**: Shared utilities, reporters, and media helpers.

## ✨ Exclusive Features & Technical Superiority

AurisLink goes beyond standard implementations by offering exclusive features not found in other Lavalink-compatible servers:

- **🛡️ Clean-Room Implementation**: Entirely rewritten core modules using original logic and Direct Form II DSP implementations.
- **⚡ NanoSwitch (RoutePlanner)**: An exclusive IP rotation strategy that monitors real-time latency and automatically selects the fastest outbound IP.
- **🔊 Bitcrusher Filter**: A unique Lo-Fi audio effect allowing real-time bit depth and sample rate reduction.
- **📻 ICY Metadata Support**: Native extraction of real-time song titles from live HTTP radio streams (StreamTitle).
- **📊 Integrated Dashboard**: A built-in, real-time HTML dashboard for monitoring server health, memory usage, and active player statistics.
- **🗄️ TrackCache SQL**: High-performance SQLite-backed metadata cache with hit/miss tracking and blacklist support.
- **🔐 Secure Vault**: Encrypted persistence of service tokens with automatic TTL management.

## 🛠️ Quick Start

```sh
npm install
npm run build
npm start
```

## 📜 Configuration

Copy `application.example.yml` to `application.yml` and configure your settings. The server defaults to port `2333`.

---
*Proudly maintained by **ProjectInkDp***
