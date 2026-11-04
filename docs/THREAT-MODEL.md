# IndexArc Threat Model

Version 2.2 · 2026-11-04 · Scope: the desktop app (Electron shell, vault
server in an Electron utilityProcess, document-parse worker, sandboxed
renderer), its on-disk data, its update channel, and its optional network
egress paths.

Standards mapping with evidence links: [ASVS-L2.md](ASVS-L2.md).

## 0. Architecture at a glance

```
┌──────────────────────── Electron main (shell) ────────────────────────┐
│ mints 256-bit pairing token · OS-sealed settings key (safeStorage)    │
│ verifies dist/ against manifest in app.asar · IPC gate (handleTrusted)│
│ auto-update (GitHub Releases, install only on signed builds)          │
└──────┬──────────────────────────────┬─────────────────────────────────┘
       │ env: token, settings key     │ IPC (invoke-only bridge, preload.cjs)
       │ parentPort: listening port   │
┌──────▼──────────────── utilityProcess ──┐   ┌──────── Renderer ─────────┐
│ Express vault server on 127.0.0.1       │◄──┤ sandbox, contextIsolation │
│ token + Host + Sec-Fetch-Site + lock    │HTTP│ CSP script-src 'self'    │
│ crypto, store, SQLite, audit            │   │ token in memory only      │
│   └─ worker_threads: docParse           │   └───────────────────────────┘
│      (512 MB heap, ~35 s deadline)      │
└──────┬──────────────────────────────────┘
       │ files
  data/vault.json (sealed header) · data/vault.db (per-row AES-GCM + AAD)
  data/*.json envelopes · config/settings.json (enc:v1: keys) · backups/
  %APPDATA%\IndexArc\emergency · ~/.IndexArc/emergency
```

## 1. Assets

| Asset | Where |
|---|---|
| Vault entries (secret values) | `data/vault.db`, table `entries`: one row per record, AES-256-GCM with AAD `indexarc:v2:entries:<id>` |
| Vault header / key check | `data/vault.json` (small sealed header: `{version:2, storage:"sqlite", kdf, salt, iv, authTag, ciphertext}`) |
| Semantic index | `data/vault.db`, table `vectors` (sealed rows; redacted inputs since schema 2) |
| Notes / archive / revisions | `data/scratchpad*.json`, `data/note_revisions.json` (AES-GCM envelopes, no AAD) |
| Scan sessions (extracted secrets from disk scans) | `data/scan_sessions.json` (envelope) |
| AI provider API keys | `config/settings.json` (wrapped `enc:v1:` under an OS-sealed key in `config/settings.key.enc`) |
| Backups / emergency snapshots | `backups/` (incl. `vault-db-<stamp>.{enc,plain}.sqlite`), `%APPDATA%/IndexArc/emergency`, `~/.IndexArc/emergency` |
| Integrity manifest + audit chain | `data/manifest.json` (+ HMAC key file), `data/audit.log` |
| Master password / vault key | Password never stored; Argon2id-derived key lives only in the server process while unlocked |
| Pairing token | Shell memory, server-process env, renderer module memory; new per launch |
| Recovery code / sealed key | `data/recovery.json` (current vault key sealed to an X25519 public key); the code (the private key) is shown once and never stored |
| Update channel | GitHub Releases (`Mubder/IndexArc`): installers + `latest*.yml` |

## 2. Adversaries

- **A1 — Malicious web page** in the user's browser (DNS rebinding, CSRF,
  cross-site fetch).
- **A2 — Malicious local process** running as the same user.
- **A3 — Physical/disk access**: stolen laptop, copied folders, cloud-synced
  profile, forensics on a disk image.
- **A4 — Supply chain**: compromised dependency, tampered installer or
  update, tampered Ollama download.
- **A5 — Cloud AI provider** (only if the user opts in): sees vault-derived
  text.
- **A6 — User error / bit rot**: accidental deletion, crashed editors,
  hand-edited files, machine loss mid-write.
- **A7 — Hostile document**: a file the user scans that targets a parser
  (zip bomb, parser exploit, pathological input).

## 3. Trust boundaries & controls

### Renderer ↔ Main/Server (boundary 1)
Controls: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`;
invoke-only IPC bridge (13 `invoke` channels, one `send` for the quit
handshake, update event subscriptions; [preload.cjs](../preload.cjs)); every
`invoke` handler runs through `handleTrusted`, which accepts only the main
window's top frame showing the local server origin; CSP `script-src 'self'`
(meta tag and HTTP header); `will-navigate` veto to the local origin only;
deny-all permission request and check handlers; window-open handed to the OS
browser after parsed-URL scheme checks; note HTML sanitized at write
(DOMPurify allowlist), at ingest, and at render; DevTools only in unpackaged
runs. Residual: a fully compromised renderer holds the session API token —
it is the user's own session, equivalent to the user. The `flush-complete`
IPC listener is not sender-checked (low impact: it only completes the quit
handshake).

### Shell ↔ vault server process (boundary 1b — new in R3.1)
The vault server runs in an Electron `utilityProcess`, not in the main
process. The shell mints the pairing token and the settings wrap key and
passes them **only in the child's environment**; the main process's own env,
which Ollama and LanguageTool children inherit, never holds them, and
[shared/child-env.cjs](../shared/child-env.cjs) strips them from any child the
server spawns. The server reports its actual bound port over `parentPort`;
the shell then loads the window only after `/api/ping` returns the SHA-256
fingerprint of its own token (port squatters fail this). Before forking, a
packaged shell verifies every file in the unpacked `dist/` against a hash
manifest stored inside the integrity-checked `app.asar`
([shared/verify-dist.cjs](../shared/verify-dist.cjs)). A crashed server is
restarted (at most 3 times a minute) and the window reloads from the new
instance. Residual (A2): the env of a same-user process is readable by
other same-user processes on all three OSes.

### Local HTTP server ↔ everything else (boundary 2)
Controls: binds `127.0.0.1` only (the shell forces `HOST=127.0.0.1`); the
per-process 32-byte token on every `/api` call, compared in constant time;
Host allowlist (kills DNS rebinding); `Sec-Fetch-Site: cross-site`
rejection; no CORS headers anywhere; one-time 30 s SSE tickets;
`/api/auth/bootstrap` (token handout) disabled in production builds — the
token only travels the Electron IPC bridge; port collisions walk +20 then go
ephemeral. Secret-bearing routes additionally require the vault to be
unlocked; the route-matrix test enforces an explicit policy for every route
([server/route-matrix.test.ts](../server/route-matrix.test.ts)). While
locked, only cosmetic settings may change. Residual (A2): a local process
that can already impersonate the user (read the server env, inject into the
renderer) reaches the API — out of scope for a same-user threat model;
named-pipe or custom-protocol transport is the documented future hardening.
`/api` responses do not yet send `Cache-Control: no-store`, so Chromium may
cache decrypted responses in the Electron profile (tracked gap, see
[ASVS-L2.md](ASVS-L2.md) 8.2.1).

### Document parsing (boundary 2b — A7, new in R3.1)
Binary documents (.docx/.pdf/.xlsx) from folder scans are parsed in a
`worker_threads` worker ([server/services/docParse.ts](../server/services/docParse.ts))
with a 512 MB old-generation heap cap, a 64 MB young-generation cap and a
hard deadline (30 s parser timeout + 5 s margin); on timeout or OOM the
worker is terminated, not just abandoned. Before parsing: size caps (512 KB
text, 5 MB documents), a zip central-directory budget (64 MB uncompressed,
5,000 entries, no ZIP64), traversal budgets (500 files, depth 12, 4,000
directories), and no symlink-following out of a watched folder. The input
buffer is copied into a fresh `ArrayBuffer` so pooled memory never reaches
the worker. Residual: the worker shares the server's process and OS
identity — it bounds resource exhaustion and crashes, not a parser
code-execution exploit. Source runs (tsx/vitest) parse in-process.

### Secrets at rest (boundary 3 — A3)
Controls: Argon2id (64 MiB / t=3 / p=4) KDF, versioned in every envelope
(`kdf` field) with silent migration and enforced parameter/salt bounds (a
tampered envelope cannot downgrade derivation); AES-256-GCM with a fresh
96-bit IV per write and a mandatory 16-byte tag.

**Storage v2** ([ADR 0001](adr/0001-storage-engine.md)): `data/vault.json`
is a small sealed header whose ciphertext is the unlock key check;
records live in `data/vault.db` (SQLite via `node:sqlite`), one row per
record, each body sealed separately with AAD `indexarc:v2:<table>:<id>`, so a
ciphertext moved to another row or table fails authentication. Pragmas:
WAL, `synchronous=FULL`, `secure_delete=ON` (freed pages are zeroed). Key
changes follow a crash-safe ordering and `reconcileDbKey` repairs any
mismatch at unlock. Fail-closed: when encryption is expected but the header
is missing or unreadable, reads return empty and plaintext writes are
refused (`refusePlaintextWrite`); a corrupt header refuses unlock and is
quarantined, never overwritten.

Also: notes, archive, revisions and scan sessions are separate JSON
envelopes; encrypted-by-default onboarding (mandatory first-run master
password); settings API keys wrapped under an Electron `safeStorage`
(DPAPI/Keychain/libsecret) key; lock zeroizes the derived key and purges all
decrypted caches; stale atomic-write `.tmp` swept at startup.

**Visible at rest (accepted):** with file access an attacker sees the number
of entries and vectors, each row's size and random UUID id, the `meta` table
(`enc`, `salt`, `kdf`, `schema`, `rev`), file names and sizes of the JSON
envelopes, and file timestamps. v1 exposed only total size.

**Not detected (accepted, follow-up in R5):** deleting a row, or replacing a
row with an older sealed copy of the same row (same table and id), passes
GCM authentication. The same holds for swapping a whole JSON envelope for
an older one, and — because those envelopes carry no AAD — for swapping one
envelope file for another of the same vault. A keyed `rev`/Merkle root in
the header and AAD on every envelope are the planned fixes.

Residual: **the master password is the root key** — offline guessing
against stolen files is bounded by Argon2id economics; the minimum length
is 8 characters with no common-password check (tracked gap). Pagefile/swap
and GC'd JS strings can retain key material (inherent to Node; mitigated by
zeroizing key buffers and purging caches on lock, never storing the
password). Backups fan out to three locations — ciphertext once encryption
is on.

### Recovery key (boundary 3b)
Added in R5: [server/recovery.ts](../server/recovery.ts), `/api/vault/recovery*` and
`/api/vault/recover` in [server/routes/vault.ts](../server/routes/vault.ts), tests in
[server/recovery.test.ts](../server/recovery.test.ts).
Design: the user creates a recovery key at setup or later in Settings
(requires the master password). The recovery code **is** a raw 256-bit
X25519 private key (Crockford base32 with a 3-byte checksum) and is shown
**once**; only the public key is stored. `data/recovery.json` holds the
current vault key sealed to that public key (ephemeral X25519 + HKDF-SHA256 +
AES-256-GCM with a fixed AAD). The store re-seals it after every key change,
so it never needs the private key. Entering the code on the lock screen
unseals the vault key and sets a new master password.

Threat: **anyone who holds the recovery code and a copy of the data files
can open the vault**, exactly like the master password. The code is a second
root secret. Consequences and controls:

- Offline guessing is infeasible (256-bit code, no stretching needed); the
  real risk is disclosure of the code (printout, photo, password-manager
  sync, shoulder-surfing at the one-time display).
- `recovery.json` travels with backups and emergency snapshots. A leaked
  code plus **any** snapshot taken while that code was valid opens that
  snapshot; rotating the code cannot recall old snapshots.
- Changing the master password does **not** revoke the recovery path (the
  seal is refreshed to the new key). Only "create a new recovery key" or
  "remove recovery key" does. The UI and docs must say so.
- `/api/vault/recover` is reachable while locked (it is the forgot-password
  entry point): token-gated, throttled to 5 attempts/min, audit-logged.
  Creating a code needs the master password; removing one needs an unlocked
  vault.
- A stale seal (vault restored from an older copy, or key replaced) is
  detected and refused. The seal's AAD is fixed and not bound to a vault id;
  swapping in another vault's `recovery.json` only yields that vault's key,
  so the impact is limited, but binding the vault id is a cheap hardening.
- Until this ships, lost password = lost data.

### Network egress (boundary 4 — A5)
Controls: cloud AI providers and the public LanguageTool API are **off by
default** (`ai_cloud_consent`, `languagetool_enabled`); loopback providers
(Ollama / LM Studio on 127.0.0.1) need no consent; a "local" provider pointed
at a non-loopback host counts as cloud; **secret values, raw fragments, and
note bodies never enter cloud-bound text** — embeddings and LLM context
carry names/types/labels only; legacy vectors built from secret-bearing text
are dropped (schema 2) and re-embedded redacted; consent changes are
audit-logged; consent and endpoints cannot be changed while locked. The
Ollama installer download is size-capped and **Authenticode-verified
(status `Valid` and exact signer match) before execution**. Update checks
are off by default (`update_check_on_start: false`) and only run on user
request. Residual: a user who enables consent accepts metadata egress to the
chosen provider, and a user-configured endpoint may be `http://`.

### Update channel (boundary 4b — A4, new in R2.3)
Controls ([shared/updater.cjs](../shared/updater.cjs)): electron-updater
reads `latest.yml` from GitHub Releases over HTTPS; no auto-download, no
install on quit, no prereleases, no downgrades. Download and install are
enabled **only** on an installed (NSIS) Windows build whose
`app-update.yml` carries a `publisherName` — which electron-builder writes
only for signed builds — so electron-updater verifies the Authenticode
signature of the update against that publisher. Unsigned, portable, macOS
and Linux builds only report that a new version exists and link to the
release page. Release CI attaches artifacts and a CycloneDX SBOM; only the
release job has `contents: write`; all Actions are SHA-pinned. Residual:
**releases are currently unsigned** ([RELEASE.md](RELEASE.md)), so no build
self-installs yet, and the first install's integrity rests on the GitHub
download alone. A compromised GitHub account or release could publish a
malicious installer that users install by hand. Fuses (`runAsNode` off,
`NODE_OPTIONS` off, inspect off, asar integrity, only-load-from-asar) only
protect a package whose signature is checked.

### Tamper/forensics (boundary 5 — A6 and partial A3)
Controls: atomic writes for JSON files and SQLite transactions for records;
quarantine-never-overwrite on unreadable files; HMAC integrity manifest
(recovery aid — key sits next to data, documented); hash-chained audit log
(`data/audit.log`) with rotation and a persisted anchor, covering
unlock/failure, lock, encrypt/decrypt, restore, protect/unprotect, consent
flips, settings changes; three-location emergency snapshots (now including a
consistent `VACUUM INTO` copy of `vault.db`) refreshed 10 s after every
write and at quit; locked-state restore refuses any snapshot with plaintext
rows; enabling encryption moves (never deletes) pre-existing plaintext
backups to `backups/plaintext-grace/` until the first unlock ≥24 h later;
reinstall-proof installer (proven by an automated
install→write→reinstall→assert CI job). Residual: the manifest and audit
chain are unkeyed against a full-write attacker; a token holder can restore
an older *encrypted* snapshot (rollback) while locked.

## 4. Deliberate non-goals
- Defending against an adversary with **admin/kernel** on a live unlocked
  session (they own the machine).
- Defending against a same-user process that reads another process's memory
  or environment (A2 beyond the HTTP boundary).
- Hiding the fact that IndexArc is installed, or how many entries it holds.
- Anti-copy protection for portable installs.

## 5. Prerequisites to full industrial posture
See [RELEASE.md](RELEASE.md) and [ASVS-L2.md](ASVS-L2.md#gap-summary):
Authenticode signing certificate + signed artifacts (unblocks the signed
update path that is already in code), `Cache-Control: no-store` on `/api`,
whole-vault rollback detection (row rollback and AAD on every envelope have landed),
the recovery key (shipping with clear rotation guidance), and an external penetration test against
this model.

## 6. Changes since last revision (2026-11-04)

Previous revision: 2.1, 2026-09.

| Area | Change |
|---|---|
| Process model | Vault server moved from the main process into an Electron `utilityProcess` (R3.1). Token and settings key are minted by the shell and passed only in the child env; port reported over `parentPort`. New boundary 1b. |
| Parsing | Binary document parsing moved into a `worker_threads` worker with heap and time limits; added adversary A7 and boundary 2b. |
| Storage | Storage v2 (R3.2): `vault.json` is a sealed header; records in `data/vault.db` with per-row AES-GCM and AAD. Documented metadata visible at rest. A keyed row checksum (meta `rowsum`) now detects a single row rolled back, removed or copied in; whole-vault rollback stays undetected. |
| Crypto | 16-byte GCM tag and 12-byte IV now enforced on decrypt; AAD support in `encryptString`/`decryptString`. JSON envelopes still lack AAD (noted). |
| Updates | Signed auto-update via GitHub Releases (R2.3), install only on signed NSIS builds. New boundary 4b. Releases still unsigned. |
| Recovery | Recovery key (X25519-sealed vault key in `data/recovery.json`, one-time recovery code) landed (R5); threat: code + files = vault access; password change does not revoke it. New boundary 3b. A single change-password (re-key) route landed too (no plaintext window). Also new: redacted diagnostics export, opt-in local crash log (messages/stacks only, redacted; never minidumps), `Cache-Control: no-store` on all `/api` responses. |
| Integrity | Packaged shell verifies unpacked `dist/` against a manifest inside `app.asar`; Electron fuses on. |
| Backups | "Enabling encryption scrubs plaintext backups" corrected: they are moved to a 24 h grace area, then deleted. Snapshots carry `vault.db`. |
| IPC | Bridge grew from 10 to 13 `invoke` channels (update check/download/install); all sender-checked via `handleTrusted`. |
| Access control | Locked settings writes limited to cosmetic fields; `/api/proofread`, `/api/rewrite`, `/api/ollama/ensure` added to the unlock-gated list. |
| Gaps recorded | Missing `Cache-Control: no-store` on `/api`; 8-character password minimum. |
