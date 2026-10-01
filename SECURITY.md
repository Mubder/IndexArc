# Security Policy and Repository Cleanliness

This document outlines the security architecture, threat model, data isolation practices, and guidelines for maintaining a clean, secret-free repository for **IndexArc**.

As a portable personal vault, maintaining maximum security for user data and zero-exposure for API keys, passwords, and private tokens is a core architectural pillar of IndexArc.

---

## 1. Security Architecture & Threat Model

IndexArc is designed with a **local-first, local-only by default** security posture.

### 🛡️ Local Encryption At Rest
* **Cipher:** AES-256-GCM (Galois/Counter Mode), providing authenticated encryption with strong integrity guarantees.
* **Key Derivation:** Derived from the user's master password using PBKDF2-HMAC-SHA256 with **100,000** iterations.
* **Salts and IVs:** Each encrypted file (e.g., `vault.json`, `vectors.json`) uses a cryptographically secure, unique salt (re-used for stable PBKDF2 keys per file) and a fresh 12-byte IV for every write.
* **Lock State:** Locking the vault purges the derived encryption key from the server process memory (`null`s out the key). Unlocking must be explicitly triggered by the user via password entry.

### 🌐 Network & Process Isolation
* **Localhost Binding:** The Express server binds exclusively to `127.0.0.1` (localhost). It does not accept remote incoming network traffic.
* **No Direct UI Storage Access:** The React frontend has no direct permission to read or write disk files or interact directly with raw AI APIs; all calls are mediated by the localhost Express server over a ping-gated port.
* **AI API Routing:** Credentials for external cloud providers (such as Gemini, Groq, OpenRouter, Anthropic, or custom OpenAI endpoints) are stored locally in the portable settings file and injected only during backend API calls. They are never sent back to the frontend UI or exposed in server logs.

---

## 2. Zero-Secrets Policy & Git Hygiene

We enforce a strict **Zero-Secrets Policy** for the IndexArc Git repository. No actual vault data, settings, logs, `.env` configurations, or private API keys must ever be committed to the repository history.

### 🔍 Repository Cleanliness Baseline Audit
A full security sweep has been performed on the entire repository and historical commit logs.
* **Result:** **100% Clean**. No secrets, active API keys, raw password parameters, or personal data files exist in the tracked code or past git commits.
* **Excluded Metadata:** IDE and developer agent metadata (such as `.zcode/`) are ignored to keep the commit logs uncluttered and strictly focused on production source code.

### 🚫 Ignored Directories and Files
The project uses an extensive `.gitignore` specification to prevent accidental commits of local state. The following files are **never tracked by Git** and are **excluded from the packaged Desktop builds**:

| Directory / File | Purpose | Why It's Ignored |
| :--- | :--- | :--- |
| `data/` | Vault store (`vault.json`, `vectors.json`, search indices) | Contains actual user secrets, notes, and vector representations. |
| `config/` | Application configurations (`settings.json`) | Holds configured AI credentials (e.g., Gemini/OpenAI API keys). |
| `backups/` | Automated timestamped JSON copies and emergency backups | Contains plaintext or encrypted historical vault state. |
| `logs/` | In-memory or on-disk server logs | May accidentally cache structural references or metadata. |
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

Gated paths (regression-tested in `server/ai/providers.test.ts`): paste/note
classification (`analyzePaste`), embeddings (`embedText` incl. its cloud
fallbacks), text generation (`generateText`), and live-note autocomplete
(`autoComplete`). With consent OFF, all of them degrade to heuristics/local
without a single cloud request.

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
exemptions: `/api/ping`, opt-in `/api/auth/bootstrap`, `/api/events` with a
one-time ticket). Secret-bearing paths (`/api/entries`, `/api/analyze`,
`/api/folders`, `/api/ask`, `/api/snippets`, `/api/scratchpad`, `/api/fs`)
additionally require the vault to be **unlocked**.

Deliberately reachable while locked (needed by the pre-unlock UI; safe by
construction — a token holder learns vault *metadata*, never secret values):
`/api/status`, `/api/settings` (GET returns `*_configured` booleans only;
POST is sticky write-only — an empty key field means "keep stored"),
`/api/logs` (redaction policy: ids, never values), `/api/health`,
`/api/backups` + `/api/emergency*` (metadata only; restore re-locks),
`/api/audit` (hash-chained, ids only), and the spellcheck routes.

Provider API keys may be supplied via environment variables instead of
`config/settings.json` (recommended for dev — keeps secrets out of a file
that gets copied into `backups/`): `GEMINI_API_KEY`, `OPENAI_API_KEY`,
`GROQ_API_KEY`, `OPENROUTER_API_KEY`, `ANTHROPIC_API_KEY`,
`LOCAL_OPENAI_API_KEY`.

---

## 4. Reporting a Security Vulnerability

If you discover a security vulnerability or security-related bug in IndexArc, please do not open a public issue. Instead, report it privately by contacting the maintainers directly or emailing [b.alfaris@gmail.com](mailto:b.alfaris@gmail.com). We will address all verified vulnerability reports promptly.
