# IndexArc — Industrial-Grade Roadmap

**Status:** Authoritative build order from here on · **Date:** 2026-11-02
**Supersedes:** the remaining work in [`EXECUTION_PLAN.md`](./EXECUTION_PLAN.md). Its Phases 1–3 shipped; its Phase 4 items are folded in below with current status; its Phase 5 (hosted mode) stays deferred and appears here as R6.4.
**Inputs:** the 2026-11 three-part audit (crypto/store/auth, server routes/AI, frontend/Electron/build), each top finding re-verified in code; `npm audit`, `tsc`, and the full test run on 2026-11-02.

---

## What "industrial grade" means for IndexArc

IndexArc is industrial grade when every statement below is true and checked by CI or a written report — not by memory:

| # | Bar | Proof |
|---|-----|-------|
| 1 | Users can verify every binary came from us and wasn't modified | Signed Windows/macOS artifacts, Electron fuses + asar integrity, signed auto-update |
| 2 | No known high/critical vulnerability ships | `npm audit` gate, Dependabot, SBOM per release |
| 3 | No secret value leaves the vault boundary without an explicit, logged user action | Route lock-matrix tests, egress tests per AI path, external pentest |
| 4 | No user data is ever lost silently | Crash-consistency tests (kill mid-write), fsync'd atomic writes, restore that fails loudly |
| 5 | It stays fast at realistic scale | Benchmarks in CI: 10k entries, p95 save < 50 ms, p95 Ask < 300 ms, UI never blocked > 100 ms |
| 6 | Docs never claim more than the code does | Docs checklist in every release PR; SECURITY.md reviewed against THREAT-MODEL.md |
| 7 | Someone other than the author has attacked it | External pentest report against `THREAT-MODEL.md`, findings closed or accepted in writing |

---

## Where things stand — 2026-11-04 (branch `roadmap/r1-data-safety`)

Every engineering item in R1–R6 has landed with tests, except those listed under "Still open". What remains needs the owner (money, a vendor, a repository setting) or is a known follow-up.

| Phase | State | Key commits |
|---|---|---|
| R0 Fix-now | Done | bef5c62 |
| R1 Data safety | Done | 611e208 · 30122ed · 8876d2a · 5051e08 · 206855b |
| R2 Release trust | Done except signing and branch protection (owner) | 65f63bb · 99ef27f · d130a59 · 2f77c4e · fb78d23 |
| R3 Architecture | Done | fd4dfcd · 08f6bcf · b105882 (SQLite) · 20b1f0b · ae8d226/0d9b042/7cba7f6 · 1385b32 · ed29a02 |
| R4 Verification | Done | 9ed8696 · 32fca0a · 638c78f · 9423244 · 1c88816 · 2778101 |
| R5 Assurance & keys | Done except pentest (owner) and Windows Hello / Touch ID | bc0180a |
| R6 Product | CLI, import/export and hygiene done; hosted mode and sync are designed but not built (gated) | 99e078d · 34efe6f |

**Still open, needs the owner:**
- Code signing (R2.1): set up Azure Trusted Signing (paid, preferred) or SignPath Foundation (free) and add its secrets/variables (`docs/CODE_SIGNING.md`); the workflow supports both. macOS notarization or dropping macOS targets.
- Branch protection on `main` (R2.5).
- Pentest vendor and timing (R5).
- Un-deferring hosted mode and sync (R6.4/R6.5; see the ship gates in `docs/design/R6-hosted-and-sync.md`).

**Still open, engineering follow-ups:**
- Windows Hello / Touch ID unlock (needs a native module, which conflicts with the "no native crypto build" stance; decide with the owner).
- ASVS L2 gaps (`docs/ASVS-L2.md`):
  - password policy: 12-character minimum, breached-password check, strength meter, reveal toggle;
  - AAD on the JSON envelopes and the `vault.json` header (SQLite rows already have it);
  - a single key-lifecycle document.
- A self-contained CLI binary (Node SEA) and PATH registration by the installer.

---

## Ground rules (carried over, still binding)

1. **One theme per PR.** Storage rewrites, security changes and component extraction never share a PR.
2. **Tests ship with the change they protect**, in the same PR.
3. **No behavior change in extraction/refactor PRs.**
4. **Honesty rule:** README/SECURITY.md must match the code at the end of every phase.
5. **Conventional commits** from now on (`fix(store): …`, `feat(cli): …`) — no more `-` commit subjects; the CHANGELOG is generated from them.

---

## R0 — Fix-now batch ✅ done (2026-11-02, commit bef5c62)

| Item | Where |
|------|-------|
| Locked vault refuses plaintext emergency-snapshot restore (423) | `server/store.ts`, `server/routes/misc.ts` |
| Auto-lock counts only user input (GET polls ignored; `POST /api/activity` ping) | `server/auth.ts`, `src/App.tsx` |
| Every lock path purges secrets from renderer state + note mirror | `src/App.tsx`, `src/scratchpadSaveQueue.ts` |
| Unreadable settings key never regenerated; wrapped API keys preserved | `electron-main.cjs`, `server/store.ts` |
| Fixed confirm word no longer resets the password throttle; failures carry across windows | `server/routes/throttle.ts`, `server/routes/misc.ts` |
| Two quadratic regexes removed from heuristics (ReDoS) | `server/ai/heuristics.ts` |
| PDF extraction fixed (v2 class API, bundle `import.meta.url` shim, worker copied to `dist/`) | `server/services/folderScan.ts`, `package.json`, `scripts/copy-pdf-worker.cjs` |
| Ask answer generation pinned to the provider the prompt was built for | `server/services/ask.ts`, `server/ai/providers.ts` |
| Spellcheck off on paste fields; legacy localStorage notes removed; secret clipboard auto-clear (45 s); child processes get a scrubbed env | components, `src/lib/clipboard.ts`, `shared/child-env.cjs` |
| README/SECURITY.md corrected; `npm audit fix` (0 high/critical) | docs, lockfile |

**Open verification for R0:** launch `npm run desktop` and confirm auto-lock and clipboard clearing behave in the real window; package with `npm run desktop:win` and scan a PDF in the installed app (depends on the new `node_modules/@napi-rs/**` unpack rule).

---

## R1 — Correctness & data-safety backlog · ~2–3 weeks

**Theme:** close every remaining audit finding that can lose data, leak a secret, or fail open. No new features.

**Status 2026-11-03 (branch `roadmap/r1-data-safety`):** R1.1 611e208 · R1.2 30122ed · R1.3 8876d2a · R1.4 5051e08 · R1.5 206855b — all items below landed with tests, except:
- *Closed after the merge (R1.4):* Gemini SDK calls now go through `callWithRetry` (`server/validate.ts`): each attempt passes an `abortSignal`, so a timed-out request is actually cancelled, and 408/429/5xx/network errors retry with backoff inside one overall deadline (autocomplete: no retry).
- *Covered elsewhere (R1.4):* process-level crash handlers are registered in `electron-main.cjs`, which hosts the server; a bare `node dist/server.cjs` still has none (dev/headless only).
- *Also fixed, found by R4:* while locked, `POST /api/settings` accepts only language and font-size fields; `/api/ai/ollama/ensure` returns 423. Ollama probe, embedding fallback and `embed_provider_override` egress bugs fixed. The two quadratic heuristics regexes were replaced.
- *Exit R1 met:* see the findings table below. The packaged app (`npm run desktop:pack`) was built from the merged branch and launched against a scratch data root: dist integrity OK, settings key wrapped with safeStorage, `/api/ping` 200, `/api/settings` without the token 401.

### R1.1 Fail-closed storage
- **Quarantine only on parse errors**, never on transient I/O (`EBUSY`, `EPERM`, `EACCES` from antivirus/sync tools): retry with backoff, then surface an error. Today a transient read renames `vault.json`, `isLocked()` turns false, and new entries are written in plaintext (`store.ts` `readJsonOrQuarantine`).
- **Never write plaintext when an encrypted vault ever existed:** persist an `config/encryption-expected.json` marker; plaintext writes refused while it is set.
- **fsync** temp file and directory before rename in `atomicWrite`; make snapshot and backup writes atomic too.
- **Restore fails loudly:** `applyEmergencySnapshot` must stop and roll back on the first failed file instead of swallowing errors and returning `true` (mixed-key file sets today).
- *Accept:* kill-the-process-mid-write test suite (vault, vectors, scratchpad, settings) leaves either old or new state, never a hybrid; transient-EBUSY test keeps the vault locked.

### R1.2 Concurrency
- Serialize `setupPassword`, `unlock`, `lock`, `upgradeKdf` through one async mutex in the store (double-submit leaves file key ≠ memory key today; a `lock()` during `unlock`'s `await` is undone).
- `upgradeKdf` becomes two-phase: write all files under the new key to temp names, then rename the set; keep a resumable marker so a crash mid-upgrade can't strand companion files under the old key.
- Folder watcher: per-session write queue so two files changed together can't overwrite each other's candidates (`folderScan.ts` `scanFileIntoSession`).
- *Accept:* concurrency tests for each of the above (parallel calls, injected delays).

### R1.3 Snapshot & audit integrity
- Snapshot retention by **time buckets** (e.g. last 15 + hourly for 24 h + daily for 14 d) instead of last-15-by-count — 2.5 minutes of edits currently evicts every good snapshot.
- Write a `backups/` copy on a schedule (daily) as well as at startup.
- Audit log `verify()` checks the final record against the anchor and detects missing rotated generations (tail truncation passes today).
- Purge plaintext API keys from machine-level snapshots taken before the safeStorage migration (re-snapshot or redact `settings` in old snapshots).

### R1.4 Server robustness
- Cache `isEncryptionEnabled()` (invalidate on write) — every protected request re-reads and parses all of `vault.json` today.
- Folder watcher honours the scan's skip list (`node_modules`, `dist`, `.git`…) and never follows symlinks.
- Office files: cap decompressed size (zip entry sizes) before mammoth/exceljs; run parsers with a timeout.
- `/api/entries/park` gets the same item cap as `/save` (200).
- Cancellable provider calls (`AbortController`) instead of `withTimeout` that leaves Gemini calls running; bounded retries with backoff.
- LanguageTool re-reads the consent setting per request (turning it off must stop egress immediately).
- Process-level `unhandledRejection` / `uncaughtException` handlers that log (redacted) and keep the vault safe.
- Note-protection guard on AI routes must not depend on the client sending `tab_id`.
- Embedding model/dimension change triggers a background re-index instead of silently returning 0 similarity.

### R1.5 Renderer & Electron
- `useSSE`: keep and call the reconnect cancel function on unmount.
- IPC handlers validate `event.senderFrame` against the app origin; add `setPermissionCheckHandler`.
- Ollama installer signature check: verify signer subject exactly, not `-like '*Ollama*'`.
- LanguageTool: verify the responder on port 8081 is our spawned process (handshake/nonce) before sending note text.
- Make the clipboard clear delay a setting (0 = off), default 45 s.

**Exit R1:** every finding in the 2026-11 audit is Fixed or explicitly Accepted (with reason) in a findings table appended to this doc.

### R1 findings table (2026-11-03)

| # | Finding | Status | Where / why |
|---|---------|--------|-------------|
| 1.1a | Transient I/O error quarantined `vault.json` and unlocked the store | Fixed | 611e208: retry with backoff on `EBUSY`/`EPERM`/`EACCES`; quarantine only on parse errors |
| 1.1b | Plaintext writes possible after an encrypted vault existed | Fixed | 611e208: `config/encryption-expected.json` marker; plaintext writes refused |
| 1.1c | `atomicWrite` without fsync; snapshot/backup writes not atomic | Fixed | 611e208 |
| 1.1d | Emergency restore swallowed per-file errors and returned `true` | Fixed | 611e208: stops and rolls back on first failure |
| 1.2a | `setupPassword`/`unlock`/`lock`/`upgradeKdf` raced (file key ≠ memory key) | Fixed | 30122ed: one store mutex |
| 1.2b | Crash mid-`upgradeKdf` could strand files under the old key | Fixed | 30122ed: staged two-phase commit with resumable marker |
| 1.2c | Watcher: two files changed together overwrote each other's candidates | Fixed | 30122ed: per-session write queue |
| 1.3a | Count-based snapshot retention evicted every good snapshot in minutes | Fixed | 8876d2a: time-bucket tiers |
| 1.3b | `backups/` copy only at startup | Fixed | 8876d2a: daily scheduled backup |
| 1.3c | Audit `verify()` passed tail truncation and missing generations | Fixed | 8876d2a: anchor compare + generation checks; anchor fsynced |
| 1.3d | Plaintext API keys in pre-safeStorage emergency snapshots | Fixed | 8876d2a: one-time re-wrap of snapshot settings |
| 1.4a | Every protected request re-parsed `vault.json` | Fixed | 611e208: cached by the file's mtime and size |
| 1.4b | Watcher ignored the skip list and followed symlinks | Fixed | 5051e08: `isWatchedPath`, `isRegularFileInside` |
| 1.4c | Office zip bombs / hung parsers | Fixed | 5051e08: central-directory budget (64 MB, 5000 entries, no ZIP64), 30 s parser timeout |
| 1.4d | `/api/entries/park` had no item cap | Fixed | 5051e08: 200 |
| 1.4e | Gemini calls kept running after timeout; no retries | Fixed | `callWithRetry`, after the R2/R4 merge |
| 1.4f | LanguageTool kept using the public API after consent was revoked | Fixed | 5051e08: consent re-read per request |
| 1.4g | No process-level crash handlers | Fixed | fd4dfcd (R3.1): the server process has its own handlers; the shell restarts it after an uncaught exception |
| 1.4h | Protected-note AI guard depended on the client sending `tab_id` | Fixed | 5051e08: always on while locked; server-side text match otherwise |
| 1.4i | Embedding model change silently returned 0 similarity | Fixed | 5051e08: `embed_model` per vector, background re-index |
| 1.5a | `useSSE` leaked its reconnect timer on unmount | Fixed | 206855b |
| 1.5b | IPC handlers trusted any sender; no permission check handler | Fixed | 206855b: `handleTrusted`, `setPermissionCheckHandler` |
| 1.5c | Ollama installer signer checked with `-like '*Ollama*'` | Fixed | 206855b: exact CN + O match |
| 1.5d | LanguageTool port could be answered by another process | Fixed | 206855b: free loopback port, live-child handshake |
| 1.5e | Clipboard clear delay hard-coded | Fixed | 206855b: `clipboard_clear_seconds` (0–600, default 45) |
| R4-1 | Locked vault accepted any `POST /api/settings` | Fixed | 206855b: language and font sizes only |
| R4-2 | Ollama probed a remote host without cloud consent | Fixed | 5051e08 |
| R4-3 | `embedText` fell back to Gemini when the user pinned local | Fixed | 5051e08 |
| R4-4 | `embed_provider_override` ignored | Fixed | 5051e08 |
| R4-5 | Two quadratic regexes (`isCommand` split, `stripSectionRule`) | Fixed | 5051e08 |
| R4-6 | `/api/proofread`, `/api/rewrite`, `/api/ollama/ensure` outside the locked-vault gate | Fixed | eadc85c |

---

## R2 — Release trust & supply chain · ~2–3 weeks + certificate lead time

**Theme:** a user can trust the binary and the update channel. This is the single biggest gap today.

### R2.1 Code signing *(needs an owner decision: OV vs EV certificate, budget)*
- Windows Authenticode via `build.win` (`certificateSubjectName` or PFX in CI secrets, `signingHashAlgorithms: ["sha256"]`); remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from both workflows.
- macOS: Developer ID + hardened runtime + notarization, or drop macOS targets until funded.
- *Accept:* `signtool verify /pa` passes on every shipped `.exe`; SmartScreen reputation tracked.
- **Progress (2026-11-04):** route chosen: SignPath Foundation (free OSS signing, publisher shown as "SignPath Foundation"). The project is licensed GPL-3.0 to qualify. `desktop-builds.yml` signs `IndexArc.exe`, then the installer and portable exe, on release events once `SIGNPATH_ORGANIZATION_ID` is set; `scripts/write-app-update-yml.mjs` and `scripts/refresh-update-manifest.mjs` keep the updater working with the externally signed files (tested locally without signing). Azure Trusted Signing added as the preferred route (`scripts/azure-sign-config.mjs`, electron-builder's `azureSignOptions`; signs the exe, DLLs, installer, uninstaller and portable under the owner's name, and a CI step verifies the signer). Waiting on the owner's account. Setup: `docs/CODE_SIGNING.md`.

### R2.2 Electron hardening
- `@electron/fuses`: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on.
- Stop `asarUnpack: dist/**` (server bundle and UI are swappable plain files today) — unpack only what must be on disk (native `.node`, the pdf worker, dictionaries), and verify the server bundle hash at load.
- Type-check `.cjs` files (`checkJs` or convert `electron-main`/`preload` to TS).
- **Progress (branch `roadmap/r2-release-trust`):** fuses on via `build.electronFuses` (verified with `@electron/fuses read`). `dist/` stays unpacked, because pdf.js imports the worker from disk. Instead, `dist-manifest.json` (sha256 of every dist file) is packed inside `app.asar` and checked by `shared/verify-dist.cjs` before the server bundle loads; a tampered `server.cjs` was refused in a packaged build. `preload.cjs` is type-checked strictly via `tsconfig.electron.json` in `npm run lint`. **Open:** `electron-main.cjs` (73 strict errors, mostly implicit `any`). Unpacking only the pdf worker and native modules instead of all of `dist/` is optional now that the manifest exists.

### R2.3 Signed auto-update *(needs an owner decision: GitHub Releases vs static host)*
- `electron-updater` with `verifyUpdateCodeSignature`; staged rollout; the installer-preservation CI job stays the guard.
- **Progress (2f77c4e):** done on GitHub Releases. `shared/updater.cjs` makes no network call until the user checks, or turns on the startup check (off by default). It downloads and installs only when the build can verify the update signature, so unsigned and portable builds link to the release page instead. A `publish-release` job attaches installers, `latest*.yml`, blockmaps and the SBOM. Signed installs need R2.1. Staged rollout is not configured. The same commit put `electron-main.cjs` under strict `@ts-check`; that pass found and fixed the clipboard auto-clear never running (Electron 44's `readText()` returns a Promise).

### R2.4 Package slimming
- Move build-only packages to `devDependencies` (`vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` …); remove unused deps (`@typesafe-ai/sdk`, any others with zero imports).
- Ship only runtime-needed `node_modules` (the UI is already bundled by Vite; the server by esbuild). Target: installed size < 100 MB (from ~184 MB / 432 packages).
- **Progress:** done. Runtime `dependencies` are now only `@napi-rs/canvas`, `nspell` and `cspell-lib`; everything else moved to dev, and `@typesafe-ai/sdk` was removed. `app.asar` went from 183 MB to 7.1 MB, packaged packages from 432 to 101, and `resources/` from 268 MB to 74 MB. The full unpacked install is about 440 MB; the Electron runtime itself accounts for roughly 365 MB of that, and no app-side change can shrink it.

### R2.5 CI & repository hygiene
- `permissions: contents: read` in every workflow; actions pinned by commit SHA; `npm ci` only (drop `|| npm install`).
- Dependabot (npm + github-actions); CycloneDX SBOM attached to every release; `npm audit` gate stays at `high`.
- Branch protection on `main`: required checks, no direct pushes.
- Conventional commits + generated `CHANGELOG.md`; semver tags.
- Remove hard-coded `C:/Users/balfa/...` paths from `scripts/find-vaults.mjs` and `scripts/check-live-data.mjs`; de-duplicate the four copies of the logo PNG.
- **Progress:** done: workflow permissions, SHA-pinned actions, `npm ci` only, Dependabot, the CycloneDX SBOM artifact, `CHANGELOG.md` with the commit convention, and the hard-coded paths. **Open:** branch protection (a repository setting the owner must change) and a generated changelog (it is hand-maintained for now). The logo de-duplication (fb78d23) and attaching the SBOM to releases (2f77c4e) are done.

**Exit R2:** a tagged release produces signed, fused, SBOM-carrying artifacts from CI with no manual steps, and an installed build auto-updates to the next signed release.

---

## R3 — Architecture for scale · ~4–6 weeks

**Theme:** remove the structural ceilings. Today every save rewrites all of `vectors.json`, every Ask decrypts and scans everything, and the server shares Electron's main thread — stalls start around 2–3k entries and reach seconds at ~10k.

### R3.1 Process isolation (do first — independent of storage)
- Run the backend in an Electron `utilityProcess` instead of inside the main process: Argon2, parsing and regex work can no longer freeze the window.
- Document parsing (pdf/docx/xlsx) in a worker with memory and time limits; a hostile file kills the worker, not the app.
- **Progress (2026-11-03, `roadmap/r1-data-safety`):** both done.
  - fd4dfcd: the server runs in a `utilityProcess` ("IndexArc Vault Server"). The shell mints the pairing token and holds it and the settings wrap key in module variables; only the server's env gets them. The port arrives over `parentPort`. Quit = renderer flush, then a `shutdown` message (emergency snapshot flush, watchers stopped). A crashed server restarts on the same port and the window reloads; more than 3 crashes a minute closes the app. The server now has its own `unhandledRejection`/`uncaughtException` handlers (closes R1 finding 1.4g). Verified in a packaged build: the window loads from the utility process, and killing it restarts it with the same identity.
  - Parsing: `server/services/docParse.ts` runs mammoth/pdf.js/exceljs in a `worker_threads` worker (`dist/parse-worker.cjs`, second esbuild entry, in the dist manifest) with a 512 MB heap limit and a hard deadline that terminates the thread. Tests cover the real bundle, a hung parser and a heap blow-up. Source runs (tsx/vitest) without the bundle parse in-process.
  - **Open:** a PDF scan in an installed build (needs the `@napi-rs/**` unpack rule to resolve from the worker, same as from `server.cjs`).

### R3.2 Storage engine *(needs an ADR: SQLite + per-record AES-GCM with AAD vs SQLCipher)*
- Move vault, vectors, notes, revisions and scan sessions into SQLite (WAL mode, real transactions).
- Recommended: SQLite + application-level AES-GCM per record with AAD = `(table, id, schema)` — keeps the current key model and Argon2id, adds AAD binding (today ciphertexts can be swapped between files undetected), avoids a native crypto build.
- Vector search via `sqlite-vec` (or an HNSW index) instead of a linear scan.
- One-way migration with automatic pre-migration snapshot and a tested rollback path; JSON import/export kept as the portability and backup format.
- *Accept:* benchmark suite (bar #5) passes at 10k entries; migration tested on real-shaped fixtures, including encrypted and grace-period vaults.
- **Progress (b105882, ADR `docs/adr/0001-storage-engine.md`):** done with SQLite (`node:sqlite`, WAL) and per-record AES-256-GCM with AAD `indexarc:v2:<table>:<id>`.
  - `vault.json` is now a header; rows live in `data/vault.db`. The migration snapshots first, then migrates one way at unlock, and falls back to JSON if it fails.
  - A re-key keeps the old key sealed under the new one (`prev_key`) until every row is rewritten, so a crash mid-re-key is recovered at the next unlock.
  - 10k-entry benchmark: unlock ~130 ms, list ~285 ms, create/update/delete/upsert 3–11 ms.
  - Budgets enforced in CI since 2026-11-04 (`npm run bench`, job "Performance budgets"): p95 save < 50 ms, p95 Ask < 300 ms (local pipeline; the model call is excluded), unlock and list < 1.5 s. Local run: save p95 1.6 ms, Ask p95 126 ms, unlock 476 ms (includes Argon2id), list 264 ms. "UI never blocked > 100 ms" is not measured yet.
  - A real 3k-entry vault migrated from 78 MB of JSON to a 39 MB database. Fixing `/health` (snapshot header peek) took the Library from ~21 s to 1.9 s.
  - **Not done:** `sqlite-vec`/HNSW. Vector search is still a linear scan over decrypted rows, which is fast enough at 10k. Rollback of a single row is detected by a keyed row checksum (2026-11-04); rollback of the whole vault is not.

### R3.3 AI provider interface
- One `Provider` interface (`generate`, `embed`, `complete`, `isLocal`, `health`) with an adapter per provider; consent and egress checks live in one wrapper, not in six if/else chains (`providers.ts`, 1.3k lines).
- *Accept:* adding a provider touches one adapter file plus settings UI.
- **Progress (2026-11-03, `roadmap/r1-data-safety`):** done. `server/ai/adapters/` holds one adapter per provider (`ollama.ts`, `gemini.ts`, `anthropic.ts`, and `openaiCompatible.ts` for OpenAI/Groq/OpenRouter/local OpenAI-compatible servers) behind the `ProviderAdapter` interface (`generate` with `json`/`text`/`complete` modes, optional `embed`/`embedModelId`, `isLocal`, `ready`). `adapters/index.ts` is the registry, and its order is the "auto" preference. `providers.ts` (1,367 → 538 lines) keeps resolution, the egress gate (`callProvider` for every LLM call; `embedText` for embeddings) and the features (analyze, generate, autocomplete, embeddings). Adding a provider = one adapter + one registry line + its settings fields/UI. Labels (`provider_used`) and embedding model ids are unchanged; `server/ai/adapters.test.ts` pins both, plus resolution order and locality. The existing egress tests pass unchanged.

### R3.4 Frontend structure (after R3.1–R3.3 are stable; no behavior change)
- Split `ScratchpadTab.tsx` (4k lines, 52 `useState`) into editor, tabs, AI actions, spellcheck and persistence modules; `App.tsx` (1.7k) and `SettingsTab.tsx` (1.1k) likewise.
- One state store for vault/session state (e.g. Zustand) so lock purging is one call, not a list of setters.
- Virtualize the Library list.
- **Progress (2026-11-04, `roadmap/r1-data-safety`):** step 1 of the split. `ScratchpadTab.tsx` 4,069 → ~2,160 lines. Pure helpers moved to `src/components/scratchpad/` (`revisions.ts`, `constants.ts`, `noteTabs.ts`, `domText.ts`, `CompareCell.tsx`). Nine render sections became components there (`NoteTabStrip`, `EditorPanel`, `FormattingToolbar`, `ArchiveSection`, `ArchivedNotePreview`, `RevisionHistoryModal`, `ProtectModal`, `RescueModal`, `CompareModal`). The moved JSX is verbatim, and props are exactly the component locals each block used, typed from the compiler. Checked in the built app: typing, tabs, bold, compare (with swap), revision history, rescue, protect, colour picker, archive → view → restore, rename, spelling menu; no console errors.
  - **Step 2 done:** the component's logic is moved verbatim into 11 hooks in `src/components/scratchpad/` (`useScratchEditor`, `useEditorCommands`, `useSpellcheck`, `usePredictions`, `useNoteProtection`, `useArchive`, `useNoteHistory`, `useTabActions`, `useNoteActions`, `useScratchpadSync`, `useScrollAffordances`). `ScratchpadTab.tsx` is 604 lines (was ~4k). Effect order is kept, except two independent listeners. Checked in the built app: typing, spellcheck and suggestions, compare, version history, new and close tab, pin, protect and unprotect, archive and restore, predictions toggle.
  - **Step 3 done:** `SettingsTab.tsx` 1,142 → 212 lines: 11 section components in `src/components/settings/` (plus `fields.tsx` for `KeyInput` and `SavedBadge`). `App.tsx` 1,706 → 735 lines: `TopBar`, `Sidebar`, `HealthBanners`, `EncryptMigrationBanner` and `DialogModals` in `src/components/app/`, plus 8 hooks there (`useToasts`, `useConfirmDialog`, `useSettingsPatch`, `usePasteActions`, `useClarify`, `useEntryActions`, `useSettingsActions`, `useFolderScanActions`). No file in `src/components` is over 800 lines now (largest: `LibraryTab.tsx` 597).
  - **Done since:** the state store (1385b32: `src/state/vaultStore.ts`, lock purge is one `purgeSecrets()` call) and Library virtualization (ed29a02).
  - **Existing quirk seen (not changed):** a rename lives only in memory for the session; after a reload, the first edit re-derives the title from the content. Pinning a brand-new tab before its first save returns 404, and the second click works.
  - **Existing quirk seen (not changed):** after archiving a tab, the remaining tabs show their stored title (e.g. "Scratch 1") until the next edit re-derives the title from the content.

**Exit R3:** benchmarks green at 10k entries; no file over ~800 lines in `src/components`; window stays responsive during unlock, scan and Ask.

---

## R4 — Verification · continuous, ~3–4 weeks of focused work

**Theme:** prove behavior instead of asserting it. Runs alongside R1–R3; each item lands with the code it protects where possible.

- **Route lock matrix:** supertest over every `/api` route × {locked, unlocked, no token, wrong host, cross-site} — generated from the route table so a new route without a policy fails CI.
- **Egress tests:** for each AI path, assert which providers can receive which fields (values, notes, metadata) under consent on/off.
- **End-to-end:** Playwright for Electron — launch → set password → paste → save → lock → restart → unlock → verify; plus the reinstall-preservation flow.
- **Fuzzing:** heuristics and parsers with random/structured input; a `safe-regex`/`eslint-plugin-redos` lint rule so quadratic patterns can't come back.
- **Crypto property tests:** envelope round-trips, tamper detection, KDF parameter bounds, AAD mismatch rejection (after R3.2).
- **UI:** component tests for lock purge, protect/unprotect, conflict handling; accessibility pass (dialogs get `role="dialog"`, `aria-modal`, focus trap, Escape); remaining ~100–150 hardcoded English strings moved to i18n.
- **Coverage gate** on `server/` (start at current level, ratchet up); `any` count tracked and reduced (266 today).

**Exit R4:** CI runs unit, route-matrix, egress, fuzz smoke, and one Electron e2e on every PR.

### R4 progress — landed on `roadmap/r4-verification` (2026-11-03)

- **Testable app factory:** `server/app.ts` exports `createApp({ paths, store, audit, watchers }) → { app, ctx }`, which mounts the security headers, `apiAuthMiddleware`, the `protectedPaths` lock gate and every route module. `server.ts` is otherwise unchanged (it still runs the startup side effects, the auto-lock timer, vite/static, the 404/error handlers and listen). The bundle builds, and `node dist/server.cjs` answers `/api/ping`.
- **Route lock matrix** (`server/route-matrix.test.ts`): it walks `app._router.stack`, including mounted routers, and finds **66 `/api` routes**. Each route is checked against an explicit `POLICY` table (1 public, 27 token, 38 token+unlocked) in these states: no token → 401; wrong Host → 403 (with or without a token); `Sec-Fetch-Site: cross-site` → 403; vault locked with a token → 423 for gated routes, while the other routes still answer. Before locking, the test seeds secrets into an entry value, its notes, a note body, a note revision and an API key. No locked response may contain any of them. The suite fails on a route without a policy, a stale policy row, a duplicate registration, or disagreement with `protectedPaths`. It also covers the `/api/events` one-time ticket and the dev-only `/api/auth/bootstrap`. Not covered yet: the unlocked-state pass, which would run real handlers.
- **Egress tests** (`server/egress.test.ts`): they stub `fetch`, including the Gemini SDK's calls, and drive `generateText`, `embedText`, `autoComplete`, `analyzePaste`, `askVault`, `indexEntry`, `/api/ask`, `/rewrite`, `/autocomplete`, `/proofread`, `/analyze` and `/entries/save`. With consent OFF, nothing leaves loopback for any cloud provider, override or remote `local_openai`. With consent ON, no entry value, note or note body reaches a cloud body. **3 bugs found, marked `it.fails`:**
  1. `checkOllama` probes a non-loopback `ollama_base_url` (`GET /api/tags`) even with consent OFF. The probe carries no data.
  2. `embedText` falls back to **Gemini** when the user pinned a local provider (`ai_provider` or `llm_provider_override` = `local`) and Ollama is offline. `indexEntry` reaches this on every save. Only metadata is sent.
  3. `embed_provider_override` is ignored by `indexEntry` and `askVault`, because they pass the resolved LLM provider as the explicit override.
- **Regex timing guard** (`server/ai/regex-safety.test.ts`): it parses all 68 regex literals in `heuristics.ts` and `folderScan.ts` with the TS compiler and runs each against 47 adversarial ~50k inputs in a worker with a watchdog. The budget is 100 ms per `test()`. **2 quadratic patterns found** in `heuristics.ts` and kept in `KNOWN_SLOW` with `it.fails`: `/\s*(?:&&|\|\||;)\s*/` (`isCommand` split, ~2.2 s at 50k spaces) and `/\s*[=\-_*]{3,}\s*/g` (`stripSectionRule`, ~1.9 s). This test is a stand-in for the `safe-regex` lint rule, which is still open.
- **Policy notes from the matrix (for review, unchanged):** `POST /api/settings` is writable while the vault is locked. A token holder can flip `ai_cloud_consent` or repoint `ollama_base_url` and `local_openai_base_url` before the user unlocks. `POST /api/ollama/ensure` (multi-GB model pulls) and `/api/emergency/create` are also reachable while locked.
- **Done since:** crypto property tests with fast-check, fuzz smoke, and a v8 coverage gate on `server/` (9423244). That commit also requires 16-byte GCM tags. Electron e2e lifecycle test in CI (1c88816). Accessible dialogs and the remaining UI strings in i18n (2778101). The three egress bugs and both quadratic regexes are fixed: `KNOWN_SLOW` is empty and no `it.fails` remain. The matrix now also checks that every `GET /api` route answers with `Cache-Control: no-store`.
- **Still open:** the unlocked-state pass of the route matrix, an eslint `safe-regex` rule (the timing guard stands in for it), and CodeQL. One e2e run in five failed during the R6 work without a captured cause; it is a suspected flake, being watched.

---

## R5 — Independent assurance & key handling · ~2 weeks + vendor time

**Theme:** someone else confirms the claims; key handling reaches password-manager norms.

- **Standards mapping:** OWASP ASVS Level 2 and the Electron security checklist, with evidence links, in `docs/`.
- **Threat model refresh** after R3 (new process boundaries, new storage).
- **External penetration test** *(needs an owner decision: vendor and budget)* against `THREAT-MODEL.md`; findings tracked to closure.
- **Disclosure:** `SECURITY.md` reporting address and SLA, `security.txt`, advisory/CVE process via GitHub Security Advisories.
- **Key handling:** zeroize derived keys after use and on lock/remove-password/upgrade; enforce the 16-byte GCM tag length; AAD everywhere (with R3.2).
- **Unlock options:** Windows Hello / Touch ID (OS-bound key that wraps the vault key), optional WebAuthn security key; master password stays the root.
- **Recovery kit:** printable emergency kit / recovery key generated at setup, so "lost password = lost data" becomes a choice, not the only outcome.
- **Diagnostics:** one-click redacted diagnostics export; opt-in crash reporting that never carries values (redaction reuses the heuristics' own detectors).

**Exit R5:** pentest report published internally with every high/critical closed; ASVS L2 mapping complete.

**Progress (bc0180a):**
- **Standards:** `docs/ASVS-L2.md` maps ASVS L2 and the Electron checklist with evidence links. Gaps are listed there and under "Where things stand".
- **Threat model and disclosure:** `docs/THREAT-MODEL.md` is refreshed for the utilityProcess and SQLite. `SECURITY.md` gives the reporting channel and SLA, `public/.well-known/security.txt` is in place, and advisories go through GitHub Security Advisories.
- **Key handling:** Argon2 output and temporary keys are zeroized; GCM tag length is enforced (9423244); rows carry AAD.
- **Password change and recovery key:**
  - Password change re-keys everything crash-safely.
  - The optional recovery key is an X25519 key pair. The code, shown once, is the private key. `data/recovery.json` holds only the public key and the vault key sealed to it, and it is resealed after every key change.
  - "Forgot password" on the lock screen recovers the vault and sets a new password.
- **Diagnostics:**
  - Health → "Download report" exports health, logs and settings, redacted by the heuristics' own detectors plus key/URL/email/home-path rules.
  - Opt-in crash logging stays local (`logs/crashes.jsonl`).
- **Open:** the pentest (owner), Windows Hello / Touch ID and WebAuthn (native module), and a printable emergency kit (today the recovery code is shown once to copy; there is no designed kit).

---

## R6 — Product: from vault app to developer secrets tool · later, scoped separately

These are what make people choose IndexArc over a generic password manager. Each gets its own design doc before work starts.

1. **CLI and secret injection:** `indexarc get NAME`, `indexarc run -- npm start` (inject as env vars, like `op run`), talking to the running app over the authenticated local API.
2. **Import/export:** `.env`, 1Password, Bitwarden, KeePass; encrypted export format.
3. **Secret hygiene:** expiry dates, rotation reminders, "where is this key used" (watched folders), gitleaks-compatible detection rules shared with the heuristics.
4. **Hosted mode** (old EXECUTION_PLAN Phase 5, still deferred): HOSTED=1 session auth, feature gating, Docker volume guide.
5. **Sync and sharing:** end-to-end encrypted multi-device sync, then team sharing — a new threat model, explicitly out of scope until R1–R5 exit.

**Progress (2026-11-04):**
- **R6.1 CLI (34efe6f, `docs/design/R6.1-cli.md`):**
  - `indexarc get | env | run -- cmd | login | status` talks to the running, unlocked app.
  - Tokens are created in Settings → CLI access after the master password, shown once, and revocable. They authenticate only the two read endpoints.
  - Tokens are stored as HMAC digests keyed from the vault key, so a planted digest does not work, and a re-key revokes them.
  - CLI reads are audited and do not extend auto-lock.
  - The CLI ships in `resources/cli/` and runs on the user's Node 18 or later.
- **R6.2 Import/export (99e078d):**
  - Import from `.env`, Bitwarden JSON, 1Password/generic CSV, KeePass XML and IndexArc exports, with review and de-duplication before saving.
  - Export to an encrypted `.iaexport` (Argon2id + AES-GCM, passphrase of 12+ characters) or a plain `.env` behind an explicit warning.
  - Both need the master password and are throttled and audited.
- **R6.3 Hygiene (99e078d):** per-secret expiry, rotation period and "mark rotated"; a Home card for expired, expiring and due secrets; "where used" is a bounded local search of watched folders. Not done: gitleaks-compatible rule export.
- **R6.4/R6.5 Hosted mode and sync:** designed in `docs/design/R6-hosted-and-sync.md`.
  - The design covers a key split, integrity at rest, single-user hosting behind TLS, and a relay that only stores encrypted blobs, with signed manifests.
  - **Not built**, by design: the doc's ship gates (pentest, signing, password policy) come first, and it ships behind a build flag.

---

## Phase 4 items from the old plan — where they went

| Old item | Status 2026-11-02 | Now |
|---|---|---|
| P4.1 KDF upgrade | Done (Argon2id, migration tested) | — |
| P4.2 OS-level secrets at rest | Done for packaged builds (safeStorage) | Edge cases in R1.3 |
| P4.3 Clipboard hygiene | Done in R0 (fixed 45 s) | Setting in R1.5 |
| P4.4 CI | Mostly done (tsc, tests, audit gate, pinned actions, Dependabot, SBOM) | R2.5 (branch protection open) |
| P4.5 Release trust | Not started | R2.1–R2.3 |
| P4.6 Strict TypeScript | Done for `.ts` | `.cjs` in R2.2, `any` burn-down in R4 |
| P4.7 Test pyramid | Partial (server unit tests only) | R4 |
| P4.8 i18n + RTL | Partial | R4 |
| P4.9 Docs truth pass + diagnostics | Docs done in R0 | Diagnostics in R5 |

---

## Decisions needed from the owner

| Decision | Blocks | Recommendation |
|---|---|---|
| Code-signing certificate: OV or EV, and budget | R2.1, R2.3 | OV to start (cheaper, CI-friendly); EV later for instant SmartScreen reputation |
| Update hosting | R2.3 | **Decided:** GitHub Releases (built) |
| Keep macOS/Linux targets before signing is funded | R2.1 | Ship Windows only until macOS notarization is set up |
| Storage engine ADR | R3.2 | **Decided:** SQLite + per-record AES-GCM with AAD (built, ADR 0001) |
| Windows Hello / Touch ID (needs a native module) | R5 | Decide whether a signed native module is acceptable; it only makes sense after R2.1 |
| Pentest vendor and timing | R5 | After R3 lands, so the test covers the final architecture |
| Un-defer hosted mode | R6.4 | Not before R5 exit |

---

## Dependency map

```
R0 (done) ──► R1 ──────────────┐
          └─► R2 (parallel) ───┼──► R5 pentest ──► R6
R3.1 isolation ─► R3.2 storage ─► R3.3 providers ─► R3.4 UI split
R4 runs alongside everything; R4 route matrix should land before R3.2
```

**Rough total to "industrial grade" (R1–R5):** about 13–18 engineer-weeks, plus certificate procurement and pentest vendor lead time.

**Start next (2026-11-04):** the owner items (certificate, branch protection, pentest booking). In parallel, the password-policy ASVS gaps (small, self-contained) and AAD on the JSON envelopes.
