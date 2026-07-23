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

## 4. Reporting a Security Vulnerability

If you discover a security vulnerability or security-related bug in IndexArc, please do not open a public issue. Instead, report it privately by contacting the maintainers directly or emailing [b.alfaris@gmail.com](mailto:b.alfaris@gmail.com). We will address all verified vulnerability reports promptly.
