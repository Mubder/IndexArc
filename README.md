# IndexArc Vault

**Portable personal vault** — paste secrets, API keys, tokens, commands, and notes. The app multi-extracts values, requires a **name** for every secret, parks unidentified items until you label them, and answers questions in **English and Arabic**.

All data stays in **one folder** (USB-safe). Copy the whole directory anywhere and run.

## Features

| Capability | Behavior |
|------------|----------|
| Multi-extract | One paste (e.g. full `.env`) → many candidates |
| Smart types | Freeform types (`telegram user id`, `Hermes profile id`, …) |
| Always named | Every secret/token gets a name (model or you) |
| Unidentified inbox | Incomplete items wait on Home for type/name |
| Ask AR/EN | “Telegram ID” / “معرف تيليجرام” / “bot mybot_1 token” |
| AI mode | **Local (Ollama)** or **API (Gemini)** or **Auto** — your choice |
| Portable | `data/` + `config/` next to the app — no AppData dependency |

## Folder layout

```
IndexArc/                 ← copy this whole folder to USB
├── data/                 ← vault.json + vectors (your secrets)
├── config/               ← settings.json (AI mode, API key)
├── logs/
├── dist/                 ← built app (after npm run build)
├── electron-main.cjs
└── package.json
```

## Run locally (dev)

**Prerequisites:** Node.js 18+

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

### Optional AI

- **Local:** install [Ollama](https://ollama.com), pull e.g. `qwen2.5:0.5b` and `nomic-embed-text`. Set provider to **Local** in Settings.
- **API:** set Gemini API key in Settings (stored in `config/settings.json` inside the portable folder). Or set env `GEMINI_API_KEY` for dev.

Without either backend, **heuristics** still parse `.env` lines, Telegram-style IDs, bot tokens, commands, and notes.

## Desktop app (Windows now · macOS/Linux next)

```bash
npm run desktop          # Electron shell (dev)
npm run desktop:win      # Windows: portable .exe + installer
npm run desktop:mac      # macOS .dmg (run on a Mac)
npm run desktop:linux    # Linux AppImage (run on Linux)
```

| Output | Path |
|--------|------|
| Portable Windows | `dist-desktop/IndexArc-Portable-2.0.0.exe` |
| Windows installer | `dist-desktop/IndexArc-Setup-2.0.0.exe` |

Packaged builds write vault data next to the executable (`data/`, `config/`). See [DESKTOP_BUILD_GUIDE.md](./DESKTOP_BUILD_GUIDE.md).

## Core workflow

1. **Paste** anything (single key, `.env`, shell command, note).
2. **Analyze** → review candidates; edit freeform **type** and **name**.
3. **Save** ready items, or **Park incomplete** → Unidentified on Home.
4. **Identify** parked secrets when you know what they are.
5. **Ask** in English or Arabic for lists or named lookups.

## Environment (optional)

| Variable | Purpose |
|----------|---------|
| `INDEXARC_ROOT` | Force portable root path |
| `GEMINI_API_KEY` | Cloud API key (dev override) |
| `PORT` | Server port (default 3000) |
| `HOST` | Bind address (default `127.0.0.1`) |

## Security notes

- Values are masked in the UI by default; use reveal/copy.
- Server binds to **localhost** only.
- Treat `data/vault.json` as sensitive — encrypt the USB or the file if needed.
- Logs never intentionally store full secret values.

## License

Private project.
