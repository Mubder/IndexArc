# IndexArc Documentation

**IndexArc** is a portable, local-first personal vault. Paste secrets, API keys, tokens, commands, and notes; the app multi-extracts values, requires a **name** for every secret, parks unidentified items until you label them, and answers questions in **English and Arabic** — all backed by optional local (Ollama) or cloud (Gemini/OpenAI-compatible) AI, with a deterministic heuristic fallback when no AI is available.

Everything lives in **one folder** (USB-safe), with optional AES-256-GCM encryption and automatic timestamped backups.

---

## Documentation set

| Document | Audience | What's inside |
|----------|----------|---------------|
| [User Guide](./USER_GUIDE.md) | End users | Install, unlock, paste & identify secrets, scratchpad, folder scanning, Ask, backups, tray, Ollama setup, troubleshooting |
| [Developer Guide](./DEVELOPER_GUIDE.md) | Contributors | Tech stack, project layout, dev workflow, how the Electron + Express + React pieces fit, how to add a feature, coding conventions |
| [Architecture & Data Model](./ARCHITECTURE.md) | Engineers | Process model, portable-root resolution, encryption, vault/vectors file formats, backups, AI provider abstraction, data-safety design |
| [API Reference](./API_REFERENCE.md) | Integrators | Every `/api/*` endpoint: method, path, request, response, and vault-lock behavior |
| [Build & Release](./BUILD_AND_RELEASE.md) | Maintainers / ops | Producing signed Windows/macOS/Linux builds, NSIS installer, code signing, data-safety on update/reinstall |

Root-level docs that still apply:

- [`../README.md`](../README.md) — quick project overview.
- [`../DESKTOP_BUILD_GUIDE.md`](../DESKTOP_BUILD_GUIDE.md) — original desktop build notes (superseded in detail by [Build & Release](./BUILD_AND_RELEASE.md)).

---

## At a glance

- **Type:** Electron desktop app **and** a self-hosted web app (same codebase).
- **Frontend:** React 19 + TypeScript + Vite 6 + Tailwind CSS v4.
- **Backend:** Express 4 (bundled to a single `dist/server.cjs` via esbuild).
- **Desktop shell:** Electron 43 (`electron-main.cjs` + `preload.cjs`), packaged with electron-builder.
- **AI:** Ollama (local), Gemini, and OpenAI-compatible providers (OpenAI/Groq/OpenRouter/Anthropic/local OpenAI) — with an always-on heuristic engine.
- **Storage:** JSON files under a single portable root; optional AES-256-GCM at rest; atomic writes; timestamped backups.
- **Languages:** English + Arabic UI and search.

## Quick start

```bash
npm install
npm run dev            # web app at http://127.0.0.1:3000
# or
npm run desktop        # Electron shell (dev)
npm run desktop:win    # build Windows portable .exe + NSIS installer
```

See the [Developer Guide](./DEVELOPER_GUIDE.md) for the full workflow.
