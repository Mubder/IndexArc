# IndexArc — Developer Guide

For contributors working on the IndexArc codebase.

- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Prerequisites](#prerequisites)
- [Development workflow](#development-workflow)
- [How the pieces fit](#how-the-pieces-fit)
- [Frontend (src/)](#frontend-src)
- [Backend (server/)](#backend-server)
- [Electron shell](#electron-shell)
- [Configuration files](#configuration-files)
- [Adding a feature](#adding-a-feature)
- [Coding conventions](#coding-conventions)
- [Testing & verification](#testing--verification)

See also: [Architecture & Data Model](./ARCHITECTURE.md) · [API Reference](./API_REFERENCE.md) · [Build & Release](./BUILD_AND_RELEASE.md).

---

## Tech stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React + React DOM | ^19.0.1 |
| Bundler / dev server | Vite (`@vitejs/plugin-react`) | ^6.2.3 |
| Styling | Tailwind CSS v4 (`@tailwindcss/vite`, CSS-first, **no `tailwind.config`**) | ^4.1.14 |
| Icons / animation | `lucide-react` ^0.546.0, `motion` ^12.23.24 | |
| Backend | Express | ^4.21.2 |
| Language | TypeScript (bundler resolution) | ~5.8.2 |
| Server bundling | esbuild | ^0.25.0 |
| Desktop shell | Electron | ^43.1.0 |
| Packaging | electron-builder | ^26.15.3 |
| AI | `@google/genai` ^2.4.0 (Gemini) + Ollama (HTTP) + OpenAI-compatible providers | |
| File extraction | `mammoth` (docx), `pdf-parse` (pdf), `xlsx` (xlsx) | |

The app runs in two modes from **one codebase**:
- **Web app** — `tsx server.ts` serves the Express API and (in dev) Vite middleware.
- **Desktop app** — Electron (`electron-main.cjs`) forks the bundled server (`dist/server.cjs`) and loads the UI in a `BrowserWindow`.

---

## Repository layout

```
IndexArc/
├── .github/workflows/desktop-builds.yml   # CI for desktop builds
├── assets/            # app/installer icon (icon.png)
├── build/installer.nsh  # NSIS installer customization
├── public/            # Logo1.png / Logo1.svg (served as favicon)
├── server/            # Express + AI backend (TypeScript)
│   ├── ai/            # heuristics.ts, providers.ts
│   ├── services/      # vault.ts, ask.ts, folderScan.ts, folderWatcher.ts, fsBrowser.ts
│   ├── crypto.ts      # AES-256-GCM helpers
│   ├── logs.ts        # in-memory ring log
│   ├── paths.ts       # portable root resolution + layout
│   ├── store.ts       # VaultStore persistence (+ backups)
│   └── types.ts       # backend types (authoritative)
├── src/               # React frontend
│   ├── components/    # all UI components (tabs + modals + cards)
│   ├── utils/i18n.ts  # EN/AR translations
│   ├── App.tsx        # app shell & state orchestrator
│   ├── main.tsx       # React entry
│   ├── types.ts       # frontend types (mirror of server)
│   ├── utils.ts       # small helpers (maskValue, readJson, ...)
│   ├── global.d.ts    # window.electronAPI typings
│   └── index.css      # Tailwind v4 import + theme + styles
├── electron-main.cjs  # Electron main process
├── preload.cjs        # Electron preload (contextBridge → window.electronAPI)
├── server.ts          # Express server entry (routes)
├── index.html         # Vite HTML entry
├── vite.config.ts     # Vite config
├── tsconfig.json      # TypeScript config
├── package.json       # scripts + electron-builder "build" config
├── Dockerfile
├── README.md
├── SECURITY.md          # Security policy and repository cleanliness rules
├── DESKTOP_BUILD_GUIDE.md
└── docs/              # this documentation set
```

Runtime-created folders (never committed, excluded from the installer): `data/`, `config/`, `logs/`, `tmp/`, `backups/`, `dist/`, `dist-desktop/`, `.desktop-sandbox/`.

---

## Prerequisites

- **Node.js 18+**
- Windows 10/11 x64 to build the Windows targets (macOS/Linux need their respective OS or CI).
- Optional: [Ollama](https://ollama.com) and/or a cloud AI key for AI features.

```bash
npm install
```

---

## Development workflow

| Command | What it does |
|---------|--------------|
| `npm run dev` | Runs `tsx server.ts` — Express + Vite middleware at <http://127.0.0.1:3000>. Hot reload for the UI. |
| `npm run build` | `vite build` (UI → `dist/`) then esbuild bundles `server.ts` → `dist/server.cjs`. |
| `npm start` | Runs the built server (`node dist/server.cjs`). |
| `npm run lint` | `tsc --noEmit` — type-check the whole project (there is no separate ESLint). |
| `npm run desktop` | Build, then launch the Electron shell (dev). Uses an isolated `.desktop-sandbox/` vault so your real data is untouched. |
| `npm run desktop:win` | Build + electron-builder → portable `.exe` + NSIS installer. |
| `npm run desktop:pack` | Unpacked Windows folder only (`dist-desktop/win-unpacked/`). |
| `npm run clean` | Remove `dist/` and `dist-desktop/`. |

> **`npm run lint` is the primary verification gate.** Always run it before finishing a change. Also validate the Electron entry points with `node --check electron-main.cjs` and `node --check preload.cjs` after editing them.

Environment variables (all optional):

| Variable | Purpose |
|----------|---------|
| `INDEXARC_ROOT` | Force the portable data root. |
| `INDEXARC_DIST_DIR` | Location of built UI/server assets (set by Electron). |
| `PORT` | Server port (default 3000). |
| `HOST` | Bind address (default `127.0.0.1`). |
| `NODE_ENV` | `production` in packaged builds. |
| `GEMINI_API_KEY` / `OPENAI_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `ANTHROPIC_API_KEY` | Dev overrides for provider keys. |
| `DISABLE_HMR` | Disables Vite file watching (used by editing agents). |

---

## How the pieces fit

```
                         ┌──────────────────────────────────────────┐
                         │              Electron main                │
                         │            (electron-main.cjs)            │
                         │  • resolves portable root                 │
                         │  • fork()s dist/server.cjs                │
                         │  • tray, Ollama IPC, spellcheck           │
                         └───────────────┬──────────────────────────┘
                                         │ fork (env: INDEXARC_ROOT, PORT, ...)
                                         ▼
   Browser / BrowserWindow      ┌──────────────────────┐        ┌───────────────┐
   ┌───────────────────┐  HTTP  │   Express server     │        │  AI providers │
   │  React UI (src/)  │◀──────▶│   (server.ts)        │◀──────▶│ Ollama/Gemini │
   │  App.tsx + tabs   │ /api/* │  routes → services   │        │ OpenAI-compat │
   └───────────────────┘        │  VaultStore (store)  │        └───────────────┘
                                 └───────────┬──────────┘
                                             ▼
                                 ┌──────────────────────┐
                                 │  Portable root files  │
                                 │  data/ config/ backups│
                                 └──────────────────────┘
```

- The **UI never touches the filesystem or AI directly** — it calls the Express API over `http://127.0.0.1:PORT`.
- In dev, Vite middleware is mounted inside the same Express server; in production, Express serves the static `dist/` build and Electron loads the window only after `/api/ping` responds.

---

## Frontend (src/)

State lives primarily in **`App.tsx`**, the shell/orchestrator (~1100 lines). It owns:
- the active **tab**, **theme** (dark/light), **language**, and **vault lock** state;
- **entries**, the **attention/needs-review** inbox, **logs**, **settings**, and **toasts**;
- paste/analyze, ask, folder-scan, and fs-browser flows;
- the three modals (**Clarify**, **Confirm**, and folder browser) and re-polls `fetchAll()` every 5s.

### Key components

| File | Role |
|------|------|
| `HomeTab.tsx` | Quick-paste + inline multi-extract candidate review (type/name editors, Save/Park) + "Needs Review" inbox + recent entries. |
| `ScratchpadTab.tsx` | Multi-tab notepad (localStorage), auto-analyze, save secret/note, rephrase, rename, spellcheck. |
| `FoldersTab.tsx` | Folder scan/watch UI + review session decisions. |
| `LibraryTab.tsx` | Full vault browser, filter chips, duplicate finder, bulk delete. |
| `AskTab.tsx` | Search (hybrid) + Rewrite (style selector). |
| `SettingsTab.tsx` | Language, AI provider config, encryption setup/remove, emergency snapshots, and the **Logs** viewer section. |
| `LockScreen.tsx` | Master-password unlock screen when vault is encrypted+locked. |
| `SetupChecker.tsx` | AI/Ollama readiness banner (install/start/pull in Electron). |
| `EntryCard.tsx` | Reusable entry card (status, masked value, actions). |
| `FsBrowserModal.tsx` | Server-side folder picker (web). |
| `ClarifyModal.tsx` | Identify/clarify an entry (name/type/reveal value). |
| `ConfirmModal.tsx` | Promise-based confirmation dialog. |

### i18n
`src/utils/i18n.ts` holds a bilingual (EN/AR) dictionary and `getTranslation(settings, key)`. **Every new UI string must be added to both languages** (and use the `{model}`-style interpolation where relevant).

### Styling
Tailwind **v4** via `@tailwindcss/vite`. There is no `tailwind.config` — theme tokens (fonts, colors) are defined in `src/index.css` with `@import "tailwindcss"`, an `@theme {}` block, and CSS variables for dark/light themes.

---

## Backend (server/)

Routes are declared in **`server.ts`** and delegate to services. See the [API Reference](./API_REFERENCE.md) for the full endpoint list.

| File | Responsibility |
|------|----------------|
| `paths.ts` | Resolve the portable root (`getAppRoot`) and create the folder layout (`ensurePortableLayout`). |
| `store.ts` | `VaultStore`: atomic JSON persistence, encryption/lock, entries CRUD, vectors, watched folders, scan sessions, **backups**. |
| `crypto.ts` | AES-256-GCM: `deriveKey` (PBKDF2), `generateSalt`, `encryptString`, `decryptString`. |
| `logs.ts` | In-memory ring buffer (max 300) mirrored to console. |
| `types.ts` | Authoritative backend types + `DEFAULT_SETTINGS`. |
| `ai/heuristics.ts` | LLM-free regex extraction + query expansion (the always-on fallback). |
| `ai/providers.ts` | Provider abstraction: Ollama/Gemini/OpenAI-compat, `analyzePaste`, `generateText`, embeddings, `resolveActiveProvider`. |
| `services/vault.ts` | Analyze → candidate → save/park/clarify + indexing (embeddings). |
| `services/ask.ts` | Hybrid keyword + semantic search and answer generation. |
| `services/folderScan.ts` | Recursive folder scan + text extraction from many file types. |
| `services/folderWatcher.ts` | `fs.watch`-based live re-scan of watched folders. |
| `services/fsBrowser.ts` | Server-side directory browser (roots + list). |

The server is bundled to a single **`dist/server.cjs`** so packaged builds need no `node_modules` at runtime.

---

## Electron shell

- **`electron-main.cjs`** — main process. Resolves the portable root (with registry/marker persistence + migration safety), `fork()`s the server, creates the window after `/api/ping`, manages the **tray** and minimize-to-tray, provides **Ollama IPC** (`check-ollama-installed`, `install-ollama`, `start-ollama`, `open-external`), and enables **spellcheck**.
- **`preload.cjs`** — exposes a minimal, safe `window.electronAPI` via `contextBridge`: `selectFolder`, `isElectron`, `checkOllamaInstalled`, `installOllama`, `startOllama`, `openExternal`.

Details in [Architecture → Electron shell](./ARCHITECTURE.md#electron-shell).

---

## Configuration files

- **`tsconfig.json`** — ES2022, `moduleResolution: bundler`, `jsx: react-jsx`, `noEmit: true`, path alias `@/*` → project root, `.js`-extension imports allowed in TS.
- **`vite.config.ts`** — `react()` + `@tailwindcss/vite`, alias `@` → project root, HMR gated on `DISABLE_HMR`.
- **`package.json` → `build`** — electron-builder config (targets, `files` include/exclude, NSIS, portable). See [Build & Release](./BUILD_AND_RELEASE.md).

---

## Adding a feature

A typical end-to-end change touches these layers in order:

1. **Types** — add/adjust interfaces in `server/types.ts` (authoritative), then mirror in `src/types.ts`.
2. **Persistence** — if data is stored, add methods to `VaultStore` (`server/store.ts`) and, if a new file is needed, extend `ensurePortableLayout` in `server/paths.ts`.
3. **Service logic** — put non-trivial logic in a `server/services/*.ts` module.
4. **Route** — add the Express endpoint in `server.ts`. Decide whether it belongs behind the vault-lock middleware (`app.use` prefixes: `/api/entries`, `/api/analyze`, `/api/folders`, `/api/ask`, `/api/snippets`).
5. **Frontend** — call the endpoint from the relevant component/`App.tsx`, add UI, and register any new nav tab in the `Tab` type + sidebar.
6. **i18n** — add EN + AR strings in `src/utils/i18n.ts`.
7. **Electron (if needed)** — add an IPC handler in `electron-main.cjs` and expose it in `preload.cjs` + `src/global.d.ts`.
8. **Verify** — `npm run lint`, and `node --check` the `.cjs` files if changed.

> Follow the existing patterns and file conventions. Don't introduce a new library without confirming it's already used or truly required.

---

## Coding conventions

- **TypeScript everywhere** on the frontend and `server/` (the Electron process files are `.cjs`).
- **No comments unless they add real value** — the codebase favors self-descriptive code.
- **Zero-Secrets Compliance:** Never hardcode secrets, API keys, passwords, or personal credentials anywhere in tracked code or logs. Always use local `.env` files for developer overrides and adhere strictly to the guidelines in [SECURITY.md](../SECURITY.md).
- **Never log full secret values.** Mask in the UI (`maskValue`) and avoid writing secrets to logs.
- **Atomic writes** for any on-disk state (use `VaultStore` / `atomicWrite`).
- **Localhost only** — the server must bind `127.0.0.1`.
- Keep the **frontend free of direct filesystem/AI access**; go through the API.

---

## Testing & verification

There is currently **no automated test suite**. Verification relies on:

1. `npm run lint` (`tsc --noEmit`) — must pass with exit code 0.
2. `node --check electron-main.cjs` and `node --check preload.cjs` after editing the Electron files.
3. Manual smoke test: `npm run dev`, then hit `GET /api/ping` (expect `{"status":"ok"}`) and `GET /api/status` (confirm `portable_root`, provider state, and vault `stats`).
4. For desktop changes: `npm run desktop` (dev shell, isolated sandbox) or a full `npm run desktop:win` build.

When you add substantial logic, consider adding lightweight tests — but keep the toolchain minimal and consistent with the existing setup.
