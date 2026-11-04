# OWASP ASVS 4.0.3 Level 2 mapping and Electron security checklist

Version 2.1.x · 2026-11-04 · Roadmap item R5 ("Standards mapping")

This document maps IndexArc to OWASP ASVS 4.0.3 Level 2 and to the Electron
security checklist. Every row links to the code that implements the control and,
where one exists, the test that proves it. Read it together with
[THREAT-MODEL.md](THREAT-MODEL.md) and [SECURITY.md](../SECURITY.md).

## How to read this

IndexArc is a single-user, local-first desktop app. There is no multi-user
login, no cookie session, no remote server and no account database. Many ASVS
requirements assume a hosted web app; those are marked N/A with a reason. The
"user" is whoever holds the master password. The "session" is the per-process
pairing token plus the unlocked state of the vault.

| Status | Meaning |
|---|---|
| **Met** | Implemented and verified by reading the code (and a test, where listed). |
| **Partial** | Implemented in part, or met with a documented limitation. |
| **N/A** | The requirement does not apply to this architecture. The reason is given. |
| **Gap** | Not implemented. Each gap feeds the roadmap (see [Gap summary](#gap-summary)). |

Requirements not listed here were judged N/A in bulk for the chapter (for
example, all of V2.7 out-of-band verifiers). Chapter V11 (business logic) is
covered by V1.11 rows only.

Component map used in the evidence column:

| Component | Files |
|---|---|
| Electron shell (main process) | [electron-main.cjs](../electron-main.cjs), [preload.cjs](../preload.cjs), [shared/updater.cjs](../shared/updater.cjs), [shared/verify-dist.cjs](../shared/verify-dist.cjs), [shared/child-env.cjs](../shared/child-env.cjs) |
| Vault server (utilityProcess) | [server.ts](../server.ts), [server/app.ts](../server/app.ts), [server/auth.ts](../server/auth.ts), [server/routes/](../server/routes/) |
| Crypto and storage | [server/crypto.ts](../server/crypto.ts), [server/store.ts](../server/store.ts), [server/db/recordDb.ts](../server/db/recordDb.ts), [docs/adr/0001-storage-engine.md](adr/0001-storage-engine.md) |
| Document parsing (worker thread) | [server/services/docParse.ts](../server/services/docParse.ts), [server/services/parseWorker.ts](../server/services/parseWorker.ts), [server/services/folderScan.ts](../server/services/folderScan.ts) |
| Renderer | [src/](../src/), [src/sanitize.ts](../src/sanitize.ts), [src/apiAuth.ts](../src/apiAuth.ts), [index.html](../index.html) |
| CI / supply chain | [.github/workflows/ci.yml](../.github/workflows/ci.yml), [.github/workflows/desktop-builds.yml](../.github/workflows/desktop-builds.yml), [.github/dependabot.yml](../.github/dependabot.yml) |

---

## V1 Architecture, design and threat modeling

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 1.1.1 | Secure development lifecycle | Partial | CI runs typecheck, unit/integration/fuzz tests with a coverage gate, and `npm audit` on every PR ([ci.yml](../.github/workflows/ci.yml)). No written SDLC policy; branch protection is still open (roadmap R2.5). |
| 1.1.2 | Threat modeling for design changes | Met | [THREAT-MODEL.md](THREAT-MODEL.md), refreshed for R3 (utilityProcess, worker, storage v2, updater). ADRs record storage decisions ([adr/0001](adr/0001-storage-engine.md)). |
| 1.1.4 | Trust boundaries documented | Met | [THREAT-MODEL.md §3](THREAT-MODEL.md) lists six boundaries with controls and residual risk. |
| 1.1.6 | Centralized, reusable security controls | Met | One crypto module ([server/crypto.ts](../server/crypto.ts)), one auth middleware ([server/auth.ts](../server/auth.ts)), one throttle ([server/routes/throttle.ts](../server/routes/throttle.ts)), one sanitizer config ([src/sanitize.ts](../src/sanitize.ts)), one IPC gate (`handleTrusted` in [electron-main.cjs](../electron-main.cjs)). |
| 1.2.1 | Components run with least OS privilege | Partial | Everything runs as the logged-in user; no admin rights needed (NSIS `perMachine: false` in [package.json](../package.json)). The server runs in a separate utilityProcess and the renderer is sandboxed, but they share the user's OS identity. |
| 1.2.2 | Communication between components is authenticated | Met | Shell mints a 256-bit token and passes it only in the utilityProcess env (`spawnBackend` in [electron-main.cjs](../electron-main.cjs)); every `/api` call must present it ([server/auth.ts](../server/auth.ts)). Test: [server/route-matrix.test.ts](../server/route-matrix.test.ts). |
| 1.2.3 | Single vetted authentication mechanism | Met | Master password -> Argon2id -> AES-GCM key check is the only unlock path ([server/store.ts](../server/store.ts) `unlockImpl`). |
| 1.4.1 | Access control enforced at a trusted point | Met | Lock gate runs server-side: `protectedPaths` + `checkVaultUnlocked` ([server/app.ts](../server/app.ts), [server/routes/vault.ts](../server/routes/vault.ts)). |
| 1.4.4 | Single access-control mechanism | Met | One mount list; the route-matrix test fails if any route lacks an explicit policy ([server/route-matrix.test.ts](../server/route-matrix.test.ts)). |
| 1.5.2 | No untrusted serialization formats | Met | JSON only (`express.json`); no native object deserialization anywhere. |
| 1.5.3 | Input validation at a trusted layer | Met | Server-side coercion ([server/validate.ts](../server/validate.ts)), settings allowlist ([server/routes/settings.ts](../server/routes/settings.ts)), snapshot-name regex ([server/routes/misc.ts](../server/routes/misc.ts)). |
| 1.6.1 | Key management policy | Partial | Key handling is documented in [SECURITY.md](../SECURITY.md), the ADR and code comments. No single key-lifecycle document (generation, rotation, destruction, recovery). Write one alongside the recovery-key feature. |
| 1.6.2 | Key material protected (vault/OS store) | Partial | Settings wrap key is sealed by the OS (`safeStorage`, `initSettingsSecretsKey` in [electron-main.cjs](../electron-main.cjs)). The vault key exists only in server memory and is never stored. The settings wrap key and the API token travel in the utilityProcess environment, readable by same-user processes. |
| 1.6.3 | No hard-coded keys or passwords | Met | Keys are random (`crypto.randomBytes`) or password-derived. Repo audit in [SECURITY.md](../SECURITY.md). |
| 1.6.4 | Symmetric keys not stored with low protection | Partial | The integrity-manifest HMAC key is stored in plaintext next to the data (`manifestKeyFile`, [server/store.ts](../server/store.ts)). This is documented as a recovery aid, not a security control. |
| 1.7.1 | Common logging format | Partial | Two sinks: in-memory system log ([server/logs.ts](../server/logs.ts)) and the hash-chained audit log ([server/audit.ts](../server/audit.ts)). Different formats. |
| 1.7.2 | Logs sent to a remote system | N/A | Local-only app; no telemetry by design. |
| 1.8.1 | Sensitive data identified | Met | Asset table in [THREAT-MODEL.md §1](THREAT-MODEL.md). |
| 1.8.2 | Protection levels per data class | Partial | Secrets, notes, scan sessions and vectors are encrypted; API keys are OS-wrapped. Metadata visible at rest (row counts/sizes in `vault.db`, file names) is accepted and documented ([adr/0001](adr/0001-storage-engine.md)). |
| 1.9.1 | Encrypted communication between components | Partial | Renderer <-> server is plain HTTP on `127.0.0.1`. Loopback traffic does not leave the host; the token and Host check provide authentication, not confidentiality, against a same-user sniffer. A named-pipe or custom-protocol transport is the documented hardening. |
| 1.9.2 | Components verify each other | Met | Shell verifies the server's SHA-256 token fingerprint on `/api/ping` before loading any content (`pollServerAndLoad` in [electron-main.cjs](../electron-main.cjs), `serverIdentity` in [server/auth.ts](../server/auth.ts)). |
| 1.10.1 | Source control with traceable changes | Partial | Git + PR CI. Branch protection and required reviews not yet enforced (R2.5). |
| 1.11.2 | High-value flows are thread safe | Met | Key operations are serialized (`exclusive()` queue, `lockEpoch`) in [server/store.ts](../server/store.ts). Test: [server/key-ops.test.ts](../server/key-ops.test.ts). |
| 1.11.3 | No TOCTOU in high-value flows | Met | A lock that lands during KDF wins (`lockEpoch` check). Test: [server/key-ops.test.ts](../server/key-ops.test.ts) "a lock that lands while unlock is deriving the key wins". |
| 1.14.1 | Segregation of components of different trust | Met | Sandboxed renderer, utilityProcess server, worker-thread parser ([electron-main.cjs](../electron-main.cjs), [server/services/docParse.ts](../server/services/docParse.ts)). |
| 1.14.5 | Dangerous operations sandboxed | Met | Untrusted .docx/.pdf/.xlsx parse in a `worker_threads` worker with a 512 MB heap cap and a hard deadline; the worker is terminated on timeout. Test: [server/folderScan.test.ts](../server/folderScan.test.ts) "parseDocument — isolated worker", [server/limits.test.ts](../server/limits.test.ts). |
| 1.14.6 | No insecure client-side technologies | Met | No plugins, Flash, Java applets or `<webview>`. |

## V2 Authentication

Single user, single factor (master password). No account recovery by e-mail,
no OTP, no federated login.

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 2.1.1 | Passwords at least 12 characters | Met | 12 characters (counted as code points) for every new master password: setup, change and recovery. Enforced by the server ([server/routes/vault.ts](../server/routes/vault.ts) `rejectPassword`, [shared/password-policy.ts](../shared/password-policy.ts)); the UI applies the same module. Existing shorter passwords still unlock. Tests: [shared/password-policy.test.ts](../shared/password-policy.test.ts), [server/vault-setup.test.ts](../server/vault-setup.test.ts). |
| 2.1.2 | Passwords of 64+ characters allowed | Met | No upper limit besides the 2 MB JSON body cap. (ASVS also asks to deny > 128; not enforced, harmless for a local KDF.) |
| 2.1.3 | No truncation | Met | The full string is fed to Argon2id (`deriveKeyAsync` in [server/crypto.ts](../server/crypto.ts)). |
| 2.1.4 | Any printable Unicode allowed | Met | No character filtering on the password. |
| 2.1.5 | User can change the password | Met | `POST /api/vault/change-password` verifies the current password and re-keys every file and record under a new salt with no plaintext window: files are staged and committed as one set, rows follow, and the old key is kept sealed under the new one (`prev_key`) until they do ([server/store.ts](../server/store.ts) `changePassword`/`rekeyTo`, [server/routes/vault.ts](../server/routes/vault.ts)). Tests: [server/recovery.test.ts](../server/recovery.test.ts), including a crash between the header commit and the row rewrite. UI: Settings → Security. |
| 2.1.6 | Change requires current password | Met | `remove-password` verifies the master password, throttled ([server/routes/vault.ts](../server/routes/vault.ts)). Test: [server/fail-closed.test.ts](../server/fail-closed.test.ts). |
| 2.1.7 | Breached/common password check | Met | Offline: zxcvbn-ts's bundled common-password list (`@zxcvbn-ts/language-common`), including l33t, reversed and near-common forms ("iloveyou2024!"). Nothing is sent over the network, so no k-anonymity breach API is used. [shared/password-policy.ts](../shared/password-policy.ts). |
| 2.1.8 | Password strength meter | Met | Four-step meter with a label and the refusal reason on every new-password field ([src/components/common/PasswordStrength.tsx](../src/components/common/PasswordStrength.tsx)); scores under 2 of 4 are refused. |
| 2.1.9 | No composition rules | Met | Only length, the common-password check and a minimum guessability score; no character-class rules. |
| 2.1.10 | No forced periodic rotation | Met | None. |
| 2.1.11 | Paste and password managers allowed | Met | Standard `type="password"` inputs, no paste blocking ([src/components/LockScreen.tsx](../src/components/LockScreen.tsx)). |
| 2.1.12 | Show/hide password option | Met | Every password field has a reveal toggle that also turns spellcheck off ([src/components/common/PasswordField.tsx](../src/components/common/PasswordField.tsx)). |
| 2.2.1 | Anti-automation on authentication | Met | 10 attempts/min, escalating delay to 5 s that survives the window until a verified success ([server/routes/throttle.ts](../server/routes/throttle.ts)); memory-hard KDF per guess. Test: [server/auth-activity.test.ts](../server/auth-activity.test.ts) "escalating delay persists until a verified success". |
| 2.2.2 | Weak authenticators (SMS/e-mail) | N/A | None used. |
| 2.2.3 | Notify user after credential changes | N/A | No out-of-band channel. Password changes are written to the audit log ([server/audit.ts](../server/audit.ts)). |
| 2.4.1 | Passwords stored with a salted KDF | Met | The password is never stored. Unlock proves knowledge by authenticating the AES-GCM header envelope under the Argon2id-derived key ([server/store.ts](../server/store.ts) `unlockImpl`). |
| 2.4.2 | Salt of at least 32 bits | Met | 16-byte random salt; derivation refuses salts shorter than 16 bytes (`MIN_SALT_BYTES`, [server/crypto.ts](../server/crypto.ts)). Test: [server/crypto.test.ts](../server/crypto.test.ts). |
| 2.4.4 | PBKDF2 at least 100,000 iterations | Met | PBKDF2 is legacy read-only, floored at 100k and upgraded to Argon2id on unlock. Test: [server/kdf-migration.test.ts](../server/kdf-migration.test.ts). |
| 2.4.5 | Memory-hard KDF parameters | Met | Argon2id 64 MiB / t=3 / p=4; envelope parameters are bound-checked so a tampered file cannot downgrade derivation (`KDF_BOUNDS`). Tests: [server/crypto.test.ts](../server/crypto.test.ts), [server/crypto.property.test.ts](../server/crypto.property.test.ts). |
| 2.5.1 | Recovery secret not sent in clear | N/A | No server-side recovery channel. |
| 2.5.6 | Secure recovery mechanism | Met | Optional recovery key: a 256-bit X25519 private key shown once as a checksummed code; only the public key and the vault key sealed to it are stored (`data/recovery.json`, resealed after every key change). Creating one needs the master password; `POST /api/vault/recover` (throttled) resets the password ([server/recovery.ts](../server/recovery.ts), [server/store.ts](../server/store.ts) `recoverWithCode`). Tests: [server/recovery.test.ts](../server/recovery.test.ts). Caveat: a password change keeps the code valid; replacing the recovery key revokes it (threat model boundary 3b). |
| 2.9.x | Cryptographic authenticators (hardware keys) | N/A | Not offered yet. Windows Hello / WebAuthn unlock is planned in R5. |
| 2.10.1 | Intra-service secrets are not static | Met | Pairing token is fresh per process ([electron-main.cjs](../electron-main.cjs) `apiToken`, [server/auth.ts](../server/auth.ts)). |
| 2.10.4 | Service credentials not in source; stored protected | Partial | Provider API keys are OS-wrapped (`enc:v1:`) in packaged builds; dev/standalone runs keep them plaintext in `config/settings.json`. Env-var override documented in [SECURITY.md](../SECURITY.md). Test: [server/settings-secrets.test.ts](../server/settings-secrets.test.ts). |

## V3 Session management

The "session" is the pairing token (one per server process) plus the
server-side unlocked state. No cookies are used anywhere.

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 3.1.1 | Session token never in URLs | Partial | The token travels only in the `X-IndexArc-Token` header ([src/apiAuth.ts](../src/apiAuth.ts)). EventSource cannot send headers, so SSE uses a separate one-time, 30-second ticket in the query string (`issueSseTicket`, [server/auth.ts](../server/auth.ts)). |
| 3.2.1 | New token on authentication | Partial | Unlock changes server-side state; the token itself is per process, not per unlock. Acceptable because the token does not grant secret access while locked. |
| 3.2.2 | At least 64 bits of entropy | Met | 256-bit token; 128-bit SSE tickets ([server/auth.ts](../server/auth.ts)). |
| 3.2.3 | Token stored safely in the client | Met | Module memory only, never `localStorage` or URLs ([src/apiAuth.ts](../src/apiAuth.ts)); obtained via the trusted IPC bridge (`get-api-token`). |
| 3.2.4 | Approved CSPRNG | Met | `crypto.randomBytes`. |
| 3.3.1 | Logout invalidates the session | Partial | Lock zeroizes the key and purges all decrypted caches (`lock()` in [server/store.ts](../server/store.ts)); protected routes then return 423. The token stays valid for metadata routes until the process ends. Test: [server/route-matrix.test.ts](../server/route-matrix.test.ts) (locked matrix). |
| 3.3.2 | Idle timeout / re-authentication | Met | Auto-lock after 5 minutes by default; only real user input counts as activity ([server.ts](../server.ts) auto-lock loop, `isUserActivity` in [server/auth.ts](../server/auth.ts)). Optional lock on minimize. Test: [server/auth-activity.test.ts](../server/auth-activity.test.ts). |
| 3.3.3 | Terminate other sessions after password change | N/A | Single session per process. |
| 3.3.4 | User can view/log out active sessions | N/A | Single session. |
| 3.4.x | Cookie attributes | N/A | No cookies are set. |
| 3.5.2 | Session tokens, not static API keys | Met | The token is a random per-process session secret. |
| 3.5.3 | Stateless tokens signed | N/A | Tokens are opaque and server-held. |
| 3.7.1 | Re-authentication before sensitive operations | Partial | Removing the password needs the master password. Unprotecting a note accepts the master password **or** the fixed ceremony word `UNPROTECT`; encrypting the vault needs the ceremony word `ENCRYPT` ([server/routes/misc.ts](../server/routes/misc.ts), [server/routes/vault.ts](../server/routes/vault.ts)). Ceremony words stop one-call scripts but are not secrets. Test: [server/scratchpad-protect.test.ts](../server/scratchpad-protect.test.ts), [server/vault-setup.test.ts](../server/vault-setup.test.ts). |

## V4 Access control

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 4.1.1 | Enforced server-side | Met | `apiAuthMiddleware` + lock gate ([server/auth.ts](../server/auth.ts), [server/app.ts](../server/app.ts)). |
| 4.1.2 | Access attributes not user-controllable | Met | Lock state is server memory only. |
| 4.1.3 | Least privilege | Met | While locked, a token holder sees metadata only; locked `POST /api/settings` may change only cosmetic fields (`LOCKED_OK`, [server/routes/settings.ts](../server/routes/settings.ts)). Test: [server/locked-settings.test.ts](../server/locked-settings.test.ts), [server/route-matrix.test.ts](../server/route-matrix.test.ts). |
| 4.1.5 | Fails securely | Met | Unreadable vault refuses unlock; plaintext writes refused when encryption is expected (`refusePlaintextWrite`, [server/store.ts](../server/store.ts)). Test: [server/fail-closed.test.ts](../server/fail-closed.test.ts), [server/crypto.test.ts](../server/crypto.test.ts). |
| 4.2.1 | Protection against IDOR | N/A | Single user; every record belongs to that user. |
| 4.2.2 | CSRF protection | Met | Custom token header, `Sec-Fetch-Site: cross-site` rejected, Host allowlist (DNS rebinding), no CORS headers ([server/auth.ts](../server/auth.ts)). Test: [server/route-matrix.test.ts](../server/route-matrix.test.ts) "wrong Host → 403", "Sec-Fetch-Site: cross-site → 403". |
| 4.3.1 | Admin interfaces use MFA | N/A | No admin interface. |
| 4.3.2 | Directory browsing disabled | Partial | `express.static` serves no listings. `/api/fs` deliberately browses the whole filesystem for the folder picker (token + unlock required) ([server/services/fsBrowser.ts](../server/services/fsBrowser.ts)). A token holder with an unlocked vault can therefore list any directory the user can. |

## V5 Validation, sanitization and encoding

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 5.1.1 | HTTP parameter pollution defenses | Partial | Bodies are JSON; values coerced with `asString`/`asStringArray` ([server/validate.ts](../server/validate.ts)). No schema library. |
| 5.1.3 | Positive input validation | Partial | Allowlists for settings keys, egress booleans, snapshot names, URL schemes (`isHttpUrl`). Many routes coerce rather than validate. |
| 5.1.4 | Structured data strongly typed | Partial | TypeScript on the server, but request bodies are not schema-validated at runtime. |
| 5.1.5 | Redirects/forwards allowlisted | Met | Main window navigation is vetoed except to the local server origin (`will-navigate`, [electron-main.cjs](../electron-main.cjs)); the server issues no redirects. |
| 5.2.1 | HTML from WYSIWYG editors sanitized | Met | DOMPurify allowlist at render (`sanitizeNoteHtml`) and at storage/ingest (`sanitizeNoteHtmlForStorage`) ([src/sanitize.ts](../src/sanitize.ts)). Test: [src/sanitize.fuzz.test.ts](../src/sanitize.fuzz.test.ts). |
| 5.2.2 | Unstructured data sanitized | Partial | Scanned file fragments are sanitized before render ([src/components/NoteDetailModal.tsx](../src/components/NoteDetailModal.tsx)). One detached-element `innerHTML` assignment of editor HTML without DOMPurify remains in [src/components/scratchpad/useScratchEditor.ts](../src/components/scratchpad/useScratchEditor.ts) (BIDI text extraction); CSP `script-src 'self'` blocks inline handlers there. |
| 5.2.4 | No `eval` / dynamic code | Met | No `eval` or `new Function` in [server/](../server/), [src/](../src/) or [shared/](../shared/); CSP has no `'unsafe-eval'`. |
| 5.2.6 | SSRF protection | Partial | Outbound AI/LanguageTool calls are blocked for non-loopback hosts unless the user opts in (`cloudEgressAllowed`, [server/ai/providers.ts](../server/ai/providers.ts)). Once consent is on, user-configured base URLs are only scheme-checked. Tests: [server/egress.test.ts](../server/egress.test.ts), [server/ai/providers.test.ts](../server/ai/providers.test.ts), [server/limits.test.ts](../server/limits.test.ts). |
| 5.2.7 | SVG sanitized | N/A | Users cannot upload SVG for rendering. |
| 5.3.1 | Context-aware output encoding | Met | React escapes by default; the only raw-HTML sinks go through DOMPurify (see 5.2.1). |
| 5.3.3 | XSS protection | Met | As above, plus CSP `script-src 'self'; object-src 'none'; base-uri 'none'` in both [index.html](../index.html) and the server header ([server/app.ts](../server/app.ts)). |
| 5.3.4 | Parameterized queries | Met | Every SQLite statement uses `?` placeholders; table names come from a fixed enum (`RecordTable`) ([server/db/recordDb.ts](../server/db/recordDb.ts)). |
| 5.3.8 | OS command injection | Met | Children are spawned with argument arrays, no shell; the one PowerShell script quotes the path by doubling `'` (`verifyAuthenticode`, [electron-main.cjs](../electron-main.cjs)); the path is app-generated. |
| 5.3.9 | Local/remote file inclusion | Met | Snapshot names must match `^indexarc-emergency-[\w\-.]+\.iabak$` before any path join ([server/routes/misc.ts](../server/routes/misc.ts)). |
| 5.4.x | Memory safety | N/A | JavaScript/TypeScript only; parsers run in a heap-limited worker. |
| 5.5.1 | Serialized objects integrity-protected | Met | Stored data is AES-GCM authenticated JSON. |
| 5.5.2 | XML parsers restrict external entities | Partial | `.docx`/`.xlsx` XML is parsed by mammoth/exceljs in the isolated worker with size, zip-budget and time limits ([server/services/folderScan.ts](../server/services/folderScan.ts) `zipBudgetProblem`). Entity handling of those libraries is not separately verified. Test: [server/fuzz.test.ts](../server/fuzz.test.ts). |
| 5.5.3 | Untrusted deserialization avoided | Met | `JSON.parse` only. |
| — | ReDoS in secret detectors | Met | Regex safety test: [server/ai/regex-safety.test.ts](../server/ai/regex-safety.test.ts); fuzz: [server/fuzz.test.ts](../server/fuzz.test.ts). |

## V6 Stored cryptography

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 6.1.1 | Private data encrypted at rest | Met | Vault rows, header, notes, archive, revisions, scan sessions and vectors are AES-256-GCM sealed. Tests: [server/storage-v2.test.ts](../server/storage-v2.test.ts) "no plaintext secret anywhere", [server/envelope-coverage.test.ts](../server/envelope-coverage.test.ts), [server/scratchpad-encryption.test.ts](../server/scratchpad-encryption.test.ts), [e2e/vault-lifecycle.spec.ts](../e2e/vault-lifecycle.spec.ts). |
| 6.1.2 | Health-type data encrypted | N/A | Covered by 6.1.1; no special category. |
| 6.1.3 | Financial data encrypted | N/A | Covered by 6.1.1. |
| 6.2.1 | Crypto fails securely; no padding oracle | Met | GCM throws on any modification; callers fail closed. Test: [server/crypto.property.test.ts](../server/crypto.property.test.ts) "detects any single modified nibble". |
| 6.2.2 | Proven crypto implementations | Met | Node `crypto` (OpenSSL) for AES-GCM/PBKDF2/HMAC; `hash-wasm` for Argon2id ([server/crypto.ts](../server/crypto.ts)). |
| 6.2.3 | Secure IV, mode and padding | Met | Fresh random 96-bit IV per write; 16-byte tag enforced on encrypt and decrypt (`GCM_IV_BYTES`, `GCM_TAG_BYTES`). Test: [server/crypto.property.test.ts](../server/crypto.property.test.ts) "rejects truncated auth tags of every length". |
| 6.2.4 | Algorithms replaceable (agility) | Met | KDF descriptor and version in every envelope; silent upgrade on unlock (`kdfNeedsUpgrade`). Test: [server/kdf-migration.test.ts](../server/kdf-migration.test.ts). |
| 6.2.5 | No insecure modes or weak primitives | Met | AES-256-GCM, Argon2id, SHA-256 only. |
| 6.2.6 | Nonces unique and unpredictable | Met | `crypto.randomBytes(12)` per encryption. Test: [server/crypto.property.test.ts](../server/crypto.property.test.ts) "never reuses an IV". |
| 6.2.7 | Encrypted data authenticated | Met | GCM tag on every envelope and row. |
| 6.2.8 | Constant-time comparisons | Met | Token comparison via SHA-256 + `timingSafeEqual` ([server/auth.ts](../server/auth.ts) `tokenMatches`). |
| 6.3.1 | CSPRNG for random values | Met | `crypto.randomBytes` for keys, salts, IVs, tokens. |
| 6.3.2 | Random GUIDs | Met | Record ids are random UUIDs ([adr/0001](adr/0001-storage-engine.md)). |
| 6.4.1 | Key management solution | Partial | No KMS (local app). Vault key is password-derived and memory-only; settings wrap key is OS-sealed; optional recovery-key escrow sealed to an X25519 public key ([server/recovery.ts](../server/recovery.ts)). |
| 6.4.2 | Key material not exposed | Partial | `lock()` zeroizes the vault key and purges caches; KDF-upgrade and reconcile paths zeroize temporary keys ([server/store.ts](../server/store.ts)). Still in memory while unlocked; strings (the password, decrypted JSON) cannot be zeroized in JS; settings key and token sit in the server env. |
| — | AAD binds ciphertext to context | Met | SQLite rows use AAD `indexarc:v2:<table>:<id>` ([server/store.ts](../server/store.ts) `VaultStore.aad`). The `vault.json` header and every JSON envelope (vectors, scratchpad, archive, revisions, scan sessions) use AAD `indexarc:file:v1:<role>` (`fileAad`/`openEnvelope` in [server/crypto.ts](../server/crypto.ts)). Once the header is bound, an unbound or mis-bound companion is refused; vaults written before this are upgraded on unlock, header last. A vault id is not needed in the AAD: each vault has its own random salt, so another vault's files never decrypt. Tests: [server/storage-v2.test.ts](../server/storage-v2.test.ts) "detects a row body swapped between records", [server/file-aad.test.ts](../server/file-aad.test.ts). |
| — | Rollback / deletion detection | Met | `vault.db` keeps a keyed checksum over its sealed rows: meta `rowsum` = XOR of HMAC(HKDF(vault key, `indexarc:rowsum:v1`), table, id, GCM tag) over every row, updated in the same transaction as each row change ([server/db/recordDb.ts](../server/db/recordDb.ts)). It is checked on unlock and with the integrity check; a row replaced by an older sealed copy, removed, or copied in from another copy of the vault raises an integrity warning and a SECURITY log entry. The encrypted header records that the checksum exists, so deleting it is reported too. Not covered: rolling back the whole vault (every file together) to an older copy, which is indistinguishable from restoring a backup. Tests: [server/row-rollback.test.ts](../server/row-rollback.test.ts). |

## V7 Error handling and logging

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 7.1.1 | No credentials or tokens in logs | Met | Policy and code comments in [server/logs.ts](../server/logs.ts); the token is never logged; clipboard text is never logged ([electron-main.cjs](../electron-main.cjs) `copy-text`). No automated log-scrubbing test. |
| 7.1.2 | No other sensitive data in logs | Partial | Logs carry ids and counts by policy; error messages may include absolute file paths. |
| 7.1.3 | Security events logged | Met | Hash-chained audit log: unlock success/failure, lock, encrypt/decrypt, restore, protect/unprotect, consent and settings changes ([server/audit.ts](../server/audit.ts), [server/routes/vault.ts](../server/routes/vault.ts)). Test: [server/audit.test.ts](../server/audit.test.ts). |
| 7.1.4 | Events carry timeline info | Met | `seq`, ISO `ts`, `event`, `detail` per record. |
| 7.2.1 | Authentication decisions logged | Met | `vault.unlock` success/failure; `vault.decrypt` failure. |
| 7.2.2 | Access-control failures logged | Partial | 401/403/423 responses are not written to the audit log. |
| 7.3.1 | Log injection prevented | Partial | Audit records are serialized JSON lines; the in-memory log is plain text. |
| 7.3.3 | Logs protected from tampering | Partial | Hash chain with persisted anchor detects edits, deletions and truncation, but has no key, so a full-write attacker can re-forge it (documented in [server/audit.ts](../server/audit.ts)). Test: [server/audit.test.ts](../server/audit.test.ts). |
| 7.3.4 | Time sources synchronized | N/A | Uses the OS clock. |
| 7.4.1 | Generic error messages | Met | JSON error handler returns "Internal server error" for 5xx and logs details locally ([server.ts](../server.ts)); unknown `/api` routes get a bare 404. |
| 7.4.2 | Exception handling throughout | Met | `wrapAsync` ([server/asyncWrap.ts](../server/asyncWrap.ts)), try/catch in routes. |
| 7.4.3 | Last-resort error handler | Met | `uncaughtException`/`unhandledRejection` in [server.ts](../server.ts) (message only, then graceful shutdown) and [electron-main.cjs](../electron-main.cjs) (`logCrash`). Shell restarts a crashed server, at most 3 times a minute. |

## V8 Data protection

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 8.1.1 | Sensitive data not cached server-side | Partial | Decrypted caches exist while unlocked for performance; purged on lock (`clearCache`, [server/store.ts](../server/store.ts)). |
| 8.1.2 | Cached copies protected or purged | Met | Lock purges entries, settings, folders and notes caches; renderer clears decrypted state. |
| 8.1.4 | Abnormal request volume detected | Partial | Throttle on password endpoints only. |
| 8.1.5 | Regular backups | Met | Emergency snapshots in three locations, refreshed 10 s after writes and at quit; rolling backups including `vault.db`. Tests: [server/emergency-restore.test.ts](../server/emergency-restore.test.ts), [server/storage-v2.test.ts](../server/storage-v2.test.ts). |
| 8.1.6 | Backups stored securely | Partial | Ciphertext once encryption is on. Pre-encryption plaintext copies are moved to `backups/plaintext-grace/` and kept until the first unlock 24 h or more after encryption (ransom-recovery window, [server/store.ts](../server/store.ts)). Test: [server/encrypt-grace.test.ts](../server/encrypt-grace.test.ts). Locked restore of a plaintext snapshot is refused. |
| 8.2.1 | Anti-caching headers on sensitive responses | Met | Every `/api` response sets `Cache-Control: no-store` ([server/app.ts](../server/app.ts)), so decrypted responses stay out of Chromium's disk cache; SSE keeps `no-cache`. Asserted for every GET route in [server/route-matrix.test.ts](../server/route-matrix.test.ts). |
| 8.2.2 | No sensitive data in browser storage | Met | Token in module memory; no secrets in `localStorage` ([src/apiAuth.ts](../src/apiAuth.ts)). |
| 8.2.3 | Client data cleared on logout | Met | Lock clears decrypted entries, pasted text and notes from the UI; clipboard cleared after 45 s if unchanged ([electron-main.cjs](../electron-main.cjs) `copy-text`). |
| 8.3.1 | Sensitive data not in URLs | Met | Bodies and headers only (SSE ticket excepted, see 3.1.1). |
| 8.3.2 | User can export/delete their data | Met | Data lives in the portable folder; backups/snapshot UI; delete per entry. |
| 8.3.4 | Sensitive data identified with a policy | Met | [THREAT-MODEL.md §1](THREAT-MODEL.md). |
| 8.3.5 | Access to sensitive data audited | Partial | Mutations and key events are audited; reads of secret values are not. |
| 8.3.6 | Sensitive data wiped from memory when no longer needed | Partial | Key buffers zeroized; JS strings cannot be. |
| 8.3.7 | Sensitive data encrypted with authenticated encryption | Met | See V6. |
| 8.3.8 | Retention policy | Met | Snapshot retention tiers (thinning, 8-week cut-off): [server/retention.test.ts](../server/retention.test.ts). |
| — | Secret values never sent to cloud AI | Met | Embedding/LLM input carries names, types and labels only (`indexTextFor`, [server/services/vault.ts](../server/services/vault.ts)); cloud egress off by default. Test: [server/egress.test.ts](../server/egress.test.ts) "values/notes never in outbound bodies". |

## V9 Communications

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 9.1.1 | TLS for all client connectivity | Partial | Renderer <-> server is HTTP on loopback (no network exposure; server binds `127.0.0.1`, forced by the shell env `HOST=127.0.0.1`). Outbound cloud calls use the providers' HTTPS endpoints. A user may configure an `http://` custom endpoint. |
| 9.1.2 | Strong TLS configuration | N/A | Outbound TLS uses Node/Chromium defaults; no server-side TLS. |
| 9.2.1 | Outbound connections use trusted certificates | Met | Default Node trust store; no `rejectUnauthorized: false` found. |
| 9.2.2 | Encrypted connections to external systems | Partial | As 9.1.1. |
| 9.2.4 | Certificate revocation checks | N/A | Platform default. |
| — | Bind address | Partial | `bind_host` in `config/settings.json` can override the loopback bind in standalone runs ([server.ts](../server.ts)); it is not writable via the API ([server/routes/settings.ts](../server/routes/settings.ts)), and the Electron shell always passes `HOST=127.0.0.1`. |

## V10 Malicious code

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 10.1.1 | Code analysis tooling in CI | Partial | Typecheck, tests, fuzz smoke, dependency audit ([ci.yml](../.github/workflows/ci.yml)). No SAST (CodeQL/Semgrep) or secret scanning workflow. |
| 10.2.1 | No unauthorized phone-home | Met | No telemetry. Network use is opt-in: cloud AI, LanguageTool, update checks (`update_check_on_start: false` by default, [server/types.ts](../server/types.ts); [shared/updater.cjs](../shared/updater.cjs)). Test: [server/egress.test.ts](../server/egress.test.ts). |
| 10.2.3 | No back doors | Met | Production builds disable token bootstrap (`/api/auth/bootstrap` returns 404 unless dev or `INDEXARC_ALLOW_BOOTSTRAP=1`). Test: [server/route-matrix.test.ts](../server/route-matrix.test.ts). |
| 10.3.1 | Auto-update over secure channel with signed packages | Partial | electron-updater over HTTPS from GitHub Releases; download/install only when `publisherName` exists (signed build), so Authenticode is verified; no prerelease, no downgrade ([shared/updater.cjs](../shared/updater.cjs)). Test: [shared/updater.test.ts](../shared/updater.test.ts). **Release builds are not signed yet** ([docs/RELEASE.md](RELEASE.md)), so today no build can self-install. |
| 10.3.2 | Integrity protection of the application | Partial | Electron fuses (`runAsNode` off, `NODE_OPTIONS` off, inspect args off, embedded asar integrity, only-load-from-asar) in [package.json](../package.json). Unpacked `dist/` is hash-checked against a manifest inside `app.asar` before loading ([shared/verify-dist.cjs](../shared/verify-dist.cjs)). Test: [shared/verify-dist.test.ts](../shared/verify-dist.test.ts). Without a code signature the whole package can still be replaced. |
| 10.3.3 | Subdomain takeover | N/A | No hosted domains. |
| — | Third-party downloads verified | Met | Ollama installer is size-capped and Authenticode-verified (status `Valid`, exact signer match) before it runs (`verifyAuthenticode`, [electron-main.cjs](../electron-main.cjs)). |
| — | Secrets not inherited by child processes | Met | Token, settings key and provider keys are stripped from the env of Ollama/LanguageTool children ([shared/child-env.cjs](../shared/child-env.cjs)). |

## V12 Files and resources

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 12.1.1 | File size limits | Met | Text files 512 KB, documents 5 MB, at most 500 files, depth 12, 4000 directories per scan ([server/services/folderScan.ts](../server/services/folderScan.ts)). JSON body 2 MB ([server/app.ts](../server/app.ts)). |
| 12.1.2 | Compressed-file limits (zip bombs) | Met | Central-directory budget: 64 MB uncompressed, 5000 entries, no ZIP64 (`zipBudgetProblem`). Tests: [server/limits.test.ts](../server/limits.test.ts), [server/fuzz.test.ts](../server/fuzz.test.ts). |
| 12.1.3 | Per-user quota | N/A | Single user. |
| 12.3.1 | User-supplied filenames sanitized | Met | Snapshot names allowlisted (5.3.9). Folder paths come from the user's own picker. |
| 12.3.2 | Path traversal | Met | No user-controlled path joins on server storage paths; folder watcher does not follow symlinks out of the watched folder. Test: [server/limits.test.ts](../server/limits.test.ts) "does not follow a symlink out of the watched folder". |
| 12.3.3 | No remote file inclusion | Met | No URL-based file loading. |
| 12.3.5 | No command injection via file metadata | Met | File contents are parsed, never executed. |
| 12.4.1 | Untrusted files stored outside web root | Met | Scanned files are read in place; only extracted text is stored, encrypted. |
| 12.4.2 | Untrusted files scanned/isolated | Met | Binary documents parse in the worker with 512 MB heap and ~35 s deadline ([server/services/docParse.ts](../server/services/docParse.ts)). Test: [server/folderScan.test.ts](../server/folderScan.test.ts). |
| 12.5.1 | Web tier serves only allowed file types | Met | `express.static` over the built `dist/` only. |
| 12.6.1 | SSRF via file/URL fetching | Partial | See 5.2.6. |

## V13 API and web service

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 13.1.1 | Same encoding/parsers everywhere | Met | JSON via `express.json`. |
| 13.1.3 | No sensitive data in API URLs | Met | Except the one-time SSE ticket (3.1.1). |
| 13.1.4 | Authorization at URI and resource level | Met | Token for every `/api` route, lock gate per path. Test: [server/route-matrix.test.ts](../server/route-matrix.test.ts) "every registered route has an explicit policy". |
| 13.1.5 | Requests with unexpected content types rejected | Partial | `express.json` ignores non-JSON bodies (route then sees an empty body and returns 400); no explicit 415. |
| 13.2.1 | Only intended HTTP methods enabled | Met | Duplicate/unknown routes caught by the route-matrix test; unknown `/api` paths return 404. |
| 13.2.2 | JSON schema validation | **Gap** | No runtime schema validation (see 5.1.4). |
| 13.2.3 | CSRF protection on RESTful APIs | Met | See 4.2.2. |
| 13.2.5 | Content-Type checked | Partial | As 13.1.5. |
| 13.2.6 | Message headers/payload trustworthy | Met | Token header + Host + Sec-Fetch-Site. |

## V14 Configuration

| # | Requirement (short) | Status | Evidence / notes |
|---|---|---|---|
| 14.1.1 | Repeatable, automated builds | Met | `npm ci` + scripted build in CI; installer preservation job ([ci.yml](../.github/workflows/ci.yml)). |
| 14.1.2 | Compiler/hardening flags | N/A | No native code compiled by the project (`npmRebuild: false`). |
| 14.1.3 | Server configuration hardened | Met | `x-powered-by` disabled; security headers on every response ([server/app.ts](../server/app.ts)). |
| 14.1.5 | Integrity of configuration verified | Partial | `dist/` integrity manifest and asar fuses (10.3.2); `config/settings.json` itself is not integrity-protected. |
| 14.2.1 | Components up to date | Met | Dependabot weekly for npm and Actions ([.github/dependabot.yml](../.github/dependabot.yml)); Electron 44. |
| 14.2.2 | Unneeded features removed | Met | Dev-only bootstrap disabled in production; DevTools only in unpackaged runs; app menu removed. |
| 14.2.3 | Assets from CDNs use SRI | N/A | All assets are bundled locally; CSP `default-src 'self'`. |
| 14.2.4 | Third-party components from trusted repositories | Met | npm lockfile with `npm ci`. |
| 14.2.5 | Inventory of third-party libraries (SBOM) | Met | CycloneDX SBOM of runtime deps generated and attached to releases ([desktop-builds.yml](../.github/workflows/desktop-builds.yml)). |
| 14.2.6 | Attack surface reduced by sandboxing | Met | See 1.14.1. |
| — | CI supply chain | Met | Actions pinned to commit SHAs; `permissions: contents: read` by default, `contents: write` only in the release job ([ci.yml](../.github/workflows/ci.yml), [desktop-builds.yml](../.github/workflows/desktop-builds.yml)). |
| — | Dependency vulnerability gate | Met | `npm audit --audit-level=high` fails CI ([ci.yml](../.github/workflows/ci.yml)). |
| 14.3.2 | Debug modes disabled in production | Met | `NODE_ENV=production` passed to the server; DevTools opened only when `!app.isPackaged` ([electron-main.cjs](../electron-main.cjs)). |
| 14.3.3 | Headers don't expose version info | Met | `x-powered-by` disabled. |
| 14.4.1 | Content-Type with charset on responses | Met | Express sets `application/json; charset=utf-8`. |
| 14.4.3 | Content-Security-Policy | Met | Identical CSP in [index.html](../index.html) and the header, plus `frame-ancestors 'none'` ([server/app.ts](../server/app.ts)). `style-src` allows `'unsafe-inline'` for React style attributes. |
| 14.4.4 | `X-Content-Type-Options: nosniff` | Met | [server/app.ts](../server/app.ts). |
| 14.4.5 | HSTS | N/A | No HTTPS origin (loopback HTTP). |
| 14.4.6 | Referrer-Policy | Met | `strict-origin-when-cross-origin`. |
| 14.4.7 | Framing restricted | Met | `frame-ancestors 'none'` and `X-Frame-Options: DENY`. |
| 14.5.2 | Origin header not used for authz alone | Met | Token is the authorization; Host/Sec-Fetch-Site are extra checks. |
| 14.5.3 | CORS allowlist | Met | No CORS headers at all, so cross-origin reads are impossible. |

---

## Electron security checklist

Source: the numbered list at electronjs.org/docs/latest/tutorial/security.

| # | Item | Status | Evidence / notes |
|---|---|---|---|
| 1 | Only load secure content | Partial | The window loads only `http://127.0.0.1:<port>` after the server proves its identity (`pollServerAndLoad`). It is loopback HTTP, not HTTPS. No remote content is loaded. |
| 2 | Do not enable Node.js integration for remote content | Met | `nodeIntegration: false` ([electron-main.cjs](../electron-main.cjs) `createWindow`). |
| 3 | Enable context isolation | Met | `contextIsolation: true`. |
| 4 | Enable process sandboxing | Met | `sandbox: true`; preload uses only `contextBridge`/`ipcRenderer` ([preload.cjs](../preload.cjs)). |
| 5 | Handle session permission requests | Met | `setPermissionRequestHandler` denies all; `setPermissionCheckHandler` returns false. |
| 6 | Do not disable `webSecurity` | Met | Not set (default true). |
| 7 | Define a Content-Security-Policy | Met | Meta tag in [index.html](../index.html) and HTTP header in [server/app.ts](../server/app.ts). |
| 8 | Do not enable `allowRunningInsecureContent` | Met | Not set. |
| 9 | Do not enable experimental features | Met | Not set. |
| 10 | Do not use `enableBlinkFeatures` | Met | Not set. |
| 11 | `<webview>`: do not use `allowpopups` | N/A | `webviewTag` is not enabled; no `<webview>` used. |
| 12 | Verify WebView options before creation | Partial | No `<webview>` is possible (tag disabled by default), but there is no `will-attach-webview` handler as a backstop. |
| 13 | Disable or limit navigation | Met | `will-navigate` vetoes anything but the local server origin (`isAppUrl`). Not unit-tested; covered indirectly by [e2e/vault-lifecycle.spec.ts](../e2e/vault-lifecycle.spec.ts). |
| 14 | Disable or limit creation of new windows | Met | `setWindowOpenHandler` always denies and hands `http:`/`https:`/`mailto:` to the OS browser. |
| 15 | Do not use `shell.openExternal` with untrusted content | Partial | Parsed-URL scheme allowlist (`http:`, `https:`, `mailto:`) in both `open-external` IPC and the window-open handler. Any https URL in note content can still be opened in the browser (by design). |
| 16 | Use a current version of Electron | Met | Electron 44 ([package.json](../package.json)); Dependabot keeps it moving. |
| 17 | Validate the sender of all IPC messages | Partial | Every `invoke` channel goes through `handleTrusted`, which requires the main window's top frame showing the local server origin (`isTrustedSender`). The one `ipcMain.on("flush-complete")` listener is not sender-checked (it only resolves the quit handshake). No unit test for `isTrustedSender`. |
| 18 | Avoid `file://`; prefer a custom protocol | Partial | No `file://` is used. The app uses a loopback HTTP server instead of a custom protocol, so other local processes can reach the origin (they still need the token). |
| 19 | Check which fuses you can change | Met | `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` off; `enableEmbeddedAsarIntegrityValidation`, `onlyLoadAppFromAsar` on ([package.json](../package.json) `electronFuses`). Cookie-encryption and file-protocol fuses are left at defaults (no cookies, no `file://`). |
| 20 | Do not expose Electron APIs to untrusted web content | Met | The bridge exposes 13 narrow `invoke` wrappers, one `send`, and event subscriptions; no raw `ipcRenderer` ([preload.cjs](../preload.cjs)). |

---

## Gap summary

Counts for the ASVS tables above (Electron checklist counted separately).

| Status | ASVS rows | Electron rows |
|---|---|---|
| Met | 121 | 14 |
| Partial | 43 | 5 |
| N/A | 23 | 1 |
| Gap | 5 | 0 |
| **Total** | **192** | **20** |

Priority gaps for the roadmap:

1. ~~8.2.1 Cache-Control on `/api`~~ fixed 2026-11-04.
2. **Unsigned releases (10.3.1, 10.3.2).** The signed-update path exists but no build is signed, so updates cannot self-install and the package has no publisher identity. Needs the certificate decision (R2.1).
3. ~~Row rollback / deletion not detected (V6)~~ landed 2026-11-04: keyed row checksum in `vault.db`, checked on unlock.
4. ~~AAD missing on JSON envelopes (V6)~~ landed 2026-11-04: header and every JSON envelope bound to their file role.
5. ~~Password policy (2.1.1, 2.1.7, 2.1.8, 2.1.12)~~ landed 2026-11-04: 12-character minimum, offline common-password check, strength meter, reveal toggle.
6. ~~Change password (2.1.5)~~ landed 2026-11-04.
7. **Recovery (2.5.6) follow-ups.** Landed 2026-11-04. Still to do: say in the UI that a password change does not revoke the code, and bind the seal's AAD to a vault id.
8. **13.2.2 Runtime schema validation** of request bodies.
9. **SAST / secret scanning in CI (10.1.1, Partial).** Add CodeQL and enable GitHub secret scanning.
10. **Electron hardening (items 12, 17, 18).** Add a `will-attach-webview` deny handler, sender-check `flush-complete`, unit-test `isTrustedSender`; consider a custom protocol or named-pipe transport.

External verification (penetration test against [THREAT-MODEL.md](THREAT-MODEL.md)) is still open and needs an owner decision on vendor and budget.
