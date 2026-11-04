# R6.4 / R6.5 — Hosted mode and end-to-end encrypted sync: design and threat model

- **Status:** Draft for owner review (2026-11-04). No code yet.
- **Roadmap items:** [R6.4 hosted mode and R6.5 sync and sharing](../INDUSTRIAL_ROADMAP.md#r6--product-from-vault-app-to-developer-secrets-tool--later-scoped-separately). History: [EXECUTION_PLAN.md Phase 5](../EXECUTION_PLAN.md#phase-5--hosted-mode-path-a-one-server-thin-clients).
- **Builds on:** [THREAT-MODEL.md](../THREAT-MODEL.md) v2.2, [ASVS-L2.md](../ASVS-L2.md), [ADR 0001 storage engine](../adr/0001-storage-engine.md), [SECURITY.md](../../SECURITY.md).
- **Code read for this doc:** [server/app.ts](../../server/app.ts), [server/auth.ts](../../server/auth.ts), [server/store.ts](../../server/store.ts) (`setupPasswordImpl`, `unlockImpl`, `changePassword`, `rekeyTo`, `recoverWithCode`, `sealRow`/`openRow`), [server/recovery.ts](../../server/recovery.ts), [server/db/recordDb.ts](../../server/db/recordDb.ts), [server.ts](../../server.ts), [Dockerfile](../../Dockerfile).

---

## 1. Goals, non-goals, and why this is gated

### Goals

| # | Goal |
|---|---|
| G1 | **Hosted mode (R6.4):** one IndexArc server on a machine the user owns (home server, NAS, VPS), reachable from a browser on other devices, with session auth that is safe off-loopback. |
| G2 | **Sync (R6.5a):** the same vault on several devices of **one user**, end-to-end encrypted. The sync backend stores only sealed rows and cannot read, forge, reorder or silently drop them. |
| G3 | Both reuse storage v2 (per-record AES-256-GCM rows) instead of a second storage format. |
| G4 | Every claim in this doc gets a test or a pentest item before it ships (roadmap bars 3, 6, 7). |

### Non-goals (first release)

- Team sharing (R6.5b). Designed in outline in section 5, not built.
- A multi-tenant SaaS run by the project. Hosted mode is **self-hosted, single instance**.
- Hiding that a vault exists, or roughly how many records it holds (same as [THREAT-MODEL.md §4](../THREAT-MODEL.md#4-deliberate-non-goals)).
- Defending a live unlocked session against an attacker with root on that host.
- Real-time collaborative editing of one note. Sync is per record, not per keystroke.

### Why these items are gated

1. **No external pentest yet** (roadmap bar 7). Today's attack surface is "loopback HTTP plus a 256-bit per-process pairing token". Hosted mode makes the API reachable from the network. Sync hands sealed data to a third party. Both are new attack surfaces that nobody but the author has attacked.
2. **The roadmap said "not before R5 exit".** The owner chose to do the **design** now so that R5 and the pentest scope can account for it. This doc does not lift the gate on **shipping**. Section 7 lists the "do not ship until" gates.
3. **Known gaps that become worse off-loopback**, all from [ASVS-L2.md](../ASVS-L2.md#gap-summary) and [THREAT-MODEL.md](../THREAT-MODEL.md):
   - 8-character password minimum, no breached-password check (2.1.1, 2.1.7). Offline guessing is the main risk once sealed rows live on a relay.
   - Row rollback and deletion are not detected (ADR 0001, "Worse / accepted"). Today this needs disk access. With sync, the relay operator gets it for free.
   - Notes, archive, revisions and scan sessions are JSON envelopes **without AAD**, outside `vault.db`.
   - The integrity manifest and audit chain are unkeyed against an attacker with full write access.

---

## 2. Facts from the current code that shape the design

| Fact | Where | Consequence |
|---|---|---|
| The vault key **is** `Argon2id(password, salt)`. There is no separate data key. | `setupPasswordImpl`, `unlockImpl`, `changePassword` → `rekeyTo` in [server/store.ts](../../server/store.ts) | A password change re-seals every row. With sync, that means a full re-upload, and every device must learn the new salt. Section 4.4 introduces a wrapped data key first. |
| `rekeyTo` keeps the old key sealed under the new one in `meta.prev_key` until rows are rewritten; `reconcileDbKey` repairs at unlock. | [server/store.ts](../../server/store.ts) | Crash-safe re-key already exists. Sync reuses the pattern for "rows from the relay still under the previous key". |
| Row AAD = `indexarc:v2:<table>:<id>`, without a version. | `VaultStore.aad` | An older sealed copy of the same id authenticates (rollback). Sync AAD must bind the revision. |
| `meta.rev` is one global counter bumped on every write. There is no per-row revision, timestamp or tombstone. Deletes are hard `DELETE`. | [server/db/recordDb.ts](../../server/db/recordDb.ts) | Schema change needed: per-row `rev`, `updated_by`, tombstones. |
| The `vectors` table is derived data (embeddings of redacted entry text). | ADR 0001 | **Do not sync vectors.** Each device rebuilds them. This halves the upload and the metadata. |
| The recovery seal follows the current vault key (`refreshRecoverySeal`). It is X25519 + HKDF-SHA256 + AES-256-GCM to a stored public key. | [server/recovery.ts](../../server/recovery.ts) | The same sealing primitive works for enrolling a new device (section 4.5). |
| Bind address: `process.env.HOST \|\| settings.bind_host \|\| "127.0.0.1"`. | [server.ts](../../server.ts) | The bind is already configurable. The `/api` Host allowlist (`LOCAL_HOST_RE`) still rejects every non-loopback Host, so the server is unusable off-loopback today. That is fail-safe and should stay so unless `HOSTED=1`. |
| Auth = `X-IndexArc-Token` header (shell-minted) + Host allowlist + `Sec-Fetch-Site != cross-site`. `/api/auth/bootstrap` is off in production unless `INDEXARC_ALLOW_BOOTSTRAP=1`. SSE uses a 30 s one-time ticket. | [server/auth.ts](../../server/auth.ts) | Hosted mode needs a different authenticator. The SSE ticket design carries over unchanged. |
| The unlock throttle is 10/min with escalating delay, **global** (not per IP). | [server/routes/throttle.ts](../../server/routes/throttle.ts) | Off-loopback, one attacker could lock the owner out. Per-IP limits are needed. |
| Docker: no `HOST`, so the server binds loopback **inside** the container. Only `/app/data` is a volume, so `config/` (settings, settings key) and the emergency snapshot folders (`~/.IndexArc/emergency`) are lost on recreate. | [Dockerfile](../../Dockerfile) | Section 3.7. |

---

## 3. Hosted mode (`HOSTED=1`)

### 3.1 Deployment shapes

| Shape | Supported | Notes |
|---|---|---|
| Docker on a home server or NAS, behind a reverse proxy (Caddy, Traefik, nginx) that terminates TLS | **Primary** | Compose example with Caddy ships in `docs/`. The container listens on plain HTTP on an internal Docker network only. |
| Bare `node dist/server.cjs` on a VPS behind a reverse proxy | Supported | Same config, systemd unit example. |
| Container port published directly to the LAN or Internet without TLS | **Refused** | The server refuses to start in `HOSTED=1` unless `INDEXARC_PUBLIC_ORIGIN` is `https://…`, and refuses session cookies on requests whose `X-Forwarded-Proto` is not `https` from a trusted proxy. |
| Two containers on one volume | **Refused** | The file-backed store has a single writer. A lock file (`data/.server.lock` with pid and host) makes the second instance exit. |
| Tailscale or WireGuard only, no public exposure | **Recommended** in the guide | This removes the Internet as an attacker. The rest of this design still assumes a hostile network. |

### 3.2 Session authentication

The unlock **is** the login. There are no user accounts in the first release (single user, see open question Q2).

1. `POST /api/session/login {password}`: run Argon2id and verify against the `vault.json` header, as `unlockImpl` does today. On success:
   - Mint a 256-bit random session id. Store **only its SHA-256** server-side, with `{created, last_activity, ip, ua_hash, csrf}`.
   - Set the cookie `__Host-indexarc_sid=<id>; Secure; HttpOnly; SameSite=Strict; Path=/`. The `__Host-` prefix forbids a `Domain` attribute and requires `Secure`.
   - Return the CSRF token in the JSON body. The client keeps it in module memory, like the pairing token today.
2. Every `/api` request (except `/ping`, `/session/login`, and `/events` with a ticket) needs a valid session cookie. Every non-GET request also needs `X-IndexArc-CSRF` to match the session's token. We use **both** SameSite=Strict and a CSRF token: SameSite alone does not stop same-site attackers (another app on a sibling subdomain of the user's domain).
3. **Idle timeout:** 15 minutes by default (settable from 5 to 60), measured with the existing `isUserActivity` rule, so GET polls do not count. **Absolute lifetime:** 12 hours. When the **last** session expires or logs out, the vault locks (`store.lock()`, which zeroizes the key).
4. **Session id rotation:** on login, on password change, and on recovery-key use. A password change ends all **other** sessions (ASVS 3.3.3), and the UI lists active sessions with "log out" (ASVS 3.3.4).
5. **Re-authentication** with the master password for: password change, remove password, create or remove recovery key, export, restore, and listing a secret's value in bulk. The ceremony words `ENCRYPT` and `UNPROTECT` are not accepted in hosted mode.
6. **No token in any URL.** The pairing token and `/api/auth/bootstrap` are disabled in `HOSTED=1`. SSE keeps the one-time 30 s ticket, now issued only to a valid session.
7. **Second factor (should, before Internet exposure):** WebAuthn as a second factor on login. It is not a key-wrapping factor in hosted mode, because the server derives the key from the password anyway.

### 3.3 What changes compared with desktop

| Area | Desktop (today) | `HOSTED=1` |
|---|---|---|
| Bind | `127.0.0.1` | `0.0.0.0` inside the container (env `HOST`); the proxy is the only ingress |
| Host check | `LOCAL_HOST_RE` | Allowlist from `INDEXARC_ALLOWED_HOSTS` (required, no wildcard); `Origin` must equal `INDEXARC_PUBLIC_ORIGIN` on every non-GET request |
| Authenticator | Per-process pairing token in a header | Session cookie + CSRF token (3.2) |
| TLS | n/a (loopback) | Required at the proxy; HSTS header set by the app; `trust proxy` set only to the configured proxy address |
| Rate limits | Global 10/min on unlock | Per IP (from the trusted `X-Forwarded-For` hop): 5 logins/min, escalating delay. **Account lockout:** after 20 failures in 1 h from any source, logins need the recovery code or a wait of 1 h. A global token bucket on Argon2id runs (at most 2 concurrent) keeps CPU and RAM DoS bounded (64 MiB per guess). |
| Audit | Hash-chained log, ids only | Plus login success and failure with IP, session create and destroy, lockout, and config changes. The log is visible in the UI. Optional notification webhook (open question Q5). |
| Settings key | `safeStorage` (DPAPI, Keychain, libsecret) | No OS keystore in a container. `INDEXARC_SETTINGS_KEY` comes from a Docker secret file (`INDEXARC_SETTINGS_KEY_FILE`); the server refuses to start in hosted mode without it. |
| Auto-lock | 5 min of user inactivity | Same timer, plus "last session gone" ⇒ lock |
| Headers | CSP, XFO, nosniff, no-store | The same, plus `Strict-Transport-Security`, `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin` |
| Body parsing | `express.json({limit:"2mb"})` | Unchanged; urlencoded stays off |

### 3.4 Features that are disabled in hosted mode

These assume that "the server's disk is the user's disk". On a shared host that assumption is false and dangerous.

| Feature | Route or code | Hosted behaviour |
|---|---|---|
| Folder scan and watch of server paths | `/api/folders/*`, `FolderWatcherManager` | **Off.** Returns 404 with `{error:"not available in hosted mode"}`. A logged-in user must not be able to read `/etc` or other containers' volumes through the scanner. |
| Filesystem browser | `/api/fs` | **Off** (404) |
| Ollama install and start | `/api/ollama/ensure`, shell IPC | **Off.** An Ollama URL may be configured, and existing egress gates apply. |
| LanguageTool spawn | spellcheck engines | Bundled dictionaries only, no child process |
| Server-path document parsing | parse worker fed by scans | **Off.** Uploads from the browser (multipart, size-capped) go through the same `docParse` worker limits. |
| Emergency snapshots to `%APPDATA%` / `~/.IndexArc` | store snapshot code | Write to `/app/backups` (a volume) only |
| Auto-update | shell | n/a. Update by image tag; the guide pins a digest. |

Gating is done by **not mounting** the routers when `HOSTED=1`, not by a check inside each handler. [server/route-matrix.test.ts](../../server/route-matrix.test.ts) gets a hosted variant that asserts 404 for every path in the table.

### 3.5 The key-in-server-memory problem

Plainly: **while a hosted vault is unlocked, the server process holds the vault key, and every secret it serves passes through it in plaintext.** Whoever controls the server host (root, the hypervisor, the NAS vendor's firmware, a container escape, a malicious image update) can read the key and every secret, and can log the master password at the next login. TLS protects only the wire. On desktop this is the same machine the user types on, so it is no new risk. In hosted mode the server is a **second machine that must be trusted as much as the laptop.**

Alternative: **client-side decryption.** The browser derives the key (Argon2id in WASM; `hash-wasm` already runs in the browser), downloads sealed rows, and decrypts in the page. The server becomes a sealed-row store, which is the sync relay of section 4 with a web UI in front.

| | Server-side decryption (Phase 5 "Path A") | Client-side decryption |
|---|---|---|
| Compromised host reads secrets | **Yes**, while unlocked, and the password at next login | Not passively. It can still **serve malicious JavaScript** that exfiltrates them at next use. |
| Effort | Small: auth layer + gating; the UI is already a client of Express | Large: crypto moves into the renderer, and search, AI, analyze, dedupe and heuristics must run client-side or on sealed data |
| Server-side AI, Ask, semantic index | Work as today | Must run in the browser, or be off |
| Real protection against a hostile host | None | Weak in a browser (the host serves the code); strong only with a **native client** (desktop app, signed) talking to the host as a relay |

Recommendation:
- Ship hosted mode as **server-side decryption**, documented as "the host is part of your trusted computing base", for self-hosters who own the box.
- Users who do **not** trust the host should use **sync** (section 4) with the signed desktop app as the client, so the host only ever sees sealed rows.
- A browser client with client-side decryption is not planned. It costs nearly as much as sync and protects little, because the host serves the code.

### 3.6 Hosted-mode configuration (environment)

`HOSTED=1`, `HOST=0.0.0.0`, `PORT=3000`, `INDEXARC_PUBLIC_ORIGIN=https://vault.example.lan`, `INDEXARC_ALLOWED_HOSTS=vault.example.lan`, `INDEXARC_TRUSTED_PROXY=172.18.0.2`, `INDEXARC_SETTINGS_KEY_FILE=/run/secrets/indexarc_settings_key`, `INDEXARC_SESSION_IDLE_MIN=15`. The server refuses to start (exit code 78, config error) if any required value is missing or the origin is not https.

### 3.7 Docker volume layout

| Path in container | Volume | Contents | Back up? |
|---|---|---|---|
| `/app/data` | `indexarc-data` | `vault.json`, `vault.db` (+ `-wal`, `-shm`), envelopes, `recovery.json`, `audit.log`, `manifest.json` | Yes. Snapshot with the container stopped, or use the app's `VACUUM INTO` backup. Never copy a live `vault.db` without its `-wal` file. |
| `/app/config` | `indexarc-config` | `settings.json` (`enc:v1:` keys) | Yes |
| `/app/backups` | `indexarc-backups` | Rolling backups, emergency snapshots (redirected here in hosted mode) | Put on **different** storage from `data` |
| `/run/secrets/indexarc_settings_key` | Docker secret | Settings wrapping key | Keep it apart from the backups; together they open the API keys |

Dockerfile changes: `ENV HOST=0.0.0.0` only when `HOSTED=1` (an entrypoint check), `VOLUME /app/config /app/backups`, `chown` all three to `node`, keep `USER node`, read-only root filesystem (`read_only: true` + `tmpfs: /tmp`) in the compose example, `cap_drop: [ALL]`, `security_opt: no-new-privileges`, and an image pinned by digest.

---

## 4. Sync: end-to-end encrypted, multi-device, one user

### 4.1 Shape

```
 device A (desktop)          relay / storage (untrusted)          device B
 vault.db rows  ──push──►  objects: rows/<opaque-id>          ◄──pull── vault.db rows
 sealed locally            manifests/<device>/<seq>                     opened locally
 manifest MAC'd            keyring.json (wrapped keys)
```

The relay is **dumb**: it stores and lists opaque objects. Supported backends, behind one `SyncBackend` interface (`list`, `get`, `put-if-absent`, `put-if-match`, `delete`):
1. **Folder** (Syncthing, Dropbox, OneDrive, NAS share). This is the easiest first target and needs no server.
2. **WebDAV** (Nextcloud).
3. **S3-compatible** (AWS, Backblaze B2, MinIO), with conditional writes.
4. Optionally, a **tiny relay** (later): the hosted-mode container in a "relay only" role. It never receives a key.

Folder backends have no compare-and-swap. The design therefore never relies on atomic updates of a shared object: each device writes only **its own** append-only manifest stream, and readers merge.

### 4.2 Data model changes (schema 2 of `vault.db`)

| Column or table | Purpose |
|---|---|
| `entries.rev` INTEGER | Lamport clock: `max(local_clock, seen_rev) + 1` on every local write |
| `entries.updated_by` TEXT | Device id (random 128-bit, created at enrollment) that wrote this revision; breaks ties |
| `entries.updated_at` TEXT | Wall clock, for display only, never for ordering |
| `entries.deleted` INTEGER | Tombstone. A delete becomes a sealed row `{deleted:true}` with a new `rev`. Tombstones are purged after every enrolled device has acknowledged them, and not before 90 days. |
| `sync_state` table | Per backend: last-seen manifest seq per device, local clock, pending pushes |
| New row AAD | `indexarc:v3:<table>:<id>:<rev>:<updated_by>`. A sealed body can no longer be replayed as a different revision. |

Notes, archive, revisions and scan sessions must move into `vault.db` as row types (`notes`, `note_revisions`) **before** sync. Envelopes without AAD cannot be synced safely. Scan sessions stay **local-only**: they hold raw extracted secrets from one machine's disk and are temporary. Settings stay local except an allowlisted set of cosmetic fields. **Vectors are not synced.**

### 4.3 Conflict resolution

- **Entries:** last writer wins per record by `(rev, updated_by)`. The losing revision is kept as a sealed **conflict copy** (`<id>~conflict~<rev>`), shown in the Library with a "Resolve" action. It is never silently dropped. Secrets are small and conflicts are rare, so no field-level merge is attempted in the first release.
- **Notes:** the same rule, but the loser is always kept as a note revision, using the Versions feature that already exists.
- **Delete vs edit:** an edit with a higher `rev` than the tombstone resurrects the record. An edit with a lower `rev` becomes a conflict copy, so the user sees the data instead of losing it.
- **Clocks:** wall-clock skew cannot reorder writes, because ordering uses the Lamport `rev`.

### 4.4 Keys

**Prerequisite (S0): split the key.** Introduce a random 256-bit **vault data key (VDK)**. The password-derived key becomes a **key-encryption key (KEK)** that wraps the VDK in `vault.json`. The recovery seal and device enrollments then wrap the **VDK**. This is a one-time migration that uses the existing `rekeyTo` crash ordering. After it:
- **Password change** re-wraps the VDK only: one small object, **no row re-seal, no full re-upload.** Other devices learn about it through the keyring (below) and ask the user for the new password at their next unlock.
- **Key rotation** (suspected compromise, or a device removed) is a separate, explicit action: new VDK → re-seal all rows → full re-upload. During the rotation the old VDK is kept wrapped under the new one, like `prev_key` today, so devices that have not yet pulled can still open rows sealed under the old key. Rows carry a `key_epoch` so a reader knows which key to use.

**Keyring on the relay** (`keyring.json`, written by any unlocked device, MAC'd):
`{vault_id, key_epoch, kdf, salt, wrapped_vdk_by_password, devices:[{device_id, name, x25519_pub, ed25519_pub, wrapped_vdk, added_at, revoked_at}], recovery:{public_key, wrapped_vdk}}`.

- A device that knows the master password can unwrap the VDK from `wrapped_vdk_by_password`. This means **the relay holds an offline-guessable password verifier**, exactly as a stolen laptop would. That makes the password policy gate (section 7, G-S3) mandatory.
- Option (open question Q4): leave `wrapped_vdk_by_password` off the relay entirely, and enroll devices only by device keys and the recovery key. Offline guessing from the relay then becomes impossible, at the cost of "a new device needs an old device or the recovery code".

**Derived subkeys** (HKDF-SHA256 from the VDK, with distinct `info` labels): `rows` (AES-GCM row sealing), `manifest-mac` (HMAC-SHA256), `object-id` (HMAC for opaque ids). Today the VDK seals rows directly; the subkeys are introduced with schema 2.

### 4.5 New-device enrollment

| Method | Flow | When |
|---|---|---|
| **QR / code from an existing device** (default) | New device B creates an X25519 + Ed25519 key pair and shows a QR code (public keys + 6-word short authentication string). Device A scans it or the user types it, confirms the SAS matches, and seals the VDK to B's X25519 key with the same construction as [server/recovery.ts](../../server/recovery.ts) (ephemeral X25519 + HKDF + AES-GCM, AAD bound to `vault_id` and `device_id`). A appends B to the keyring. | User has another device at hand |
| Master password | B pulls the keyring and unwraps the VDK from `wrapped_vdk_by_password` (if Q4 keeps it on the relay) | Convenience |
| Recovery code | B opens `recovery.wrapped_vdk` with the code, then the user sets a password | All devices lost |

Device private keys live in the OS keystore (`safeStorage`) on desktop. **Device revocation** marks `revoked_at` in the keyring and **must** be followed by a key rotation, because the revoked device already knows the VDK. The UI does both as one action.

### 4.6 Integrity against a malicious relay

GCM row authentication stops forgery. It does not stop the relay from **replaying** an old revision, **dropping** a row, **rolling back** the whole vault, or **forking** devices (showing each device a different history). Defense:

1. Each device keeps an **append-only manifest stream**: entries `{device_id, seq, prev_hash, clock, records:[(table, id, rev, sha256(sealed object))], keyring_hash, created_at}`.
   - Signed with the device's **Ed25519** key, so other enrolled devices can tell which device wrote it.
   - MAC'd with `manifest-mac` from the VDK, so only vault members can produce one.
2. A reader accepts a row only if a verified manifest entry names that `(id, rev, hash)`. A row on the relay with no manifest entry, or a lower `rev` than one already seen, is rejected and logged.
3. **Rollback and freshness:** each device stores the highest `(device_id, seq)` it has verified for every peer, and its own last seq, **locally** (in `vault.db` meta, under the row key). A relay that serves an older seq, or a gap in a hash chain, raises a visible "sync integrity" error and sync pauses. It is never silently accepted.
4. **Forking:** devices include the latest seen heads of all other devices in each manifest entry (a vector of hashes). Two devices that sync with each other, directly or through a second backend, detect a fork. A fork cannot be detected on a relay used by one device alone. This is a documented residual risk.
5. **Deletion of a whole object** shows up as "manifest names hash H, object missing" ⇒ error, not data loss: the local copy is kept.
6. **Snapshot root:** each device writes a periodic Merkle root over all live `(table, id, rev, hash)`. A new device verifies a full sync against it instead of trusting the list. This root also closes the at-rest rollback gap from ADR 0001 for the local database.

### 4.7 What the relay learns, and mitigations

| Leak | Mitigation | Residual |
|---|---|---|
| Record ids | Object name = `HMAC(object-id key, table‖id)`, so local UUIDs are not exposed and ids cannot be linked across vaults | Stable per record, so edits to the same record are linkable |
| Record count and sizes | Pad each sealed body to a bucket (256 B, 1 KiB, 4 KiB, then multiples of 4 KiB). Notes are larger and bucketed coarser. | Approximate count and size class remain visible |
| Timing and activity | Batch pushes (debounce 30 s); optional cover writes off by default | The relay sees when the user is active |
| Table (secret vs note) | Single object namespace; the table is inside the sealed body and in the AAD | Size buckets hint at notes |
| Number of devices, device names | Device names are sealed inside the keyring; public keys are visible | Device count is visible |
| IP addresses | Out of scope (backend-specific) | Visible to the backend |
| Password verifier | Argon2id-wrapped VDK in the keyring (unless Q4 removes it) | Offline guessing, bounded by Argon2id cost and password strength |

### 4.8 The recovery key and sync

- The recovery key wraps the **VDK** (after S0) and is stored in the keyring, so one recovery code works for every device and survives the loss of all of them.
- A password change does **not** revoke it (unchanged from today). A key rotation re-wraps the new VDK to the same recovery public key automatically, as `refreshRecoverySeal` does today. "Create new recovery key" replaces the public key in the keyring for all devices.
- New risk: the recovery code plus **the relay contents** now opens the vault. Before sync, the attacker needed a copy of the user's files. The UI must say this when sync is enabled.
- Bind the seal AAD to `vault_id` (already listed as cheap hardening in [THREAT-MODEL.md §3b](../THREAT-MODEL.md#recovery-key-boundary-3b)). This is required for sync.

---

## 5. Team sharing (later, out of scope for first sync)

Outline only, so that the first sync does not paint us into a corner:
- Each **share** (a set of entries) has its own random **share key**. Entries in a share are sealed under the share key, not the personal VDK. AAD includes the `share_id`.
- Each **member** has a long-term X25519 identity key pair. Membership = the share key sealed to the member's public key, listed in a share keyring signed by an admin's Ed25519 key.
- **Revocation = re-key:** new share key, re-seal the share's rows, re-wrap to the remaining members. A removed member keeps whatever they already read; this is unavoidable, and the UI must say so.
- Identity verification (safety numbers or a QR handshake) is required, or the relay can substitute keys.
- Needs: per-share roles, an audit visible to admins, and a separate threat model revision. **Not started until single-user sync has shipped and been pentested.**

The first-sync choices that keep this possible: a `key_epoch` and key id per row, subkeys via HKDF, and a keyring format with a `shares` array reserved.

---

## 6. Threat model

Assets as in [THREAT-MODEL.md §1](../THREAT-MODEL.md#1-assets), plus: **session cookies** (hosted), **device private keys** (sync), **the keyring and manifests** (sync), and **the relay copy of all sealed rows**.

### 6.1 Hosted mode

| Adversary | Attack | Mitigation | Residual |
|---|---|---|---|
| Network attacker (LAN, café, ISP) | Sniff or modify traffic, steal the cookie | TLS required at the proxy, HSTS, `__Host-` + `Secure` cookie, refuse non-https origin | A misconfigured proxy (TLS to the proxy, HTTP across an untrusted network to the container) |
| Internet attacker | Online password guessing, credential stuffing | Per-IP limits, account lockout, Argon2id cost per guess, 12-character minimum, breached-password check, optional WebAuthn second factor; recommend VPN-only exposure | A weak password plus Internet exposure; a lockout can be used for DoS (the recovery code bypasses it) |
| Internet attacker | Argon2id CPU and memory DoS | Concurrency cap of 2 KDF runs, per-IP limits before the KDF runs | Availability only |
| Malicious web page | CSRF, DNS rebinding | SameSite=Strict, CSRF token, `Origin` check, Host allowlist from config | A same-site XSS on a sibling subdomain (stopped by the CSRF token + Origin check) |
| XSS in the IndexArc UI | Steal secrets in the page | Existing CSP (`script-src 'self'`), DOMPurify on notes, HttpOnly cookie | XSS still reads anything the page shows; same as desktop |
| **Compromised server host** (root, NAS firmware, container escape, malicious image) | Read the key from memory, log the password, serve a malicious UI | **None while unlocked. Stated in the docs.** Auto-lock limits the time window; images pinned by digest; read-only filesystem; no capabilities | **Full compromise.** Users who do not trust the host should use sync instead (3.5). |
| Malicious co-tenant (other containers or users on the NAS) | Read volumes, reach the container port | Container on an internal network; volumes owned by uid `node`, mode 0700; scanner and fs browser off (no path traversal into other volumes) | A co-tenant with root or Docker-socket access = compromised host |
| Stolen server disk or backups | Offline guessing | Argon2id, at-rest encryption unchanged; settings key kept apart as a Docker secret | Password strength |
| Stolen client device (browser) | Use a live session | Idle timeout of 15 min, absolute 12 h, session list with remote logout, re-auth for sensitive actions | A window up to the idle timeout |

### 6.2 Sync

| Adversary | Attack | Mitigation | Residual |
|---|---|---|---|
| **Malicious relay** | Read rows | AES-256-GCM per row; the relay never has a key | None for content |
| Malicious relay | Forge or modify rows | GCM + AAD binding `(table, id, rev, device)`; manifest MAC + Ed25519 signature | None |
| Malicious relay | Replay an old revision, roll back the vault | Lamport `rev` in AAD; manifests with hash chains; locally stored high-water marks per device; Merkle root | First sync of a brand-new device trusts the relay's latest state, unless verified against a QR-enrolled peer's head |
| Malicious relay | Drop rows or whole manifests | Missing object or seq gap ⇒ integrity error, local copy kept | DoS (sync stops); a device that only ever saw the truncated view |
| Malicious relay | Fork devices | Each manifest carries the heads of other devices | Undetected while devices never communicate except through that relay |
| Malicious relay | Offline-guess the password from the keyring | Argon2id; 12+ character policy and breached-password check (gate G-S3); option Q4 removes the verifier | Weak passwords |
| Malicious relay | Traffic analysis | Opaque ids, padding, batching (4.7) | Activity timing, size class, device count |
| Malicious relay | Substitute a device key at enrollment | SAS confirmation on both screens; enrollment signed by an existing device | A user who skips the SAS check |
| Stolen device (locked) | Offline guessing; reuse the device key | Device key in the OS keystore; VDK wrapped; revocation + rotation from another device | Rows the thief already decrypted are gone for good |
| Stolen device (unlocked) | Read everything, push malicious edits | Auto-lock; revoke + rotate; malicious edits arrive as normal revisions, and the old revision is kept as a conflict copy or note version | Edits made before revocation look legitimate |
| Network attacker | MITM to the backend | Backend TLS; integrity does not depend on TLS (MAC + signatures) | Metadata only |
| Compromised backend account (e.g. a stolen Dropbox login) | Same as malicious relay | Same | Same |
| Malicious enrolled device | Push garbage, delete everything via tombstones | Tombstones are revisions: restorable from local history within 90 days; "mass delete" (>20% of records in one push) needs confirmation on the receiving device | A device that keeps the VDK until rotation |

---

## 7. Phased plan, acceptance criteria, ship gates

### 7.1 Phases

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **S0 — Key split** (also useful on desktop) | VDK wrapped by password-KEK and recovery; migration via `rekeyTo` ordering; subkeys via HKDF | Password change rewrites `vault.json` + `recovery.json` only (row bytes unchanged, asserted); crash at every step recovers (kill tests); v2 vaults migrate once; recovery still works |
| **S1 — Integrity at rest** (closes the ADR 0001 gap) | Per-row `rev`, AAD v3, tombstones, keyed Merkle root in the header, notes and revisions moved into `vault.db` with AAD | Replaying an older row, deleting a row, or swapping an envelope is detected at unlock (tests for each); no envelope without AAD remains |
| **H1 — Hosted auth** | `HOSTED=1`, sessions, CSRF, Host/Origin allowlist, per-IP limits, lockout, audit, config validation | Hosted route matrix: no cookie ⇒ 401 everywhere; wrong CSRF ⇒ 403; foreign Origin or Host ⇒ 403; http origin ⇒ refuses to start; 6th login/min/IP ⇒ 429; idle 15 min ⇒ 401 and vault locked; password change ends other sessions |
| **H2 — Gating + Docker** | Routers not mounted (3.4), volumes, compose + Caddy example, single-instance lock, read-only rootfs | Hosted matrix asserts 404 for `/api/fs`, `/api/folders/*`, `/api/ollama/ensure`; the second container exits; `docker compose down && up` keeps vault, settings and backups (CI job) |
| **Y1 — Sync engine, folder backend** | `SyncBackend`, manifests, Lamport merge, conflict copies, padding, opaque ids, keyring, QR enrollment | See test plan 7.2 |
| **Y2 — WebDAV + S3 backends** | Conditional writes where available | Same suite on MinIO and a WebDAV container in CI |
| **Y3 — Revocation + rotation** | One-action revoke-and-rotate | After rotation, the revoked device's key cannot open any new row; old-epoch rows still open on lagging devices until they catch up |

Order: S0 → S1 → (H1 → H2) and (Y1 → Y2 → Y3) in parallel. S0 and S1 also ship to desktop users as hardening.

### 7.2 Test plan

- **Property tests** for merge: random interleavings of edits and deletes on 3 simulated devices converge to the same state, and no revision is lost (it is either the winner or a conflict copy).
- **Hostile relay harness:** a fake backend that can replay, drop, reorder, truncate, fork and substitute the keyring. Every attack in table 6.2 has one test that expects a visible integrity error and no data loss.
- **Crash tests:** kill the process mid-pull, mid-push and mid-rotation (the existing kill-test pattern).
- **Metadata test:** with a 10-entry vault and a 1,000-entry vault, assert the object names reveal no UUIDs and sizes fall only into the declared buckets.
- **Hosted e2e:** Playwright through Caddy with TLS in CI: login, CSRF, idle expiry, logout, SSE ticket.
- **Egress test:** extend [server/egress.test.ts](../../server/egress.test.ts). With sync on, the only new outbound host is the configured backend, and no request body contains a plaintext marker secret.

### 7.3 What the pentest must cover before hosted mode ships

1. Session management: fixation, cookie flags, CSRF bypass, Origin and Host bypass behind a proxy, `X-Forwarded-*` spoofing.
2. Authentication: brute force, lockout bypass, KDF DoS, timing on login.
3. Access control: every route while logged out, locked and logged in; gated routes truly unmounted; path traversal in uploads.
4. Container: escape paths, volume permissions, secret handling, image provenance.
5. XSS and CSP in the web UI as served by a remote origin.
6. Sync (before sync ships, same or a second engagement): the malicious-relay attacks in 6.2, enrollment MITM, and a review of the key hierarchy and manifest crypto by someone with applied-crypto experience.

### 7.4 Do not ship until

| Gate | Applies to |
|---|---|
| **G-1** External pentest of the hosted build against this doc, and all high and critical findings closed or accepted in writing | Hosted |
| **G-2** R5 exit (roadmap) | Hosted, Sync |
| **G-3** Password policy: 12-character minimum, offline breached-password check, strength meter (ASVS 2.1.1, 2.1.7, 2.1.8) | Hosted, Sync |
| **G-4** S1 done: no envelope without AAD; rollback detection at rest | Sync |
| **G-5** Signed desktop builds (roadmap bar 1). A sync client that cannot be verified defeats E2E. | Sync |
| **G-6** Crypto review of S0, the manifest and enrollment by a second person | Sync |
| **G-7** Docs: SECURITY.md and THREAT-MODEL.md updated with sections 3.5, 4.7, 6 (honesty rule) | Hosted, Sync |
| **G-8** Hosted mode refuses to start without https origin, host allowlist and settings key (test proves it) | Hosted |

Until these pass, `HOSTED=1` and sync stay behind a build flag that is off in released artifacts.

---

## 8. Open questions for the owner

| # | Question | Recommendation |
|---|---|---|
| Q1 | Which sync backends first? | Folder (Syncthing, Dropbox) first: no server, smallest attack surface. Then WebDAV, then S3. A custom relay only on demand. |
| Q2 | Hosted mode: single-user only, or multi-user? | Single-user. Multi-user means accounts, per-user vaults and isolation: a new product with its own threat model. |
| Q3 | Is hosted mode worth building at all, given that sync + desktop covers "my vault on many devices" without trusting a host? | Build S0/S1 and sync first; build hosted only if users ask for browser access from devices without the app (for example a work machine where installs are not allowed). |
| Q4 | Keep the password-wrapped VDK on the relay (any device can join with just the password) or not (join only via an existing device or the recovery code)? | Keep it off by default (no offline-guessable verifier on the relay); allow opting in. |
| Q5 | Hosted login alerts: webhook, e-mail, or none? | Webhook (ntfy or Gotify style), opt-in. No e-mail stack. |
| Q6 | Mobile clients? | Out of scope; the keyring and device-key format are chosen so that a later mobile app can enroll. |
| Q7 | Pentest budget: one engagement covering hosted + sync, or two? | Two: hosted first (it is simpler), sync after Y3, with a crypto reviewer. |
| Q8 | Tombstone retention: 90 days, or until all devices acknowledge? | Both: purge only when all active devices have acknowledged and 90 days have passed. |
