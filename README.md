# IndexArc Vault 2.0

<p align="center">
  <strong>Ultra-Secure, Portable AI Personal Vault & Intelligence Assistant</strong>
</p>

<p align="center">
  <img src="assets/banner.png" alt="IndexArc Banner" width="100%" error="true" />
</p>

<p align="center">
  <a href="#key-features--capabilities">Features</a> •
  <a href="#installation--setup-guide">Installation</a> •
  <a href="#ai-engine-configuration">AI Setup</a> •
  <a href="#keyboard-shortcuts">Shortcuts</a> •
  <a href="#security--data-protection">Security</a> •
  <a href="#documentation">Docs</a>
</p>

---

## Executive Overview

**IndexArc** is a zero-telemetry, portable personal vault and AI intelligence suite built for developers, engineers, and power users. It provides an all-in-one environment to store, organize, query, and refine sensitive API keys, tokens, environment configs, shell commands, and notes.

Unlike cloud password managers or traditional note apps, **IndexArc runs 100% locally** and stores all vault data next to the executable in a portable directory structure (`data/` + `config/`). You can copy the entire folder onto a USB stick and run it on any computer without leaving traces in system directories or requiring administrator privileges.

---

## Key Features & Capabilities

### 🔒 1. Secrets & Key Vault Management
- **Multi-Extract Ingestion**: Paste a blob of text (e.g. an entire `.env` file or terminal output) and IndexArc automatically parses out all embedded API keys, JWTs, AWS credentials, Telegram IDs, and tokens into individual structured candidates.
- **Strict Naming & Freeform Types**: Every secret requires a user-approved name and custom type (`telegram user id`, `github PAT`, `AWS production secret`).
- **Unidentified Inbox**: Candidates missing names or types are safely parked in the **Needs Review** inbox on Home until you label them.

### ✍️ 2. Advanced Scratchpad Notepad
- **CSpell Trie Engine**: Powered by `cspell-lib` and binary Arabic Tries (`ar.trie.gz`) with $O(L)$ Trie lookups.
- **Developer Technical Dictionary**: Includes developer terms (`checkpointer`, `hardcoded`, `autocompletion`, `proofread`, `scratchpad`, `indexarc`, etc.) to prevent false red underlines on code tokens.
- **Custom Right-Click Context Menu**:
  - Right-clicking any word under the cursor detects the token without needing manual selection.
  - Offers high-precision spelling suggestions.
  - **`Add "[word]" to Dictionary`**: Appends the word to `config/user_dict.txt` so it is permanently remembered across app restarts.
  - **`Ignore "[word]"`**: Appends the word to `config/ignored_words.txt` so it is permanently ignored across app restarts.
- **Inline Ghost-Text Predictions**:
  - Copilot-style live text predictions appear as faint, italicized gray ghost text directly ahead of your typing cursor inside the text box.
  - Features an anti-duplication filter (`extractContinuation`) preventing text cloning across all LLM backends.
  - Press **`Tab ↹`** or **`Right-Arrow`** to accept predictions, or **`Esc`** / type to dismiss.
- **AI Rephrase & Proofread**: Rewrite text across 6 tones (*Human, Professional, Technical, Concise, Formal, Casual*) or proofread with AI or automatic local CSpell Trie fallback.

### 🔍 3. Ask Intelligence & Hybrid Search
- **Bilingual Natural Language Search**: Query your vault in English or Arabic (*e.g. "telegram id", "معرف تيليجرام", "bot token"*).
- **Hybrid Search Engine**: Combines BM25 keyword matching with Cosine similarity vector embeddings (`VectorChunk`s).
- **AI Summarized Answers**: When an AI model is active, Ask generates a concise natural-language response directly referencing matching vault entries.

### 📁 4. Folder Scanner & Directory Watcher
- **Multi-Format Ingestion**: Recursively scans folders and extracts secrets from `.txt`, `.env`, `.json`, `.docx` (via Mammoth), `.pdf` (via PDF-Parse), `.xlsx` (via SheetJS), and source code files.
- **Live Folder Watcher**: Monitors designated directories using a debounced `fs.watch` pipeline and automatically flags newly added secrets in review sessions.

### 📚 5. Library & Duplication Management
- **Filter Chips**: Instant filtering by family (*Secret, Command, Note, Unknown, Attention*).
- **Duplicate Finder**: Identifies duplicate values or similar entry names across your vault and provides one-click bulk cleanup.

### 🔐 6. Bank-Grade Security & Portability
- **AES-256-GCM Encryption**: Optional master password protection using scrypt/Argon2id key derivation with 500ms timing-attack mitigation.
- **Automatic Backups**: Creates timestamped backups on every save (`backups/vault-<stamp>.json`), retaining the last 10 versions automatically.
- **Zero-AppData Dependency**: All configuration (`config/`) and data (`data/`) stay strictly inside the application root directory.

---

## Installation & Setup Guide

### Option A: Pre-compiled Desktop Releases (Windows)

Download the latest release from GitHub or use the pre-built executables:

| Build Output | Path | Description |
| :--- | :--- | :--- |
| **Portable Build** | `dist-desktop/IndexArc-Portable-2.0.0.exe` | Zero installation. Double-click to run directly from USB or any folder. |
| **Setup Installer** | `dist-desktop/IndexArc-Setup-2.0.0.exe` | Standard Windows installer with Start Menu & Desktop shortcuts. |

---

### Option B: Running from Source (Developer Setup)

#### Prerequisites
- **Node.js**: Version 18.0.0 or higher
- **npm**: Version 9.0.0 or higher

#### Step 1: Clone Repository
```bash
git clone https://github.com/Mubder/IndexArc.git
cd IndexArc
```

#### Step 2: Install Dependencies
```bash
npm install
```

#### Step 3: Run Development Web Server
```bash
npm run dev
```
Open [http://127.0.0.1:3000](http://127.0.0.1:3000) in your browser. (Bound to `127.0.0.1` only).

#### Step 4: Run Electron Desktop App
```bash
npm run desktop
```

#### Step 5: Build Production Executables
```bash
# Build web production bundle & server
npm run build

# Package Windows portable & installer executables
npm run desktop:win
```

---

## AI Engine Configuration

IndexArc supports **3 AI Operating Modes**:

### 1. Local AI Mode (Ollama — 100% Offline & Private)
1. Install [Ollama](https://ollama.com).
2. Download recommended models:
   ```bash
   ollama pull qwen2.5:0.5b
   ollama pull nomic-embed-text
   ```
3. Open IndexArc **Settings** tab and set AI Provider to **Local (Ollama)**.

### 2. Cloud API Mode (Gemini, OpenAI, Groq, OpenRouter, Anthropic)
1. Get an API key from Google AI Studio, OpenAI, Groq, OpenRouter, or Anthropic.
2. Open IndexArc **Settings** tab, select your cloud provider, and paste your API key.
3. Keys are stored locally inside `config/settings.json`.

### 3. Heuristic Mode (No AI Required)
Without any AI provider configured, IndexArc's built-in **regex & rule heuristic engine** continues to parse `.env` files, API tokens, commands, and notes completely offline.

---

## Folder Layout & Data Model

```
IndexArc/                     ← Copy this entire folder for USB portability
├── config/                   ← Application configuration
│   ├── settings.json         # AI provider, API keys, models, language
│   ├── user_dict.txt         # Persistent custom dictionary words
│   └── ignored_words.txt      # Persistent ignored words
├── data/                     # Vault data
│   ├── vault.json            # Encrypted or plaintext vault entries
│   ├── vectors.json          # Search embeddings
│   ├── watched_folders.json  # Monitored directory configurations
│   └── scan_sessions.json    # Folder scan session history
├── backups/                  # Automatic timestamped backups (last 10 retained)
├── dist/                     # Compiled web application and server bundle
├── docs/                     # Full technical documentation
├── electron-main.cjs         # Electron main process
├── server.ts                 # Express backend server
└── package.json
```

---

## Keyboard Shortcuts & Controls

| Shortcut | Context | Action |
| :--- | :--- | :--- |
| **`Tab ↹`** or **`→`** | Scratchpad Editor | Accept inline ghost text prediction |
| **`Escape`** | Scratchpad Editor | Dismiss ghost prediction / Close context menu |
| **Right-Click** | Scratchpad Editor | Open Spelling Context Menu (Suggestions, Add, Ignore) |
| **`Ctrl + Z`** | Scratchpad Editor | Undo text edit |
| **`Ctrl + Y`** | Scratchpad Editor | Redo text edit |

---

## Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `INDEXARC_ROOT` | Application directory | Override portable root directory location |
| `GEMINI_API_KEY` | None | API key override for development |
| `PORT` | `3000` | HTTP backend server port |
| `HOST` | `127.0.0.1` | Network binding interface (localhost only) |

---

## Documentation Index

Full technical documentation is located in the [`docs/`](./docs/README.md) directory:

- 📖 **[User Guide](./docs/USER_GUIDE.md)** — Comprehensive usage instructions, workflow guide, and AI setup.
- 🏗️ **[Architecture & Data Model](./docs/ARCHITECTURE.md)** — Process model, CSpell Trie engine, vector search, and encryption.
- 🔌 **[API Reference](./docs/API_REFERENCE.md)** — Complete `/api/*` endpoint documentation.
- 💻 **[Developer Guide](./docs/DEVELOPER_GUIDE.md)** — Development workflow and extension guides.
- 📦 **[Build & Release Guide](./docs/BUILD_AND_RELEASE.md)** — Packaging, code signing, and distribution.
- 🛡️ **[Security Policy](./SECURITY.md)** — Threat model, local encryption scheme, and Zero-Secrets compliance.

---

## License & Security Policy

Private project. Built with strict **Zero-Secrets Compliance** — no private telemetry, tracking, or cloud uploads. All data remains exclusively under user control.
