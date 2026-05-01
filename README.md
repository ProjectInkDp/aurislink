<div align="center">
  <img src="./images/logo.png" alt="AurisLink" width="120"/>
  <h1>AurisLink</h1>
  <p>A high-performance, lightweight Lavalink v4 compatible server built with Node.js.</p>

  ![version](https://img.shields.io/badge/version-1.6.3--dev.9f32175-blueviolet?style=flat-square)
  ![engine](https://img.shields.io/badge/engine-AurisPlayer-a78bfa?style=flat-square)
  ![node](https://img.shields.io/badge/node-20+-339933?style=flat-square&logo=node.js&logoColor=white)
  ![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
</div>

---

## 🚀 Overview

**AurisLink** is a re-imagined audio server for Discord, designed to be a lightweight alternative to Java-based solutions. It leverages the power of the **AurisPlayer** engine to provide a seamless and efficient audio experience. It speaks the [Lavalink v4 REST + WebSocket protocol](https://lavalink.dev/api/rest), so any existing Lavalink client connects without changes.

## ✨ Key Features

- **Ultra Lightweight:** ~43 MB idle (tsx) / ~30 MB compiled — runs comfortably on low-end servers, VPS, and Android via Termux.
- **Powered by AurisPlayer:** Uses our custom, high-performance audio engine `@projectinkdp/auris-player`.
- **Multi-Source Support:** Native support for SoundCloud, Deezer (320kbps), JioSaavn, and Spotify (Anonymous/OAuth2).
- **Audio Filters:** Support for Equalizer, Timescale (Speed/Pitch), Tremolo, Vibrato, Rotation, Distortion, and more.
- **Advanced Security:** Per-IP DoS protection, multi-scope rate limiting, and encrypted on-disk cache/token store.
- **Lyrics & Metadata:** Real-time synced lyrics and rich track metadata (Wikipedia + MusicBrainz + Last.fm).

## 🛠️ Installation & Running

### Quick Start
```sh
npm install
npm run build
npm run start:dist
```

### Docker
```sh
docker build -t aurislink .
docker run -p 2333:2333 -v ./config.ts:/app/config.ts aurislink
```

## 📖 Documentation

For detailed installation guides, configuration examples, and API documentation, please visit our official documentation site:

👉 **[AurisLink Documentation](https://github.com/ProjectInkDp/aurislink-docs)**

## 🛡️ Development Guidelines

This project follows strict development guidelines to ensure code quality and originality. All contributions must be made to the `dev` branch and follow the **ProjectInkDp** standards.

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.

---

<div align="center">
  Proudly maintained by <b>ProjectInkDp</b>
</div>
