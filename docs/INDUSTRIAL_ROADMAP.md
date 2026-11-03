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

## Ground rules (carried over, still binding)

1. **One theme per PR.** Storage rewrites, security changes and component extraction never share a PR.
2. **Tests ship with the change they protect**, in the same PR.
3. **No behavior change in extraction/refactor PRs.**
4. **Honesty rule:** README/SECURITY.md must match the code at the end of every phase.
5. **Conventional commits** from now on (`fix(store): …`, `feat(cli): …`) — no more `-` commit subjects; the CHANGELOG is generated from them.

---

## R0 — Fix-now batch ✅ done (2026-11-02, uncommitted at time of writing)

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

### R1.1 Fail-closed storage
- **Quarantine only on parse errors**, never on transient I/O (`EBUSY`, `EPERM`, `EACCES` from antivirus/sync tools): retry with backoff, then surface an error. Today a transient read renames `vault.json`, `isLocked()` turns false, and new entries are written in plaintext (`store.ts` `readJsonOrQuarantine`).
- **Never write plaintext when an encrypted vault ever existed:** persist an `encryption_expected` marker; `writeVault` refuses plaintext while it is set.
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

---

## R2 — Release trust & supply chain · ~2–3 weeks + certificate lead time

**Theme:** a user can trust the binary and the update channel. This is the single biggest gap today.

### R2.1 Code signing *(needs an owner decision: OV vs EV certificate, budget)*
- Windows Authenticode via `build.win` (`certificateSubjectName` or PFX in CI secrets, `signingHashAlgorithms: ["sha256"]`); remove `CSC_IDENTITY_AUTO_DISCOVERY=false` from both workflows.
- macOS: Developer ID + hardened runtime + notarization, or drop macOS targets until funded.
- *Accept:* `signtool verify /pa` passes on every shipped `.exe`; SmartScreen reputation tracked.

### R2.2 Electron hardening
- `@electron/fuses`: `RunAsNode` off, `EnableNodeOptionsEnvironmentVariable` off, `EnableNodeCliInspectArguments` off, `EnableEmbeddedAsarIntegrityValidation` on, `OnlyLoadAppFromAsar` on.
- Stop `asarUnpack: dist/**` (server bundle and UI are swappable plain files today) — unpack only what must be on disk (native `.node`, the pdf worker, dictionaries), and verify the server bundle hash at load.
- Type-check `.cjs` files (`checkJs` or convert `electron-main`/`preload` to TS).

### R2.3 Signed auto-update *(needs an owner decision: GitHub Releases vs static host)*
- `electron-updater` with `verifyUpdateCodeSignature`; staged rollout; the installer-preservation CI job stays the guard.

### R2.4 Package slimming
- Move build-only packages to `devDependencies` (`vite`, `@vitejs/plugin-react`, `@tailwindcss/vite`, `tailwindcss` …); remove unused deps (`@typesafe-ai/sdk`, any others with zero imports).
- Ship only runtime-needed `node_modules` (the UI is already bundled by Vite; the server by esbuild). Target: installed size < 100 MB (from ~184 MB / 432 packages).

### R2.5 CI & repository hygiene
- `permissions: contents: read` in every workflow; actions pinned by commit SHA; `npm ci` only (drop `|| npm install`).
- Dependabot (npm + github-actions); CycloneDX SBOM attached to every release; `npm audit` gate stays at `high`.
- Branch protection on `main`: required checks, no direct pushes.
- Conventional commits + generated `CHANGELOG.md`; semver tags.
- Remove hard-coded `C:/Users/balfa/...` paths from `scripts/find-vaults.mjs` and `scripts/check-live-data.mjs`; de-duplicate the four copies of the logo PNG.

**Exit R2:** a tagged release produces signed, fused, SBOM-carrying artifacts from CI with no manual steps, and an installed build auto-updates to the next signed release.

---

## R3 — Architecture for scale · ~4–6 weeks

**Theme:** remove the structural ceilings. Today every save rewrites all of `vectors.json`, every Ask decrypts and scans everything, and the server shares Electron's main thread — stalls start around 2–3k entries and reach seconds at ~10k.

### R3.1 Process isolation (do first — independent of storage)
- Run the backend in an Electron `utilityProcess` instead of inside the main process: Argon2, parsing and regex work can no longer freeze the window.
- Document parsing (pdf/docx/xlsx) in a worker with memory and time limits; a hostile file kills the worker, not the app.

### R3.2 Storage engine *(needs an ADR: SQLite + per-record AES-GCM with AAD vs SQLCipher)*
- Move vault, vectors, notes, revisions and scan sessions into SQLite (WAL mode, real transactions).
- Recommended: SQLite + application-level AES-GCM per record with AAD = `(table, id, schema)` — keeps the current key model and Argon2id, adds AAD binding (today ciphertexts can be swapped between files undetected), avoids a native crypto build.
- Vector search via `sqlite-vec` (or an HNSW index) instead of a linear scan.
- One-way migration with automatic pre-migration snapshot and a tested rollback path; JSON import/export kept as the portability and backup format.
- *Accept:* benchmark suite (bar #5) passes at 10k entries; migration tested on real-shaped fixtures, including encrypted and grace-period vaults.

### R3.3 AI provider interface
- One `Provider` interface (`generate`, `embed`, `complete`, `isLocal`, `health`) with an adapter per provider; consent and egress checks live in one wrapper, not in six if/else chains (`providers.ts`, 1.3k lines).
- *Accept:* adding a provider touches one adapter file plus settings UI.

### R3.4 Frontend structure (after R3.1–R3.3 are stable; no behavior change)
- Split `ScratchpadTab.tsx` (4k lines, 52 `useState`) into editor, tabs, AI actions, spellcheck and persistence modules; `App.tsx` (1.7k) and `SettingsTab.tsx` (1.1k) likewise.
- One state store for vault/session state (e.g. Zustand) so lock purging is one call, not a list of setters.
- Virtualize the Library list.

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
- Still open: Electron e2e, fuzzing, crypto property tests, UI and a11y, the coverage gate, and CI wiring.

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

---

## R6 — Product: from vault app to developer secrets tool · later, scoped separately

These are what make people choose IndexArc over a generic password manager. Each gets its own design doc before work starts.

1. **CLI and secret injection:** `indexarc get NAME`, `indexarc run -- npm start` (inject as env vars, like `op run`), talking to the running app over the authenticated local API.
2. **Import/export:** `.env`, 1Password, Bitwarden, KeePass; encrypted export format.
3. **Secret hygiene:** expiry dates, rotation reminders, "where is this key used" (watched folders), gitleaks-compatible detection rules shared with the heuristics.
4. **Hosted mode** (old EXECUTION_PLAN Phase 5, still deferred): HOSTED=1 session auth, feature gating, Docker volume guide.
5. **Sync and sharing:** end-to-end encrypted multi-device sync, then team sharing — a new threat model, explicitly out of scope until R1–R5 exit.

---

## Phase 4 items from the old plan — where they went

| Old item | Status 2026-11-02 | Now |
|---|---|---|
| P4.1 KDF upgrade | Done (Argon2id, migration tested) | — |
| P4.2 OS-level secrets at rest | Done for packaged builds (safeStorage) | Edge cases in R1.3 |
| P4.3 Clipboard hygiene | Done in R0 (fixed 45 s) | Setting in R1.5 |
| P4.4 CI | Partial (tsc, tests, audit gate) | R2.5 |
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
| Update hosting | R2.3 | GitHub Releases |
| Keep macOS/Linux targets before signing is funded | R2.1 | Ship Windows only until macOS notarization is set up |
| Storage engine ADR | R3.2 | SQLite + per-record AES-GCM with AAD |
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

**Start next:** commit R0 on its own branch, then R1.1 (fail-closed storage) and R2.5 (CI hygiene) in parallel — different files, no overlap.
