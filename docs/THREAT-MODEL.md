# IndexArc Threat Model

Version 2.1 · 2026-09 · Scope: the desktop app (Electron shell + embedded
Express server + renderer), its on-disk data, and its optional network
egress paths.

## 1. Assets

| Asset | Where |
|---|---|
| Vault entries (secret values) | `data/vault.json` (AES-256-GCM envelope) |
| Notes / archive / revisions | `data/scratchpad*.json`, `data/note_revisions.json` (envelope) |
| Scan sessions (extracted secrets from disk scans) | `data/scan_sessions.json` (envelope) |
| Semantic index | `data/vectors.json` (envelope; redacted inputs since schema 2) |
| AI provider API keys | `config/settings.json` (OS-keychain-wrapped, `enc:v1:`) |
| Backups / emergency snapshots | `backups/`, `%APPDATA%/IndexArc/emergency`, `~/.IndexArc/emergency` |
| Integrity manifest + audit chain | `data/manifest.json`, `data/audit.log` |
| Master password | Exists only in memory while unlocked (Argon2id-derived key) |

## 2. Adversaries

- **A1 — Malicious web page** in the user's browser (DNS rebinding, CSRF,
  cross-site fetch).
- **A2 — Malicious local process** running as the same user.
- **A3 — Physical/disk access**: stolen laptop, copied folders, cloud-synced
  profile, forensics on a disk image.
- **A4 — Supply chain**: compromised dependency, tampered download of the
  installer or the Ollama bundle the app fetches.
- **A5 — Cloud AI provider** (only if the user opts in): sees vault-derived
  text.
- **A6 — User error / bit rot**: accidental deletion, crashed editors,
  hand-edited files, machine loss mid-write.

## 3. Trust boundaries & controls

### Renderer ↔ Main/Server (boundary 1)
Controls: `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`;
10-channel `invoke`-only IPC bridge (preload.cjs); CSP `script-src 'self'`;
`will-navigate` veto to the local origin only; deny-all permission handler;
window-open handed to the OS browser after parsed-URL scheme checks; note
HTML sanitized at write (DOMPurify allowlist), at ingest, and at render.
Residual: a fully compromised renderer holds the session API token — it is
the user's own session, equivalent to the user.

### Local HTTP server ↔ everything else (boundary 2)
Controls: binds `127.0.0.1` only; per-process 32-byte token on every `/api`
call; Host allowlist (kills DNS rebinding); `Sec-Fetch-Site: cross-site`
rejection; no CORS headers anywhere; one-time 30 s SSE tickets; `/api/auth/
bootstrap` (token handout) disabled in production builds — the token only
travels the Electron IPC bridge; port collisions walk +20 then go ephemeral,
and the shell verifies a SHA-256 token fingerprint on `/api/ping` before
loading any window content. Residual (A2): a local process that can already
impersonate the user (e.g. inject into the renderer) reaches the API — out
of scope for a same-user threat model; named-pipe transport is the
documented future hardening.

### Secrets at rest (boundary 3 — A3)
Controls: Argon2id (64 MiB / t=3 / p=4) KDF, versioned in every envelope
(`kdf` field) with silent migration; AES-256-GCM per-file envelopes; scan
sessions inside the envelope; encrypted-by-default onboarding (mandatory
first-run master password); enabling encryption scrubs pre-existing
plaintext backups/snapshots/`.prev`; settings API keys wrapped under an
Electron `safeStorage` (DPAPI/Keychain) key; stale atomic-write `.tmp`
swept at startup. Residual: **the master password is the only key** —
offline guessing against a stolen `vault.json` is bounded solely by Argon2id
economics; pagefile/swap and GC'd JS strings can retain key material
(inherent to Node; mitigated by zeroizing key buffers and purging caches on
lock, never storing the password). Backups fan out to three locations —
they are ciphertext once encryption is on, but deleting them is the user's
choice at restore time.

### Network egress (boundary 4 — A5)
Controls: cloud AI providers and the public LanguageTool API are **off by
default** (`ai_cloud_consent`, `languagetool_enabled`); loopback providers
(Ollama / LM Studio on 127.0.0.1) need no consent; **secret values, raw
fragments, and note bodies never enter cloud-bound text** — embeddings and
LLM context carry names/types/labels only; legacy vectors built from
secret-bearing text are dropped (schema 2) and re-embedded redacted; consent
changes are audit-logged. The Ollama installer download is size-capped and
**Authenticode-verified before execution**. Residual: a user who enables
consent accepts metadata egress to the chosen provider.

### Tamper/forensics (boundary 5 — A6 and partial A3)
Controls: atomic writes; quarantine-never-overwrite on unreadable files;
HMAC integrity manifest (recovery aid — key sits next to data, documented);
hash-chained audit log (`data/audit.log`) covering unlock/failure, lock,
encrypt/decrypt, restore, protect/unprotect, consent flips, settings
changes; three-location emergency snapshots refreshed 10 s after every
write and at quit; reinstall-proof installer (proven by an automated
install→write→reinstall→assert CI job).

## 4. Deliberate non-goals
- Defending against an adversary with **admin/kernel** on a live unlocked
  session (they own the machine).
- Hiding the fact that IndexArc is installed.
- Anti-copy protection for portable installs.

## 5. Prerequisites to full industrial posture
See `docs/RELEASE.md`: Authenticode signing certificate + signed artifacts,
signed auto-update channel, and an external penetration test against this
model. Everything code-side is in place for those to bolt on.
