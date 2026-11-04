# Security Policy and Repository Cleanliness

This document covers how to report a vulnerability, which versions get fixes, the security architecture of **IndexArc**, and the rules for keeping the repository free of secrets.

As a portable personal vault, maintaining maximum security for user data and zero-exposure for API keys, passwords, and private tokens is a core architectural pillar of IndexArc.

Related documents: [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md) (threat model) and [docs/ASVS-L2.md](docs/ASVS-L2.md) (OWASP ASVS L2 and Electron checklist mapping, with evidence and known gaps).

---

## Reporting a vulnerability

**Please do not open a public issue, discussion or pull request for a security problem.**

### Channel

Report privately through GitHub private vulnerability reporting (Security Advisories) for this repository:

**https://github.com/Mubder/IndexArc/security/advisories/new**

This is the preferred channel. If you cannot use GitHub, email [b.alfaris@gmail.com](mailto:b.alfaris@gmail.com) instead. The advisory form keeps the report private between you and the maintainers, lets us collaborate on a fix in a private fork, and is how CVEs are requested. A machine-readable pointer is published at [`public/.well-known/security.txt`](public/.well-known/security.txt) (RFC 9116).

Please include:

- the IndexArc version (Settings → Updates → "Check now" shows it, or see the installer file name) and OS;
- the affected component (Electron shell, vault server, renderer, storage, updater, build/CI);
- steps to reproduce or a proof of concept, and the impact you observed;
- whether the issue needs local access, a malicious file, a malicious web page, or network position.

Do not include real secrets or another person's data in a report. Reports in English or Arabic are welcome.

### Response targets

| Step | Target |
|---|---|
| Acknowledge the report | within **3 business days** |
| Triage (confirm, assign severity, share a plan) | within **7 days** |
| Fix released — critical | within **14 days** of triage |
| Fix released — high | within **30 days** of triage |
| Fix released — medium | within **90 days** of triage |
| Low / hardening | next regular release, or documented as accepted risk |

Severity uses CVSS v3.1 as a guide, judged against [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md). We keep you updated at least at each step above and tell you if a target will slip, and why.

### Coordinated disclosure

- Default embargo is **90 days** from the report, or until a fix is released, whichever comes first. We may agree a shorter or longer window with you, for example if a fix is ready early or depends on an upstream project (Electron, Node, a dependency).
- When a fix ships, we publish a **GitHub Security Advisory** for the repository and request a **CVE** through GitHub (GitHub is a CVE Numbering Authority) for any issue that affects released builds.
- Reporters are credited in the advisory unless they ask not to be.
- If an issue is being actively exploited, we may publish mitigations before the embargo ends.

### Safe harbor

We consider security research carried out in good faith under this policy to be authorized. We will not pursue or support legal action against you for:

- testing IndexArc on systems and data you own or are allowed to test;
- circumventing protections in IndexArc itself as needed to show a vulnerability;
- reporting through the channel above and giving us reasonable time to fix before public disclosure.

Please avoid privacy violations, data destruction and service disruption, do not access data that is not yours, and stop and report as soon as you have shown the issue. If in doubt about whether something is in scope, ask in the advisory first.

Out of scope: findings that need an attacker who already has administrator/kernel control of an unlocked session, or that only affect an unsupported version; missing hardening with no demonstrated impact; and the known gaps already listed in [docs/ASVS-L2.md](docs/ASVS-L2.md#gap-summary) (reports that show real-world impact of those are still welcome).

### Supported versions

| Version | Supported |
|---|---|
| 2.1.x | Yes — security fixes |
| < 2.1 | No — please upgrade |

---

## 1. Security Architecture & Threat Model

IndexArc is designed with a **local-first, local-only by default** security posture. The full threat model is in [docs/THREAT-MODEL.md](docs/THREAT-MODEL.md).

### 🛡️ Local Encryption At Rest
* **Cipher:** AES-256-GCM with a fresh random 12-byte IV per write and a mandatory 16-byte authentication tag (shorter tags or IVs are rejected on decrypt).
* **Key Derivation:** Argon2id (64 MiB memory, t=3, p=4 — Bitwarden-aligned), parameters recorded in every envelope and bound-checked on read, so a tampered file cannot weaken derivation. Vaults created before 2.1 used PBKDF2-HMAC-SHA256 (100,000 iterations); they are re-derived to Argon2id transparently on the next successful unlock.
* **Storage layout (v2):** `data/vault.json` is a small sealed header that serves as the unlock key check. Entries and the semantic index live in `data/vault.db` (SQLite), one row per record, each sealed separately with additional authenticated data `indexarc:v2:<table>:<id>` so a ciphertext cannot be moved to another row. Notes, archive, revisions and scan sessions are separate encrypted JSON files. All of them use one random vault salt, so a single derived key opens them all. See [docs/adr/0001-storage-engine.md](docs/adr/0001-storage-engine.md), including what metadata stays visible at rest (row counts and sizes) and the known limitation that a row rolled back to an older sealed copy is not detected.
* **Fail-closed:** if a vault was encrypted but its header is missing or unreadable, IndexArc refuses to unlock and refuses to write plaintext. Unreadable files are quarantined, never overwritten.
* **Lock State:** Locking zeroes and drops the derived key in the server process and clears decrypted entries, pasted text and notes from the UI. Auto-lock (5 minutes by default, configurable) counts only real user input — background polling does not keep the vault open. Unlocking requires the master password; failed attempts are throttled with an escalating delay.
* **Locked-state guarantees:** While locked, a holder of the local API token sees metadata only and may change only cosmetic settings. Emergency restores of snapshots that contain unencrypted data are refused until the vault is unlocked.
* **Clipboard:** Copied secret values are cleared from the clipboard after 45 seconds (only if the clipboard still holds that value).
* **Cloud API keys at rest:** In packaged builds, provider API keys in `config/settings.json` are wrapped with a key protected by the OS keychain (Electron `safeStorage` / DPAPI). On a machine that can't open that key (a portable copy moved to another PC), the wrapped keys are left untouched and work again on the original machine. Dev/standalone runs keep them in plaintext.
* **Lost password:** in released builds a lost master password means the data cannot be recovered. A recovery key is being added (see the threat model): whoever holds the recovery code and a copy of the data files can open the vault, so the code must be stored as carefully as the password.

### 📍 Data outside the portable folder
IndexArc keeps its data in the portable root, with these deliberate exceptions for crash/reinstall recovery: emergency snapshots in `%APPDATA%\IndexArc\emergency` and `~/.IndexArc/emergency` (same encryption as the vault), the vault-root pointer in `HKCU\Software\IndexArc` and `%APPDATA%\IndexArc\vault-root.json`, and Chromium's renderer profile.

### 🌐 Network & Process Isolation
* **Process separation:** the Electron shell, the vault server (an Electron `utilityProcess`), and the renderer are separate processes. The renderer runs with `sandbox`, `contextIsolation` and no Node integration, and reaches the shell only through a small set of sender-checked IPC calls. Scanned Office/PDF documents are parsed in a worker thread with memory and time limits.
* **Localhost Binding:** The vault server binds exclusively to `127.0.0.1` (localhost). It does not accept remote incoming network traffic.
* **Pairing token:** the shell creates a random 256-bit token at every launch and passes it only to the server process. Every `/api` call must carry it; requests with a foreign `Host` header or `Sec-Fetch-Site: cross-site` are rejected. Before showing any window content, the shell checks that the server on the port proves knowledge of the token.
* **No Direct UI Storage Access:** The React frontend has no direct permission to read or write disk files or interact directly with raw AI APIs; all calls are mediated by the localhost server over the token-gated API.
* **AI API Routing:** Credentials for external cloud providers (such as Gemini, Groq, OpenRouter, Anthropic, or custom OpenAI endpoints) are stored locally (OS-wrapped in packaged builds) and injected only during backend API calls. They are never sent back to the frontend UI or exposed in server logs.

### 🔄 Updates and build integrity
* **Auto-update:** update checks are off by default and run only when the user asks. Updates come from GitHub Releases. Download and install happen only on installed Windows builds that are code-signed, where the update's signature is verified against the publisher; other builds only link to the release page. **Release builds are currently unsigned**, so no build installs updates by itself yet (see [docs/RELEASE.md](docs/RELEASE.md)).
* **Package integrity:** Electron fuses are set (no run-as-Node, no `NODE_OPTIONS`, no inspector flags, asar integrity, load app only from asar), and the unpacked server bundle is hash-checked against a manifest inside `app.asar` before it runs.
* **Supply chain:** CI pins every GitHub Action to a commit SHA, runs with read-only permissions by default, fails on high/critical `npm audit` findings, and attaches a CycloneDX SBOM to each release. Dependabot updates npm packages and Actions weekly.

---

## 2. Zero-Secrets Policy & Git Hygiene

We enforce a strict **Zero-Secrets Policy** for the IndexArc Git repository. No actual vault data, settings, logs, `.env` configurations, or private API keys must ever be committed to the repository history.

### 🔍 Repository Cleanliness Baseline Audit
A security sweep of the repository and its commit history was performed as a baseline.
* **Result at the time of the sweep:** no secrets, active API keys, raw password parameters, or personal data files were found in tracked code or past commits. This is a point-in-time result; contributors keep it true by following section 3.
* **Excluded Metadata:** IDE and developer agent metadata (such as `.zcode/`) are ignored to keep the commit logs uncluttered and strictly focused on production source code.

### 🚫 Ignored Directories and Files
The project uses an extensive `.gitignore` specification to prevent accidental commits of local state. The following files are **never tracked by Git** and are **excluded from the packaged Desktop builds**:

| Directory / File | Purpose | Why It's Ignored |
| :--- | :--- | :--- |
| `data/` | Vault store (`vault.json` header, `vault.db`, notes, scan sessions, audit log) | Contains actual user secrets, notes, and vector representations. |
| `config/` | Application configurations (`settings.json`, `settings.key.enc`) | Holds configured AI credentials (e.g., Gemini/OpenAI API keys). |
| `backups/` | Automated timestamped copies and emergency backups | Contains plaintext or encrypted historical vault state. |
| `logs/` | Server and crash logs | May accidentally cache structural references or metadata. |
| `.env` / `.env.*` | Development-specific environment overrides | Used by developers to inject active API overrides locally. |
| `*.log` | Runtime node/Express server logs (`server-err.log`, etc.) | Logs local process tracebacks and server runtime telemetry. |
| `dist/` / `dist-desktop/` | Built SPA bundles and native electron builds | Local build artifacts. |
| `.zcode/` | AI agent plans and tracking session state | Temporary development logs. |

---

## 3. Contributor Guidelines: Avoiding Secret Leaks

To maintain a secure repository, please adhere to the following best practices during development:

### 💡 1. Use Environment Overrides Safely
If you need to use an active cloud API key during backend testing, place it inside a local `.env` file in the project root:
```env
GEMINI_API_KEY=your_actual_api_key_here
```
Dotenv is configured locally and will inject this override for development without writing keys into `config/settings.json` or tracking them.

### 🧹 2. Verify Your Staged Changes Before Committing
Always review your diffs before committing:
```bash
# Review exact diffs staged for commit
git diff --cached
```
Check that no real settings, credentials, or databases are listed as additions.

### 🧪 3. Never Log Sensitive Variables
When writing backend logic or service providers, ensure that log statements do not print raw secret payloads:
```typescript
// 👍 Safe (logging metadata/count)
addLog("DB", `Successfully loaded ${entries.length} vault entries.`);

// 🚫 Unsafe (never print active credentials or raw values)
addLog("API", `Sending request with key: ${apiKey}`); // NEVER DO THIS
```

---

## 3b. Cloud Egress Gates (enforced in code)

Every path that sends vault-derived text to an AI provider passes through
`cloudEgressAllowed()` in `server/ai/providers.ts`:

- **Loopback providers (Ollama / LM Studio on 127.0.0.1)** are always allowed — data stays on the machine.
- **Cloud providers** (Gemini/OpenAI/Groq/OpenRouter/Anthropic, or a "local" provider pointed at a non-loopback host) are **blocked until the user explicitly enables `ai_cloud_consent` in Settings → AI**.

Gated paths (regression-tested in `server/ai/providers.test.ts` and
`server/egress.test.ts`): paste/note classification (`analyzePaste`),
embeddings (`embedText` incl. its cloud fallbacks), text generation
(`generateText`), and live-note autocomplete (`autoComplete`). With consent
OFF, all of them degrade to heuristics/local without a single cloud request.

**Encryption grace period (ransom recoverability).** When a master password
is set, every pre-existing plaintext backup/snapshot/rollback copy is MOVED
(not deleted) to `backups/plaintext-grace/`, and deleted only after the vault
is next successfully unlocked **≥24h after** encryption. A hostile or fumbled
one-call encryption therefore cannot destroy its own recovery path: the
staged snapshots stay listed in Settings → Emergency Plan (flagged as
pre-encryption copies) and restore the plaintext vault by name. Honest
scope: an attacker with *sustained* token access can wait out the window and
unlock with their own password — but that attacker can already read every
secret, so lockout adds nothing for them.

Additionally: secret **values** never enter cloud embedding input at all (see
`indexTextFor` in `server/services/vault.ts` — metadata only), and
`POST /api/vault/setup-password` requires the interactive ceremony word
(`confirm_word: "ENCRYPT"`) so a hostile token-holder cannot one-call-encrypt
the vault under an attacker password.

---

## 3c. Endpoint Gating Matrix

Every `/api` route requires the per-process pairing token (`server/auth.ts`;
exemptions: `/api/ping`, `/api/auth/bootstrap` in dev builds or with
`INDEXARC_ALLOW_BOOTSTRAP=1` only,
`/api/events` with a one-time ticket). Secret-bearing paths (`/api/entries`,
`/api/analyze`, `/api/folders`, `/api/ask`, `/api/snippets`,
`/api/scratchpad`, `/api/fs`, `/api/proofread`, `/api/rewrite`,
`/api/ollama/ensure`) additionally require the vault to be **unlocked**. The
policy for every route is enforced by `server/route-matrix.test.ts`.

Deliberately reachable while locked (needed by the pre-unlock UI; safe by
construction — a token holder learns vault *metadata*, never secret values):
`/api/status`, `/api/settings` (GET returns `*_configured` booleans only;
POST is sticky write-only — an empty key field means "keep stored" — and
while locked accepts only cosmetic fields: language and font sizes),
`/api/logs` (redaction policy: ids, never values), `/api/health`,
`/api/backups` + `/api/emergency*` (metadata only; restore re-locks, and a
snapshot holding unencrypted data is refused while locked),
`/api/audit` (hash-chained, ids only), and the spellcheck routes.

Provider API keys may be supplied via environment variables instead of
`config/settings.json` (recommended for dev — keeps secrets out of a file
that gets copied into `backups/`): `GEMINI_API_KEY`, `OPENAI_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`,
`LOCAL_OPENAI_API_KEY`.
