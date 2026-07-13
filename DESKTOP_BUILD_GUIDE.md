# IndexArc — Desktop builds (Windows / macOS / Linux)

IndexArc ships as an **Electron** app: local vault server + UI in one package.  
Vault data lives next to the executable (`data/`, `config/`) so the app is USB-portable.

## Prerequisites

| Platform | Requirements |
|----------|----------------|
| All | Node.js 18+ |
| Windows (this machine) | Windows 10/11 x64 |
| macOS | macOS machine (or CI) to produce signed `.dmg` |
| Linux | Linux machine (or CI) for AppImage |
| Optional AI | [Ollama](https://ollama.com) and/or Gemini API key |

```bash
npm install
```

## Development

```bash
npm run dev          # browser: http://127.0.0.1:3000
npm run desktop      # Electron shell around the built server
```

## Windows (primary)

Produces:

- `dist-desktop/IndexArc-Portable-2.0.0.exe` — single portable executable  
- `dist-desktop/IndexArc-Setup-2.0.0.exe` — installer (NSIS) with shortcuts  

```bash
npm run desktop:win
```

Or:

```bash
npm run desktop:dist
```

If packaging fails with `EBUSY` / `EPERM` under a network or locked drive (e.g. `G:\`), build to a local path:

```bash
npm run build
npx electron-builder --win portable nsis --x64 --config.directories.output=C:\Users\%USERNAME%\IndexArc-build
```

Successful Windows artifacts from the last build:

- `IndexArc-Portable-2.0.0.exe` (~99 MB) — double-click, no install  
- `IndexArc-Setup-2.0.0.exe` (~99 MB) — installer with Start Menu shortcut  

Also copied into the repo as `dist-desktop-release/` when the default `dist-desktop/` folder is locked.

### After first run (portable)

Data is created **next to the .exe**:

```
IndexArc-Portable-2.0.0.exe
data/
  vault.json
  vectors.json
config/
  settings.json
logs/
```

Copy the exe **and** those folders together when moving to a USB drive.

### Unpacked (debug)

```bash
npm run desktop:pack
# → dist-desktop/win-unpacked/IndexArc.exe
```

## macOS (later / on a Mac)

```bash
npm run desktop:mac
```

Output under `dist-desktop/`:

- `IndexArc-2.0.0-mac-x64.dmg` / `…-arm64.dmg`
- zip archives for both arches  

**Note:** Apple signing/notarization is not configured yet. For distribution outside your own Mac, add certificates under `build.mac` later.

## Linux (later / on Linux)

```bash
npm run desktop:linux
```

Output:

- `IndexArc-2.0.0-linux-x64.AppImage`
- `IndexArc-2.0.0-linux-x64.tar.gz`

## How packaging works

1. `vite build` → static UI in `dist/`
2. `esbuild` → single `dist/server.cjs` (Express + vault logic, no `node_modules` required at runtime)
3. `electron-builder` wraps Electron + `dist/` + `electron-main.cjs` + `preload.cjs`

Runtime env set by Electron:

- `INDEXARC_ROOT` → folder next to the executable (portable data)
- `INDEXARC_DIST_DIR` → packaged UI/server assets
- `NODE_ENV=production`
- Server binds `127.0.0.1` only

## Scripts reference

| Script | Purpose |
|--------|---------|
| `npm run desktop` | Dev Electron after build |
| `npm run desktop:win` | Windows portable + installer |
| `npm run desktop:mac` | macOS dmg + zip |
| `npm run desktop:linux` | Linux AppImage + tar.gz |
| `npm run desktop:dist` | Same as Windows for now |
| `npm run desktop:pack` | Unpacked Windows folder only |

## Icons (optional)

Place icons under `assets/` (used as `buildResources`):

- Windows: `icon.ico`
- macOS: `icon.icns`
- Linux: `icon.png` (512×512+)

If missing, Electron uses the default icon.

## Security notes

- UI talks only to `http://127.0.0.1`
- Treat `data/vault.json` as sensitive secrets storage
- Ollama stays optional; app runs without it (heuristics + optional Gemini API)
