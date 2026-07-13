# IndexArc Vault — Portable Desktop Build

IndexArc is a **single-folder portable app**. Vault data lives in `data/` and settings in `config/` next to the executable — copy the whole folder to a USB drive and run anywhere.

## Prerequisites

- Node.js 18+
- Optional: [Ollama](https://ollama.com) for local AI
- Optional: Gemini API key for cloud AI (Settings UI or `config/settings.json`)

## Dev

```bash
npm install
npm run dev          # http://127.0.0.1:3000
npm run desktop      # Electron + local server
```

## Production portable build

```bash
npm run desktop:dist
```

Output: `dist-desktop/` (portable exe + zip on Windows).

Packaged apps set `INDEXARC_ROOT` to the directory containing the executable so `data/` and `config/` travel with the app.

## Layout after first run

```
IndexArc/   (or next to IndexArc.exe)
├── data/vault.json
├── data/vectors.json
├── config/settings.json
├── logs/
└── …
```

## Security

- Server binds to `127.0.0.1` only
- Values masked in UI by default
- Treat `data/vault.json` as sensitive
