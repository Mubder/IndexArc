# IndexArc — Master Execution Plan

**Status:** Authoritative build order · **Date:** 2026-09-05
**Supersedes:** the phase tables in [`SCRATCHPAD_AND_PROTECTION_PLAN.md`](./SCRATCHPAD_AND_PROTECTION_PLAN.md) (kept as design reference) and the fix-order list in [`AUDIT_REPORT.md`](./AUDIT_REPORT.md) (kept as findings reference).
**Inputs merged:** the 2026-09 audit, the scratchpad/protection design, the peer review of that design (corrections adopted — listed per task), and the hosted-deployment analysis (Path A adopted; Path B rejected).

---

## 0. Ground rules

1. **One theme per PR.** Persistence rewrites, security middleware, and component extraction never share a PR — a rewrite that can't be bisected is how data loss ships.
2. **Every data-loss or concurrency change ships with its tests in the same phase.** Tests are not Phase 4 (peer-review correction).
3. **No behavior change in extraction PRs.** The 3,329-line `ScratchpadTab.tsx` is split only after its persistence layer is stable.
4. **The API must know who is calling before anything else matters.** Phase 1 auth is designed once for both LOCAL and HOSTED mode so it never paints us into `127.0.0.1` (peer-review correction).
5. **Honesty rule for docs:** SECURITY.md/README claims must match implementation at the end of every phase. Known mismatch today: README says scrypt/Argon2id (code: PBKDF2-100k); SECURITY.md says keys never reach the UI (`GET /api/settings` returns them).

**Already completed (pre-plan):** audit + design docs; unified IBM Plex Sans Arabic bundled locally (no Google Fonts CDN — offline/zero-telemetry restored); note line-height 1.6 / paragraph 0.35em; `assets/icon.ico` + `win.icon` config fix (bypasses crashing icon converter); working Windows portable + setup builds.

---

## Phase 1 — Stop the bleeding (security + crash fixes)

**Theme:** the browser can no longer touch the vault; the app stops crashing itself; the worst server holes are plugged. No storage-format changes in this phase.

### P1.1 — API pairing token + Host allowlist, designed for LOCAL and HOSTED mode
- Two auth modes in one middleware (`server.ts` + new `server/auth.ts`):
  - **LOCAL (default):** random token generated at server startup; handed to the renderer via preload bridge (Electron) *or* a bootstrap endpoint bound to loopback; required as `X-IndexArc-Token` header on every `/api` call. Reject any request whose `Host` is not `127.0.0.1:<port>` / `localhost:<port>`.
  - **HOSTED=1 (env flag, skeleton only this phase):** no localhost Host check; `HttpOnly; Secure; SameSite=Strict` session cookie issued by `POST /api/vault/unlock` (the unlock *is* the login); double-submit CSRF token for mutations. Full hosted polish is Phase 5 — the auth seam is built now so nothing later rewrites it.
- Drop `express.urlencoded` (`server.ts:36`) — the UI is JSON-only; urlencoded is the CSRF simple-request vector.
- Token never appears in URLs; SSE passes it via `EventSource` query only if needed, else switch SSE to cookie-auth in HOSTED and token-in-`Last-Event-Id`-free header can't work → use one-time SSE ticket endpoint (`POST /api/sse/ticket` → short-lived token for `?ticket=`), expiring in 30 s.
- **Accept:** a DNS-rebinding page and a cross-origin form POST both fail; the Electron app and `npm run dev` web app work unchanged; curl with no token gets 401 on every `/api` route.

### P1.2 — Stop returning secrets from `GET /api/settings`
- `server/routes/settings.ts:12-18`: respond with `*_api_key_configured: true/false` booleans; keys are write-only (`POST /api/settings` accepts them, GET never returns them).
- Add `/api/settings`, `/api/logs`, `/api/fs` to the unlock-gated paths (`server.ts:50-53`).
- Frontend: SettingsTab keeps keys in state after save; shows "configured" badges from booleans; no re-display of stored keys.
- **Accept:** with the vault locked, `GET /api/settings` contains zero key material.

### P1.3 — Vault route hardening
- `/api/vault/remove-password` and `/api/vault/setup-password`: attempt counter + exponential backoff (share the `/unlock` limiter pattern, `routes/vault.ts:6-42`); failed PBKDF2 runs off the event loop (`crypto.pbkdf2` async, not `pbkdf2Sync` — fixes the starvation DoS).
- `/api/emergency/restore` (`routes/misc.ts:27-33` → `store.ts:902-941`): reject `name` unless `/^indexarc-emergency-[\w\-.]+\.iabak$/` (kills the path traversal, audit H-3).
- **Accept:** 6 wrong passwords in a row on remove-password → visible backoff; `name: "..\\..\\x"` → 400.

### P1.4 — Renderer hardening: sanitizer + CSP + sandbox
- Add `dompurify`; wrap all three `dangerouslySetInnerHTML` sinks (`NoteDetailModal.tsx:299`, `ScratchpadTab.tsx:3089`, `:3241`) with a single `sanitizeNoteHtml()` helper.
- Sanitize AI output **before** `setContent` (currently raw model HTML enters notes, `ScratchpadTab.tsx:1971`, `:2006`); fix the literal-`<br>` bug with a newline→paragraph transform.
- CSP meta in `index.html` (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:`); flip `webPreferences.sandbox: true` (`electron-main.cjs:614`) and verify preload still works (contextBridge is sandbox-safe).
- **Accept:** a scanned `.html` file containing `<script>`/`<img onerror>` renders inert in the note viewer; app functions with sandbox on.

### P1.5 — Crash-class UI fixes
- `showConfirm` resolves (not rejects) on cancel (`App.tsx:137-159`); catch at `deleteEntry` (`:541`) and `discardScanSession` (`:731`); ErrorBoundary stops treating bare unhandled rejections as fatal — only real render errors trip the crash screen (`ErrorBoundary.tsx:26-39`); add try/catch around the bare fetches in `handleSaveSelected`/`submitClarify`.
- Undo/redo: remove `undoRedo: false` (`ScratchpadTab.tsx:721`), delete the custom history stack, remove the `tiptap` early-returns in `historyUndo`/`historyRedo` (`:911`, `:924`). Keep revision snapshots (Format/AI-rewrite guards) — they are the Versions feature, separate from undo.
- **Accept:** Cancel on "Delete Entry" closes the dialog; Ctrl+Z/Y and toolbar buttons work in a note; README shortcuts table becomes true again.

### P1.6 — Autosave: flush via an unmount-surviving queue (peer-review correction)
- **Not** `navigator.sendBeacon` (payload limits, no JSON content-type, no 409 handling) and **not** React `flushSync`. Implement a module-level save queue (outside React) that owns the debounce; the effect enqueues and the queue's fetch survives unmount; on next mount, load awaits queue-drain first.
- Keep localStorage as a *cache* this phase (removal is Phase 2); the queue eliminates the lost-1.2s-edit window now.
- **Accept:** type in a note, switch tabs within 1.2 s, switch back → edit is present (regression test: queue unit test + manual).

### P1.7 — Server robustness quick hits (cheap, low-risk)
- Async wrapper for Express 4 route handlers (or migrate to Express 5 — decide by PR size; wrapper is the default) for the unguarded awaits (`entries.ts:57-79`, `:96-107`; `folders.ts:137-256`) → 500 instead of hung sockets.
- Validate `labels`/`type_aliases` are `string[]` before persist (`entries.ts:26` → `services/vault.ts:24`) — fixes save-then-500.
- `fs.watch` error listener (`folderWatcher.ts:46`) — log + auto-restart watcher, never crash the process.
- Cap SSE client set; check `res.writableEnded` in `sendSSE` (`sse.ts:7-47`).
- Timeouts: Gemini SDK calls + `pullOllamaModel` (`providers.ts:267, 655, 831, 1016, 1152`).
- Validate `local_openai_base_url` / `ollama_base_url` are `http(s)://` + host (anti-SSRF hygiene).

**Phase 1 exit criteria:** all P1 acceptance checks pass; audit CRITICAL C-1/C-2/C-3 and HIGH H-1/H-2/H-3/H-4/H-6/H-7 verified closed; `npm run desktop:win` builds; manual smoke: lock/unlock, paste-analyze-save, note edit across tab switches.

---

## Phase 2 — Data safety (server becomes the only source of truth)

**Theme:** one durable store, encrypted at rest, that never silently destroys data. No component extraction (peer-review correction: don't split the monolith in the same phase as the persistence rewrite).

### P2.1 — Server is the only durable store for note content
- Delete localStorage + idb-keyval **tab-content** writes (`ScratchpadTab.tsx:1266-1267`, `:242-247`, `:1215-1278`). On mount: load from server only.
- **Keep, with new homes (peer-review correction):**
  - Note revisions → **move to the server** (`data/note_revisions.json`, per-tab, cap 30, trimmed server-side). Client revision stores (`:88-101`) become read-through caches only. Not doing this would silently delete history when the client stores die.
  - Tiny prefs (`indexarc_enable_ghost`, font sizes, language, reopen-note marker) → stay in localStorage. They are not secrets and not content.
- Envelope bump `{ version: 2, tabs }`; `ScratchTab` gains `created_at`, `updated_at`, `rev` (already has `archived`/`archivedAt` — correction noted; they keep working).
- **Accept:** clear localStorage + IndexedDB → all notes intact after reload; revisions intact.

### P2.2 — Encrypt the scratchpad files with the vault envelope (peer-review correction)
- `scratchpad.json` + `scratchpad_archive.json` + `note_revisions.json` encrypted with the **same AES-256-GCM envelope as `vault.json`** when a master password is set (`server/crypto.ts`, store lock/unlock lifecycle). This is the real H-5 fix.
- Per-note "Lock" is **not** a crypto boundary and is **not** built here (the old Tier-3 idea is demoted: encrypting the file is the boundary; a per-note hide/reveal can be UX on top later).
- Consequence: emergency snapshots (`store.ts:777-830`) now copy ciphertext — base64-of-encrypted is finally safe.
- **Accept:** with a password set, `strings data/scratchpad.json` shows no plaintext; lock → file unreadable; unlock → notes return.

### P2.3 — Optimistic concurrency (`rev` + 409)
- Server increments `rev` per tab on every accepted save; whole-array `POST /api/scratchpad` sends base revs; mismatch → `409 { server_tabs }`, UI offers "reload / overwrite mine".
- **Tests (ship in this phase — peer-review correction):** extend `server/scratchpad.test.ts`: concurrent saves, stale-rev 409, empty-save guard still holds, migration v1→v2.
- **Accept:** two browser windows editing the same note → one gets the conflict banner, not silent loss.

### P2.4 — Quarantine, never overwrite (real H-8 fix)
- `readJson` (`store.ts:35-42`): on parse failure of vault/scratchpad/vectors → rename to `*.corrupt-<stamp>`, log via `addLog`, surface a recovery banner in the UI, start empty **from a fresh file, never over the corrupt one**.
- Integrity HMAC manifest (`data/manifest.json`, HMAC-SHA256 per file, device key) — **documented honestly** as bit-rot/accidental-overwrite detection only (peer-review correction): it does not stop an attacker who can write to `data/`.
- **Accept:** truncate `scratchpad.json` by hand → app boots, banner shows, `.corrupt-` file exists.

### P2.5 — Auto-lock (pulled forward per peer review — table stakes)
- Idle timeout (default 5 min, configurable in Settings) + lock-on-minimize; purges key from memory (existing `lock()` path).
- **Accept:** idle 5 min → vault locks without interaction.

### P2.6 — Store hardening
- Fix `writeVault` cache-invalidation-before-write (`store.ts:199-201`); scratchpad archive/restore two-file ordering made crash-atomic (write archive first, then active — `store.ts:473-527`); backup dedupe/prune uses file mtime not name sort (`store.ts:545-622`); log (don't swallow) vault/scratchpad read failures.
- **Accept:** unit tests for the new store paths.

**Phase 2 exit criteria:** plaintext note content no longer exists anywhere on disk when a password is set; lost-edit and silent-wipe bug classes have regression tests; auto-lock live.

---

## Phase 3 — Pin / Protect + granular APIs + component split

**Theme:** notes that cannot be lost, then a codebase you can maintain. Granular endpoints and Protect ship **together** (peer-review correction: whole-array save + 409 would otherwise block unrelated notes).

### P3.1 — Granular API (prerequisite, same phase)
- `PUT /api/scratchpad/order` — ids only (reorder).
- `POST /api/scratchpad/tabs/:id/content` — `{ content, base_rev }` → 200 `{ tab }` or 409.
- `POST /api/scratchpad/tabs/:id/meta` — title/pin changes.
- `DELETE /api/scratchpad/tabs/:id` — explicit delete.
- Whole-array `POST /api/scratchpad` becomes a deprecated compat path: merge-by-id, **can never delete or mutate protected tabs**; client stops using it for content.
- Reason this split is mandatory: merge-by-id makes delete impossible, replace-by-array makes Protect impossible — one API cannot serve both (peer-review correction).

### P3.2 — Protect, enforced in `store.ts`
- Flags on `ScratchTab`: `pinned`/`pinned_at`, `protected`/`protected_at`.
- Rules enforced server-side across **every** write path: modify/rename/**omit** of a protected tab → `409 { violations }`; `DELETE` → `423`; archive → refuse. UI-level `setEditable(false)` is presentation, never the guarantee.
- **No `override_protected` flag on any generic endpoint** (peer-review correction: that flag on `POST /api/scratchpad` would make Protect theater). The only override path is the dedicated unprotect route below.
- `POST /api/scratchpad/tabs/:id/unprotect` — requires `{ confirm_word: "UNPROTECT" }`, **or** the master password when the vault is encrypted (peer-review correction: type-to-confirm-the-title is weak — default titles are "Scratch 1"). Every override-edit auto-captures a "Before override" revision.
- **Tests:** protect modify/omit via array path, DELETE 423, archive-of-protected, unprotect auth, rev-conflict under protection.

### P3.3 — Protect + Pin UI
- Sort: pinned first (`pinned_at` desc), then `updated_at` desc. Badges on tabs and note header (📌/🔒).
- Protected editor: `editor.setEditable(false)`, toolbar/AI-rewrite/proofread/ghost-text disabled (no silent mutation vectors), archive/delete hidden.
- Protect toggle: confirm modal listing exactly what's blocked. Unprotect: the P3.2 ceremony.
- **AI-exposure policy (peer-review correction):** protected note content is excluded from `/api/autocomplete`, `/api/analyze`, `/api/ask` payloads by default (server-side filter) — decide-before-ship, not "later".
- i18n (en/ar) for every new string; RTL-correct icons.

### P3.4 — Component extraction (only after P3.1–P3.3 are stable, separate PRs, no behavior change)
- `lib/noteHtml.ts`, `lib/textTokens.ts` (dedupe with `spellcheck.worker.ts:5-39`), `hooks/useScratchpadTabs.ts`, `hooks/useSpellcheck.ts`, `hooks/useGhostText.ts` (debounce 500 ms + abort previous), `components/NoteToolbar.tsx`, `ArchivePanel.tsx`, `RevisionsModal.tsx`, `SpellContextMenu.tsx`, `SlashMenu.tsx`, `GhostBadge.tsx`.
- Delete dead code in the same passes: unreachable `execCommand` branch (`:973-997`), legacy `onPaste` (`:1621-1643`), `LogsTab.tsx`, NoteDetailModal edit feature, `maskValue`/`statusLabel` (or *use* `maskValue` in palette/duplicates — the audit's unmasked-secrets fix).
- **Accept:** `ScratchpadTab.tsx` under ~800 lines; bundle size not worse; all Phase 1–3 tests green.

**Phase 3 exit criteria:** a protected note survives: buggy client, whole-array save, delete attempt, archive attempt, and its content never leaves the server toward AI endpoints.

---

## Phase 4 — Industry-grade hardening

**Theme:** expectations of a product people trust with secrets. Explicitly: this makes *a local vault that does not lie* — it does not make IndexArc Bitwarden (peer-review correction).

- **P4.1 KDF upgrade:** PBKDF2-SHA256 100k → 600k+ (or builtin `scrypt` N=2^15); store KDF params in the vault envelope; transparent re-derivation on next unlock. Update README (drop the scrypt/Argon2id claim or make it true) and SECURITY.md.
- **P4.2 Secrets at rest (OS-level):** cloud API keys → Electron `safeStorage` (DPAPI). The vault-key-encrypted fallback **is** the web/hosted product, not an edge case (peer-review correction) — implement both paths behind one interface.
- **P4.3 Clipboard hygiene:** auto-clear clipboard N seconds after copying a secret (30–120 s, configurable; standard in Bitwarden/KeePass).
- **P4.4 CI:** GitHub Actions — `tsc --noEmit` + vitest + `npm audit --audit-level=high` gate + `desktop:win` artifact on every PR; Dependabot; SBOM (CycloneDX) per release.
- **P4.5 Release trust:** Authenticode code signing; electron-updater with signature verification (today: unsigned exes + SmartScreen + manual updates = users run old vulnerable builds).
- **P4.6 `strict: true` TypeScript** — file-by-file burn-down; start with `server/store.ts` and `server/auth.ts`.
- **P4.7 Test pyramid completion:** supertest over every endpoint incl. lock matrix; heuristics classifier table; Ask scoring; provider fallback chain; one Playwright-Electron smoke (launch → paste → save → restart → verify).
- **P4.8 i18n + RTL completion:** fix the always-false locale-compare hacks (`LibraryTab.tsx:185`, `FoldersTab.tsx:94,192,239`); extract the hardcoded-English inventory from the audit; fix toolbar mojibake (`:2815`, `:2929`).
- **P4.9 Docs truth pass + diagnostics:** SECURITY.md/README match reality; local redacted diagnostics export; `logs.ts` redaction middleware using the heuristics' own regexes (dogfood).

---

## Phase 5 — Hosted mode (Path A: one server, thin clients)

> **⏸ DEFERRED (scope decision 2026-09-05):** cloud/self-hosted deployment is a future track, not current scope. Phases 1–4 proceed now. P1.1 still builds the LOCAL/HOSTED auth *seam* (mode-switch structure, cookie-ready middleware) so this phase can land later without rewriting auth — but HOSTED session logic, Docker fixes, and feature gating wait until this phase is un-deferred.

**Theme:** "one vault, reachable from anywhere" — weeks of work on the existing UI-is-a-client-of-Express architecture. Explicitly **not** Path B (device sync / encrypted replication): that's a different product with its own threat model — out of scope. Explicitly **not** Vercel/static serverless: this is a long-lived Node process with a filesystem — VPS, Fly, Railway, NAS, or home-server Docker.

### P5.1 — HOSTED=1 mode (auth seam already built in P1.1)
- Bind `0.0.0.0` (env), TLS terminated by Caddy/nginx (documented, not in-process).
- Session-cookie auth (from unlock/login) + CSRF double-submit — the Phase 1 HOSTED skeleton completed. The P1.1 localhost Host allowlist applies to LOCAL mode only; document that distinction so nobody "fixes" hosted mode with it (peer-review correction).
- Config: trusted origin allowlist for cookies/CORS.

### P5.2 — Feature gating for non-PC hosts
- Hide/disable in HOSTED: folder scan/watch, `/api/fs`, Ollama install/start IPC, LanguageTool spawn (fall back to local engines only), emergency snapshots into Windows registry/AppData (skip; volume backups instead).
- Surface a "hosted mode" badge so users know which features are local-only.

### P5.3 — Dockerfile for real
- `ENV HOST=0.0.0.0` (currently binds loopback inside the container — unreachable, peer-review correction), `VOLUME` for `/app/data` + `/app/config` (currently a restart wipes data), non-root user, healthcheck on `/api/ping`, compose example with Caddy for TLS.
- Deployment guide: single instance only (file-backed store; two containers clobber each other) — state it in the docs.

### P5.4 — Multi-client correctness rides on Phase 2
- `rev`/409 is the primitive that makes two browsers coexist; SSE gives cross-client updates. Add an integration test: two HTTP clients, one note, concurrent edit → one 409.
- Optional later: desktop shell becomes a wrapper around a hosted URL (config flag) instead of forking a local server.

---

## Deliberately out of scope

| Item | Why |
|---|---|
| `navigator.sendBeacon` for saves | payload limits, untrusted content-type, no 409 path — module queue instead |
| Per-note Lock as a crypto boundary | file-level encryption is the boundary; per-note hide is UX later |
| Path B device sync (Bitwarden-shaped) | new product: conflict resolution, pairing, sync server, own threat model |
| Static/serverless hosting (Vercel) | wrong runtime shape for a stateful file-backed server |
| Splitting `ScratchpadTab.tsx` during persistence work | unbisectable rewrites |
| Concurrency/protect tests deferred to "hardening" | they ship with the change they protect |

## Dependency map (what blocks what)

```
P1.1 auth ──► P1.2 settings ──► everything else (nothing ships secrets before this)
P1.6 queue ─► P2.1 SoT ──► P2.3 rev ──► P3.1 granular APIs ──► P3.2 Protect ──► P3.4 split
P2.2 encrypt scratchpad ──► (snapshots safe) ──► P5.3 hosted files on a VPS
P1.1 HOSTED skeleton ──► P5.1 session auth
P2.4 quarantine ──► P2.4b HMAC manifest (honest threat model)
```

**Start next:** P1.1 + P1.2 in one PR (auth middleware + key masking) — it is the highest-value change in the codebase and every other task assumes it.
