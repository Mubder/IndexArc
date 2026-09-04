# IndexArc — Deep Audit Report

**Date:** 2026-09-04 · **Version audited:** 2.0.0 (main @ `6c04894`)
**Scope:** full codebase (~17k LOC: Express backend, Electron shell, React frontend, AI layer, spellcheck engines), tests, build config, docs.

**Overall verdict:** Engineering fundamentals are decent — typecheck passes, 15/15 tests pass, git hygiene is genuinely clean, atomic writes are used correctly, and the crypto primitives (AES-256-GCM, random IVs, auth tags) are applied properly. But for an app whose value proposition is "bank-grade security," the localhost API has **no authentication, no origin validation, and no CSRF protection**, meaning a malicious website open in the user's browser can exfiltrate the entire vault while it is unlocked. There are also unescaped-HTML render paths in an Electron renderer running with `sandbox: false`, and the scratchpad — where users paste secrets — is persisted in plaintext in five places *outside* the encrypted vault.

---

## 🔴 CRITICAL — Remote compromise of vault contents via browser

These three combine into one attack chain: user has IndexArc running with the vault unlocked → visits a malicious website → the website reads every secret.

### C-1. No Host/Origin validation → DNS rebinding exfiltration
`server.ts:26-36` sets security headers but never validates `req.headers.host` or `origin`, and sets no CORS policy. A page that rebinds its domain to `127.0.0.1` becomes same-origin in the browser and can `GET /api/entries` and read every secret in plaintext. No auth token exists on any endpoint — the only gate, `checkVaultUnlocked` (`server/routes/vault.ts:99-106`), checks lock state, not caller identity.

### C-2. CSRF: cross-origin form POSTs execute
`express.urlencoded` is enabled (`server.ts:36`), so a website can submit a "simple request" form POST that the server parses and executes — no preflight needed. Nastiest chain: forge `POST /api/settings` to point `local_openai_base_url` at an attacker server; the next time the user saves an entry, `indexEntry` (`server/services/vault.ts:33-53`) embeds the full secret text and POSTs it to that URL.

### C-3. `GET /api/settings` returns every cloud API key in plaintext
`server/routes/settings.ts:12-18` — to any caller, even while the vault is locked (endpoint is outside the unlock gate, `server.ts:50-53`). Directly contradicts `SECURITY.md:22` ("never sent back to the frontend UI").

**Fix for all three is one move:** generate a random session token at server startup, hand it to the renderer through the preload bridge, require it as a header on every `/api` request, and reject requests whose `Host` isn't `127.0.0.1:<port>`/`localhost:<port>`. Drop `express.urlencoded` (the UI is JSON-only).

---

## 🟠 HIGH

### H-1. Hostile vault takeover via `/api/vault/setup-password`
`server/routes/vault.ts:65-77` — no proof of user intent, min length 4, no rate limit. A rebinding page or local process can encrypt the vault under a password *the attacker knows*, then call `/api/vault/unlock` — the key is then loaded server-side and all secrets are readable. Also a pure lockout/ransom attack.

### H-2. Unthrottled master-password brute force on `/api/vault/remove-password`
`server/routes/vault.ts:79-93` — only `/unlock` has a rate limiter (10/min). `/remove-password` has a cosmetic 500 ms delay and no attempt counter (~2 guesses/sec forever); success writes the vault to disk **decrypted**. Each guess runs synchronous PBKDF2-100k on the event loop (`server/crypto.ts:20`) — trivial event-loop starvation DoS.

### H-3. Path traversal in `POST /api/emergency/restore`
`server/routes/misc.ts:27-33` → `server/store.ts:902-941`. `name` goes into `path.join(dir, name)` unsanitized. `..\..\` points the "snapshot" at any JSON file on disk; if it parses with `format: "indexarc-emergency"`, its base64 fields overwrite `vault.json`, `vectors.json`, `scratchpad.json`, `settings.json`. Unprotected endpoint, works while locked. Fix: allowlist `^indexarc-emergency-[\w\-.]+\.iabak$`.

### H-4. Stored XSS in an Electron renderer with `sandbox: false` and no CSP
Three `dangerouslySetInnerHTML` sinks: `NoteDetailModal.tsx:299` (renders `raw_fragment` extracted from scanned disk files), `ScratchpadTab.tsx:3089` and `:3241` (archived-note and revision previews). No sanitizer (no DOMPurify) anywhere, no Content-Security-Policy in `index.html`/server/`electron-main.cjs`, `webPreferences.sandbox: false` (`electron-main.cjs:614`). AI output also flows into note HTML unsanitized (`ScratchpadTab.tsx:1971`).

### H-5. Secrets at rest outside the encrypted vault
The vault is AES-256-GCM encrypted, but scratchpad notes persist **unencrypted** in five client-side stores: `localStorage["indexarc_scratchpad_tabs"]`, two IndexedDB stores (idb-keyval + y-indexeddb), note revisions, and `indexarc-reopen-note` (`ScratchpadTab.tsx:1266-1267`, `:1043-1051`, `:88-101`; `App.tsx:1219`). Cloud API keys sit in **plaintext** `config/settings.json` (`store.ts:171-175`); emergency snapshots copy that file (base64, not encryption) to multiple machine locations (`store.ts:777-830`), recoverable even after uninstall. Electron `safeStorage` is the natural fix for both.

### H-6. Undo/Redo is completely broken
TipTap created with `undoRedo: false` (`ScratchpadTab.tsx:721`) unregisters the commands; the custom history stack is unreachable because `historyUndo`/`historyRedo` early-return whenever the editor exists (`:911`, `:924`). Ctrl+Z, Ctrl+Y, and toolbar buttons do nothing, despite the README advertising them.

### H-7. Cancelling a confirm dialog crashes the app
`showConfirm` rejects on cancel (`App.tsx:137-159`), but `deleteEntry` (`App.tsx:541`) and `discardScanSession` (`App.tsx:731`) don't catch; the ErrorBoundary treats *every* global unhandled rejection as fatal (`ErrorBoundary.tsx:26-39`). Pressing "Cancel" on "Delete Entry" blanks the app. Unguarded fetches in `handleSaveSelected`/`submitClarify` hit the same trap.

### H-8. Corrupted `vault.json` is silently wiped
`readJson` swallows parse errors (`store.ts:35-42`); a corrupt vault reads as "unlocked, empty," and the next write clobbers the (possibly recoverable) file. No quarantine, no user-visible error.

---

## 🟡 MEDIUM

### Privacy / consent
- Whole note content is POSTed to `/api/autocomplete` on nearly every keystroke and `/api/analyze` after every paste (`ScratchpadTab.tsx:1609`, `:2419-2422`); entry values are sent to cloud providers for embeddings (`vault.ts:39-40`); Ask puts five entries' `Value:` fields into cloud prompts (`ask.ts:313-337`). "100% local" is only true in Ollama mode; no per-send warning exists.
- Spellcheck permanently falls back to the **public** LanguageTool API on local-server failure (`shared/languagetool.cjs:251-254`), routing note text to languagetool.org; spawned Java server never killed; local LT server started with `--allow-origin "*"` (`:116`).
- Secret values unmasked in command palette (`CommandPaletteModal.tsx:180`), duplicates panel (`LibraryTab.tsx:263`), and `unknown`-family cards. `maskValue` (`src/utils.ts:3`) exists and is never called.

### Server robustness
- Express 4 doesn't catch async rejections: `/api/entries/park`, `PATCH /api/entries/:id`, bulk commit/apply have unguarded `await`s → hung requests, half-applied sessions (`routes/entries.ts:57-79`, `:96-107`; `routes/folders.ts:137-256`).
- Unvalidated `labels`/`type_aliases` reach `entry.labels.join()` → 500 *after* persist (`routes/entries.ts:26` → `services/vault.ts:24`).
- `writeVault` nulls the cache before the write succeeds (`store.ts:199-201`).
- Unvalidated base URLs fetched with vault secrets in the body (`providers.ts:440, 736, 917, 1131`); Gemini SDK calls and `pullOllamaModel` have no timeout (`providers.ts:267, 655, 831, 1016, 1152`).
- `fs.watch` error events have no listener (`folderWatcher.ts:46`) — removing a watched drive can crash the server process.
- `/api/fs/list` enumerates any drive, unprotected, while locked.
- Heuristics: "high entropy" is just "≥20 chars, no whitespace" (`heuristics.ts:27`); mid-sentence secrets never detected; everyday verbs ("find", "export") classify sentences as commands.

### Frontend correctness
- Debounced 1200 ms server autosave cancelled in effect cleanup; component unmounts on tab switch → final 1.2 s of edits lost; server copy then overwrites local state (`ScratchpadTab.tsx:1265-1278`, `:1215-1218`).
- "Paste plain" toggle non-functional (`ScratchpadTab.tsx:1621-1643` vs `:2419`).
- Ctrl+K advertised but never opens the palette (`CommandPaletteModal.tsx:31-35`); keyboard nav unimplemented.
- Yjs persistence decorative — content inserted once, never synced or read back; "Synced" badge misleading (`ScratchpadTab.tsx:1037-1061`, `:2340`).
- Eight places write raw `innerHTML`/DOM ranges into ProseMirror nodes (`ScratchpadTab.tsx:900, 1091, 1358-1368, 1653-1664, …`).
- Locale-compare hack always false → Arabic strings can never render (`LibraryTab.tsx:185`, `FoldersTab.tsx:94,192,239`).

---

## 🟢 LOW / Hygiene

- **Dependencies:** `npm audit` = 7 advisories in prod deps (1 high: browserslist, build-time; 6 moderate incl. `qs` via Express 4, `uuid` via exceljs). Express 4 → 5 also fixes the async-handler bug class.
- **tsconfig has no `strict`** — the lint gate runs loose; `any`-typed request bodies and scratchpad store APIs (`store.ts:49-50, 382-537`) escaped because of it.
- **Docs drift:** README claims "scrypt/Argon2id"; code and SECURITY.md say PBKDF2-SHA256/100k (below OWASP's 600k guidance).
- **Tests:** 15 tests, none covering the secret classifiers, Ask scoring, provider fallback chain, hallucination filter, or store encryption. No fetch mocking anywhere.
- **Dead code:** `LogsTab.tsx`, NoteDetailModal edit feature, legacy `onPaste`, `maskValue`/`statusLabel`, `getDicPath` (`english-spell-engine.cjs:323`), `/commit` vs `/apply` duplication (`routes/folders.ts`).
- **Polish:** mojibake in toolbar (`ScratchpadTab.tsx:2815`, `:2929`); wrong dictionary entry `there → "they're"` (`spellcheck.cjs:1471`); hardcoded English strings bypassing i18n (incl. app chrome); `idb-keyval` runtime import in devDependencies.
- **Architecture:** `ScratchpadTab.tsx` is 3,329 lines with ~40 state atoms and five persistence layers.

---

## What's done well

Clean `preload.cjs` (proper `contextBridge`, no raw `ipcRenderer`), `nodeIntegration: false` + `contextIsolation: true`, scheme-validated `open-external`, `setWindowOpenHandler` denying popups. Git hygiene is airtight (verified: no `data/`/`config/`/`backups/`/`.env` tracked; electron-builder excludes them from packages). No prototype pollution, command injection, or zip-slip; folder-scan refuses symlinked directories. Atomic tmp+rename writes. AES-256-GCM correctly implemented (fresh IV per write, tag-verified decryption).

---

## Recommended fix order

1. **Pairing token + Host allowlist** middleware on Express — kills DNS-rebinding, CSRF, and hostile-`setup-password` chains in one change. Stop returning API keys from `GET /api/settings`.
2. **Sanitize all three `dangerouslySetInnerHTML` sinks** (DOMPurify) + CSP meta tag; flip `sandbox: true`.
3. **Protect secrets at rest:** encrypt `settings.json` via Electron `safeStorage`; encrypt or stop persisting scratchpad content outside the vault.
4. **Correctness batch:** confirm-cancel rejection handling, undo/redo (delete one competing system), autosave-on-unmount, emergency-restore filename allowlist, `/remove-password` throttling.
5. **Data safety:** quarantine unparseable `vault.json`; surface errors instead of silent reset.
6. Raise PBKDF2 iterations; enable `strict` TS incrementally; add tests for heuristics classifiers, Ask scoring, and store encryption before changing them.
