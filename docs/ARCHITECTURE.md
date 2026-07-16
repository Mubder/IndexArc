# IndexArc — Architecture & Data Model

A deep dive into how IndexArc is structured internally: the process model, where data lives and how that location is kept stable, the encryption scheme, on-disk formats, backups, the AI provider abstraction, and the defense-in-depth data-safety design.

- [Process model](#process-model)
- [Portable root resolution](#portable-root-resolution)
- [On-disk layout & file formats](#on-disk-layout--file-formats)
- [Encryption](#encryption)
- [VaultStore (persistence)](#vaultstore-persistence)
- [Automatic backups](#automatic-backups)
- [AI provider abstraction](#ai-provider-abstraction)
- [Search: hybrid keyword + semantic](#search-hybrid-keyword--semantic)
- [Folder scanning & watching](#folder-scanning--watching)
- [Electron shell](#electron-shell)
- [Data types](#data-types)
- [Data-safety design](#data-safety-design)

---

## Process model

IndexArc is a two-process application:

1. **Backend** — an Express server (`server.ts`, bundled to `dist/server.cjs`). Owns all data, encryption, AI calls, and the filesystem. Binds `127.0.0.1` only.
2. **Frontend** — a React SPA (`src/`) that talks to the backend exclusively over HTTP `/api/*`.

In the **desktop app**, a third piece — the **Electron main process** (`electron-main.cjs`) — `fork()`s the backend, waits for `GET /api/ping`, then loads the UI in a `BrowserWindow`. In the **web app**, the backend serves the UI itself (Vite middleware in dev, static `dist/` in production).

This separation means the UI has no direct access to secrets on disk or to AI keys; everything is mediated by the API and the vault-lock middleware.

---

## Portable root resolution

All user data lives under a single **portable root**. Keeping that root **stable across launches, updates, and folder moves** is central to the design, so the resolution logic exists in two mirrored places:

- `server/paths.ts` → `getAppRoot()` (server side)
- `electron-main.cjs` → `getPortableRoot()` (Electron side, authoritative; passes the result to the server via `INDEXARC_ROOT`)

### Electron: `getPortableRoot()` priority chain

1. **`INDEXARC_ROOT` env** — explicit override always wins. It is resolved, **persisted** (`savePortableRoot`), and returned.
2. **Dev Electron** (`!app.isPackaged`) — returns `cwd/.desktop-sandbox` so the real project vault is never touched during development.
3. **Restored root** (`loadPortableRoot()`) — a root persisted by a previous run. If it still holds data, it is reused. **This is what makes updates/reinstalls safe.**
4. **First real run** — `exeDir = dirname(process.execPath)`. A `.indexarc-write-test` probe checks writability; if writable, the root is the exe folder (USB-portable), otherwise it falls back to `app.getPath("userData")`.
5. **Migration safety** — if the chosen root has **no** existing vault, `findExistingVaultRoot` probes alternative locations (previous install dir from registry `InstallLocation`, `userData`, `~/.IndexArc`, the AppData marker's parent) and adopts whichever already contains a **non-empty** `data/vault.json`. Finally the chosen root is persisted.

### Persistence: registry + marker

`savePortableRoot(root)` writes the root to **both**:
- **Windows registry** — `HKCU\Software\IndexArc` value `Root` (via `reg add ... REG_SZ`).
- **AppData marker** — `%APPDATA%\IndexArc\vault-root.json` (`{ root, savedAt }`).

`loadPortableRoot()` reads them back in that order, validating that the path still exists. Both locations are **never touched by the installer**, so they survive reinstalls.

### Server mirror: `getAppRoot()`

```
INDEXARC_ROOT env
  → (production only) loadPersistedRoot()   # registry Root, then AppData marker
    → INDEXARC_DIST_DIR  → parent of dist/  # packaged layout ROOT/dist + ROOT/data
      → process.cwd()                        # dev / tsx
```

Since Electron always passes `INDEXARC_ROOT`, the persisted-root branch only matters when the server is launched standalone — keeping even that path stable.

### Layout creation: `ensurePortableLayout()`

Creates (if missing) `data/`, `config/`, `logs/`, `tmp/`, `backups/` and returns a `PortablePaths` object with resolved file paths (`vaultFile`, `vectorsFile`, `settingsFile`, `watchedFoldersFile`, `scanSessionsFile`) plus the directory paths.

---

## On-disk layout & file formats

```
<root>/
├── data/
│   ├── vault.json            # entries (VaultFile)
│   ├── vectors.json          # embeddings (VectorsFile)
│   ├── watched_folders.json  # { version, folders: WatchedFolder[] }
│   └── scan_sessions.json    # { version, sessions: FolderScanSession[] } (last 20)
├── config/
│   └── settings.json         # AppSettings
├── backups/
│   ├── vault-<stamp>.json     # timestamped copies (last 10)
│   └── vectors-<stamp>.json
├── logs/
└── tmp/
```

### Plaintext shapes

```jsonc
// vault.json
{ "version": 1, "entries": [ /* VaultEntry[] */ ] }

// vectors.json
{ "version": 1, "chunks": [ /* VectorChunk[] */ ] }
```

### Encrypted envelope

When encryption is enabled, `vault.json` and `vectors.json` instead hold an envelope:

```jsonc
{
  "version": 1,
  "encrypted": true,
  "salt": "<hex>",
  "iv": "<hex>",        // 12-byte GCM nonce
  "authTag": "<hex>",   // GCM integrity tag
  "ciphertext": "<hex>"
}
```

The `encrypted: true` flag is how the store detects, on read, whether decryption is required.

---

## Encryption

Implemented in `server/crypto.ts` using **AES-256-GCM** (authenticated encryption).

| Parameter | Value |
|-----------|-------|
| Cipher | `aes-256-gcm` |
| Key length | 32 bytes (256-bit) |
| Key derivation | PBKDF2, **100,000** iterations, SHA-256 |
| Salt | 16 random bytes (hex), stored per file |
| IV / nonce | 12 random bytes per encryption (hex) |
| Auth tag | GCM tag from `cipher.getAuthTag()` (hex) |

- **`deriveKey(password, saltHex)`** → `pbkdf2Sync(password, salt, 100000, 32, "sha256")`.
- **`generateSalt(16)`** → random hex salt.
- **`encryptString(text, key)`** → fresh 12-byte IV, AES-256-GCM encrypt, return `{ iv, authTag, ciphertext }` (all hex).
- **`decryptString(ciphertext, key, iv, authTag)`** → sets the auth tag and decrypts; a wrong key or tampered data throws during `final` (GCM integrity check).

The **salt is stored per file** and **reused on re-encryption** so the derived key stays stable across writes for a given password.

> There is no key escrow or recovery. Losing the master password means encrypted data cannot be decrypted.

---

## VaultStore (persistence)

`server/store.ts` — the `VaultStore` class is the single persistence layer. It holds a `PortablePaths` and an in-memory `encryptionKey: Buffer | null`.

### Atomic writes

`atomicWrite(filePath, data)`:
1. Ensure the parent directory exists.
2. Write to a temp file `.{basename}.{pid}.tmp` in the same directory.
3. `fs.renameSync` to the final path — an atomic replace on the same filesystem.

A crash mid-write therefore never leaves a half-written `vault.json`. `readJson<T>` tolerates missing/corrupt files by returning a fallback.

### Encryption interaction

| Method | Behavior |
|--------|----------|
| `isEncryptionEnabled()` | On-disk vault has `encrypted: true`. |
| `isLocked()` | Encryption enabled **and** no in-memory key. |
| `unlock(password)` | Derive key from stored salt, decrypt, `JSON.parse` to verify, store key. Returns `false` on failure. |
| `lock()` | Null the in-memory key. |
| `setupPassword(password)` | Throws if already encrypted; generate salt, derive+store key, re-write vault + vectors encrypted. |
| `removePassword(password)` | Decrypt with password, re-write both files as **plaintext**, null the key. |

`readVault`/`readVectors` decrypt transparently when the on-disk file is encrypted (throwing "Vault is locked" if no key). `writeVault`/`writeVectors` re-encrypt when a key is set or the file was already encrypted (reusing the stored salt), otherwise write plaintext.

### Entry & vector operations

- Entries: `listEntries(filter)`, `getEntry`, `getNeedsAttention`, `createEntry` (assigns `randomUUID` + timestamps, `unshift`s), `updateEntry` (preserves id/created_at, bumps `updated_at`), `deleteEntry` (also removes vectors), `bulkDeleteEntries`, `stats`.
- Vectors: `upsertVector` (replace by `id`/`entry_id`), `removeVectorsForEntry`, `allVectors`.
- Watched folders & scan sessions: dedicated read/write helpers; scan sessions trimmed to the **last 20**.

---

## Automatic backups

`VaultStore.backupVault(keep = 10)` runs on **every server startup** (invoked from `server.ts`):

1. Read the raw bytes of `vault.json`; skip if missing or empty.
2. **Dedup:** compare against the newest existing `vault-*.json` backup; if identical (`Buffer.equals`), do nothing (avoids churn on restarts when nothing changed).
3. Write `backups/vault-<stamp>.json` where the stamp is an ISO timestamp with `:`/`.` replaced and `Z` stripped (e.g. `vault-2026-07-16_22-20-24-722.json`).
4. Best-effort also snapshot `vectors-<stamp>.json` (same stamp) if non-empty.
5. `pruneBackups(keep)` deletes oldest until at most `keep` of each prefix remain.

Backups copy **raw on-disk bytes**, so an **encrypted vault stays encrypted** in its backups. `listBackups()` returns `[{ name, size, created_at }]` newest-first and is exposed via `GET /api/backups`.

---

## AI provider abstraction

`server/ai/providers.ts` abstracts all AI behind a provider model. `AIProviderMode` is one of: `auto | local | api | openai | groq | openrouter | anthropic | local_openai`.

- **`resolveActiveProvider(settings)`** picks the effective provider. `auto` prefers **Ollama → Gemini → other configured providers → heuristic**.
- **Ollama** (local, HTTP): `checkOllama`, generate, embed, warm/load into VRAM, `pullOllamaModel`.
- **Gemini** (`@google/genai`): embeddings + generation.
- **OpenAI-compatible** (OpenAI/Groq/OpenRouter/local OpenAI): chat + embeddings.
- **Anthropic**: generation.
- **`analyzePaste()`** always starts from the deterministic heuristic baseline (`server/ai/heuristics.ts`) and **merges** LLM classification on top — so extraction degrades gracefully to heuristics-only.
- **`generateText()`** backs Ask answers and Rewrite. `cosineSimilarity` supports semantic search.

The **heuristic engine** (`heuristics.ts`) is always available: regex detection of secrets (Telegram/GitHub/AWS/JWT/Google keys, high-entropy strings), commands (shell/PowerShell), and env lines; noise/section-banner filtering; title↔secret name pairing; bilingual note handling; and query-term expansion for EN/AR search.

---

## Search: hybrid keyword + semantic

`server/services/ask.ts` (`askVault`) combines two signals:

1. **Keyword scoring** — token overlap, value-fragment matches, and intent hints (e.g. distinguishing a "Telegram ID" from a "bot token").
2. **Semantic boost** — cosine similarity over embeddings, used to **re-rank** keyword hits (or surface strong pure-semantic matches).

The top matches are then passed to `generateText()` to produce a short bilingual **answer**, returned alongside ranked `EntryCard` results. Embeddings are produced when entries are indexed (`services/vault.ts` → `indexEntry`) and stored as `VectorChunk`s.

---

## Folder scanning & watching

- **`services/folderScan.ts`** (`scanFolder`) recursively walks a folder, reads and extracts text from many file types — `.txt`, `.env`, `.json`, source code, plus `.docx` (mammoth), `.pdf` (pdf-parse), `.xlsx` (xlsx). JSON is flattened. Each file is run through heuristics (or AI per file), candidates are de-duplicated and annotated with source metadata, and a `FolderScanSession` + human-readable **brief** is produced.
- **`services/folderWatcher.ts`** (`FolderWatcherManager`) sets up a debounced recursive `fs.watch` per watched folder; changed files are re-scanned and merged into the active review session. `restoreFromStore()` re-attaches watchers on startup.
- **`services/fsBrowser.ts`** powers the web folder picker: `listFsRoots()` (drive letters on Windows; `/` + home elsewhere) and `listDirectory()` (folders only). **No files are uploaded** — everything is read on the server host.

---

## Electron shell

`electron-main.cjs` (main) + `preload.cjs` (bridge).

### Backend forking
`startBackendServer()` resolves the resource path and portable root, ensures the data folders exist, then `fork()`s `dist/server.cjs` with env `PORT`, `HOST=127.0.0.1`, `NODE_ENV=production`, `INDEXARC_ROOT`, `INDEXARC_DIST_DIR`. `pollServerAndLoad` polls `GET /api/ping` (up to ~120×400ms) before loading the window.

### Tray & minimize
`createTray()` builds a tray with **Open** / **Exit**. The window `close` handler calls `preventDefault()` and hides the window (minimize-to-tray) unless `isQuiting` is set. `will-quit` destroys the tray and kills the server child. On non-macOS, `window-all-closed` keeps the app alive in the tray.

### Ollama IPC
- `check-ollama-installed` — locate `ollama.exe` (LOCALAPPDATA/PROGRAMFILES/PROGRAMFILES(X86)/`where`).
- `install-ollama` — download `OllamaSetup.exe` and run a silent `/S` install.
- `start-ollama` — ping `127.0.0.1:11434/api/tags`; if down, `spawn(... "serve")` detached.
- `open-external` — `shell.openExternal(url)`.
- `startOllamaIfNeeded()` runs at app `ready`.

### Spellcheck & security
The window enables `spellcheck: true` with `contextIsolation: true`, `nodeIntegration: false`, and the preload script. `preload.cjs` exposes only: `selectFolder`, `isElectron`, `checkOllamaInstalled`, `installOllama`, `startOllama`, `openExternal`.

---

## Data types

Authoritative types are in `server/types.ts`; `src/types.ts` mirrors them for the frontend.

### `VaultEntry`
`id`, `value`, `type` (freeform), `name` (required for secrets), `raw_fragment`, `paste_id?`, `labels: string[]`, `type_aliases: string[]`, `status`, `family`, `created_at`, `updated_at`, `notes?`, `source_file?`.

- **`status`**: `saved | needs_name | needs_type | needs_review`
- **`family`**: `secret | command | note | unknown`

### `VectorChunk`
`id`, `entry_id`, `text`, `embedding: number[] | null`, `metadata: { name, type, family, value_preview }`.

### `AppSettings`
`ai_provider: AIProviderMode`, Ollama base URL + LLM/embed models, per-provider API keys + models (Gemini/OpenAI/Groq/OpenRouter/Anthropic), local OpenAI base/key/model, `ui_language: "en" | "ar"`, `bind_host`, `port`. `DEFAULT_SETTINGS` sets `port: 3000`, `bind_host: "127.0.0.1"`, `ollama_llm_model: "qwen2.5:0.5b"`, etc.

### `FolderScanSession`
`id`, `folder_path`, timestamps, `status: review | committed | discarded`, `watching`, `summary`, `processed_files`, `skipped_files`, `candidates: AnalyzeCandidate[]`, `brief`.

### `WatchedFolder`
`id`, `path`, `watching`, `last_scan_id?`, `last_scan_at?`, `created_at`.

### `AnalyzeCandidate`
`temp_id`, `value`, `type`, `name`, `raw_fragment`, `labels`, `type_aliases`, `family`, `confidence`, `needs_type`, `needs_name`, `ready`, `model_notes?`, `source_file?`, `source_name?`, `decision?`.

### Frontend `Tab`
`home | paste | scratchpad | folders | library | ask | settings | logs`.

---

## Data-safety design

Defense-in-depth ensures user secrets survive updates, reinstalls, USB relocation, and crashes — without admin rights:

1. **Registry-persisted root** — the vault location is saved to `HKCU\Software\IndexArc\Root` (+ AppData marker) and restored on every launch, so it's stable across updates.
2. **NSIS reuses `InstallLocation`** — `build/installer.nsh` reads the previous install dir on update so it lands in the **same folder** (finding the existing `data/`); only the first install falls back to `%PROFILE%\.IndexArc`. It also writes `InstallLocation` for future updates.
3. **Runtime-created dirs excluded from the package/uninstaller** — `data/`, `config/`, `logs/`, `backups/` are created by the app at runtime, never by the installer, and the uninstaller leaves them behind.
4. **Migration safety** — if a freshly chosen root has no vault, the app adopts a prior location that does (previous install dir, `userData`, `~/.IndexArc`, marker parent).
5. **Automatic backups** — timestamped, de-duplicated, last-10 retained; encrypted vaults stay encrypted.
6. **Atomic writes** — temp file + rename prevents mid-write corruption.
7. **Dev isolation** — dev Electron uses `.desktop-sandbox/`, never the real project vault.

See [Build & Release → Data safety on update / reinstall](./BUILD_AND_RELEASE.md#data-safety-on-update--reinstall) for the packaging side.
