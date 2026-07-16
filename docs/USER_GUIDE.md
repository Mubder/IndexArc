# IndexArc — User Guide

A practical guide to using IndexArc as a personal vault for secrets, API keys, tokens, commands, and notes.

- [What IndexArc is](#what-indexarc-is)
- [Install & run](#install--run)
- [First launch](#first-launch)
- [The interface](#the-interface)
- [Core workflow: paste → identify → save](#core-workflow-paste--identify--save)
- [Scratchpad](#scratchpad)
- [Library](#library)
- [Ask (search) & Rewrite](#ask-search--rewrite)
- [Folder scanning & watching](#folder-scanning--watching)
- [Encryption & the master password](#encryption--the-master-password)
- [Automatic backups](#automatic-backups)
- [AI setup (Ollama & cloud)](#ai-setup-ollama--cloud)
- [System tray & minimize](#system-tray--minimize)
- [Language (English / Arabic)](#language-english--arabic)
- [Where your data lives](#where-your-data-lives)
- [Troubleshooting](#troubleshooting)

---

## What IndexArc is

IndexArc keeps your sensitive snippets in **one place**, on **your** machine. You paste raw text — a single key, a whole `.env` file, a shell command, or a note — and IndexArc:

1. **Extracts** the important values (multi-extract: one paste can yield many items).
2. **Classifies** each into a *family*: **secret**, **command**, **note**, or **unknown**.
3. **Requires a name** for every secret/token so you can find it later.
4. **Parks** anything it can't fully identify in a "Needs Review" inbox until you label it.
5. Lets you **Ask** for things later in English or Arabic ("telegram id", "معرف تيليجرام", "bot token").

It works **fully offline**. AI (local or cloud) makes extraction smarter, but a built-in heuristic engine handles `.env` lines, tokens, IDs, commands, and notes even with no AI configured.

---

## Install & run

### Option A — Desktop app (Windows)

You get two build outputs:

| File | Use |
|------|-----|
| `IndexArc-Portable-2.0.0.exe` | Double-click to run. No installation. Ideal for a USB stick. |
| `IndexArc-Setup-2.0.0.exe` | Installer with Start Menu / desktop shortcuts. |

- **Portable:** just run the `.exe`. On first run it creates its data folders automatically.
- **Installer:** run setup, pick a location (default is `C:\Users\<you>\.IndexArc`), and launch from the shortcut.

> Both builds are code-signed and run without administrator rights.

### Option B — Web app (any OS)

Requires **Node.js 18+**:

```bash
npm install
npm run dev
```

Then open <http://127.0.0.1:3000>. The server binds to `127.0.0.1` only — it is not exposed to your network.

---

## First launch

1. The app opens on the **Home** tab.
2. If you haven't set a master password, the vault is **unencrypted** and ready to use.
3. A **Setup Checker** banner may appear if no AI provider is detected — you can install/start Ollama from there, or dismiss it and use heuristics only.
4. Paste something into the box and click **Analyze** to see the workflow.

---

## The interface

- **Sidebar** — navigation between tabs: Home, Paste/Analyze, Scratchpad, Folders, Library, Ask, Settings, Logs.
- **Top bar** — search, AI provider status, an **AES-256** badge (shows when encryption is on), and quick toggles for **lock**, **theme** (dark/light), and **language** (EN/AR).
- **Main area** — the active tab.

Secret values are **masked by default**. Use the reveal (eye) or copy buttons to access them.

---

## Core workflow: paste → identify → save

1. **Paste** any text on **Home** or the **Paste/Analyze** tab.
   - Examples: a single API key, an entire `.env` file, a `docker run ...` command, a note in Arabic or English.
2. Click **Analyze**. IndexArc splits the paste into **candidates**, each with:
   - a detected **value**,
   - a suggested **type** (freeform, e.g. `telegram user id`, `github token`),
   - a **family** (secret / command / note / unknown),
   - a **confidence** and status badges (**ready**, **needs type**, **needs name**).
3. Edit the **type** and **name** for any candidate. Names are **required for secrets**.
4. Choose an action:
   - **Save Selected** — stores ready items in the vault.
   - **Park Incomplete** — stores items that still need a type/name in the **Needs Review** inbox on Home.
5. Later, open a parked item and **Identify** it (give it a name/type). Once complete it becomes a normal saved entry.

### Entry families

| Family | Meaning |
|--------|---------|
| **secret** | API keys, tokens, passwords, IDs — always require a name. |
| **command** | Shell / PowerShell commands you want to keep. |
| **note** | Free text (bilingual supported). |
| **unknown** | Detected but unclassified — parked until you decide. |

### Entry statuses

| Status | Meaning |
|--------|---------|
| **saved** | Complete and searchable. |
| **needs_name** | Has a type but no name. |
| **needs_type** | Has a name/value but no type. |
| **needs_review** | Needs your attention before it's complete. |

---

## Scratchpad

The **Scratchpad** is a multi-tab notepad for working with text before committing it to the vault. It persists between sessions (stored locally in the app, **not** in the encrypted vault).

- **Multiple tabs** — keep several scratches at once; rename them (the title auto-fills from the first line).
- **Auto-analyze on paste** — paste text and IndexArc detects what it is.
- **Save to Vault** — if the text is a secret/unknown, save it as a vault secret; otherwise **Save as Note**.
- **Rephrase** — rewrite the text in a chosen style (human, professional, technical, concise, formal, casual) using AI.
- **Copy / Clear** and native **spellcheck** (right-click for suggestions).

---

## Library

The **Library** tab is the full browser for everything in your vault:

- **Filter chips** with live counts: all, secret, command, note, unknown, attention (needs review).
- **Search box** to narrow down.
- **Duplicate finder** — detect entries with the same value or similar names, and **bulk-delete** duplicates.
- Each entry shows a status dot, type, name, and a masked preview with hover actions (copy / identify / delete).

---

## Ask (search) & Rewrite

The **Ask** tab has two modes:

### Search
Type a natural query in English or Arabic. IndexArc uses **hybrid search** — keyword matching plus semantic (embedding) similarity — and, when an LLM is available, generates a short **answer** alongside the ranked results.

Examples:
- `telegram id`
- `معرف تيليجرام`
- `bot bAlfaris_1 token`

### Rewrite
Paste text and pick a **style** (human, professional, technical, concise, formal, casual). IndexArc rewrites it using the configured LLM. You can copy the result or restore the original.

---

## Folder scanning & watching

IndexArc can scan a folder on **your machine** to find secrets and notes inside files — no upload happens; files are read locally by the app's server.

1. Go to the **Folders** tab.
2. Enter or **Browse** to a folder path, then **Scan**.
3. IndexArc walks the folder, extracts text from many file types — `.txt`, `.env`, `.json`, source code, and even `.docx`, `.pdf`, `.xlsx` — and produces a **review session** of candidates.
4. Review, edit types/names, and choose per-item decisions (save / park / discard), or apply in bulk.
5. Optionally keep the folder **watched** — new/changed files are re-scanned automatically and merged into your review session.

You can stop watching a folder or remove it from the tracked list at any time.

---

## Encryption & the master password

By default the vault is stored as plain JSON on your disk. For sensitive data, enable **encryption**:

1. Go to **Settings → Encryption**.
2. Choose **Set master password** (minimum 4 characters).
3. IndexArc re-encrypts your vault and vectors with **AES-256-GCM**; the key is derived from your password (PBKDF2, 100,000 iterations).

Once enabled:

- On launch you'll see a **Lock Screen** — enter your master password to unlock.
- The top bar shows an **AES-256** badge and a **lock** button (locks immediately, clearing the key from memory).
- To go back to plaintext, use **Remove password** (requires the current password).

> **Important:** there is no password recovery. If you forget the master password, encrypted data cannot be decrypted. Keep a backup of the password somewhere safe.

---

## Automatic backups

Every time IndexArc starts, it saves a **timestamped copy** of your vault:

- Stored in a `backups/` folder next to your data (e.g. `backups/vault-2026-07-16_22-20-24-722.json`, plus a matching `vectors-*.json`).
- **Encrypted vaults stay encrypted** in the backup (raw bytes are copied).
- Backups are **de-duplicated** — if nothing changed since the last one, no new copy is made.
- IndexArc keeps the **10 most recent** copies and prunes older ones automatically.

If you ever need to restore, close the app and copy a chosen `backups/vault-*.json` over `data/vault.json` (and the matching `vectors-*.json` over `data/vectors.json`).

---

## AI setup (Ollama & cloud)

IndexArc runs without AI, but AI improves extraction, search answers, and rewriting.

### Local AI (Ollama) — recommended for privacy
1. Install [Ollama](https://ollama.com).
2. Pull a small model, e.g. `qwen2.5:0.5b`, and an embedding model like `nomic-embed-text`.
3. In **Settings**, set the provider to **Local**.

In the desktop app, the **Setup Checker** can install/start Ollama and pull the model for you, and IndexArc will start Ollama automatically if it's installed.

### Cloud / API
In **Settings**, set the provider to **API** or a specific provider and enter the key:
- **Gemini** (`@google/genai`)
- **OpenAI**, **Groq**, **OpenRouter**, **Anthropic**, or a **local OpenAI-compatible** endpoint.

### Auto
Set the provider to **Auto** and IndexArc picks the best available: Ollama → Gemini → other configured providers → heuristics.

Keys are stored in `config/settings.json` inside your portable folder (or an environment variable in dev).

---

## System tray & minimize

In the desktop app:

- **Closing** the window doesn't quit — it **hides to the system tray** so the vault keeps running in the background.
- The tray icon menu offers **Open IndexArc** and **Exit**.
- Click the tray icon to bring the window back.
- Use **Exit** from the tray menu (or the app menu) to fully quit.

---

## Language (English / Arabic)

Toggle the UI language from the top bar or **Settings**. Both the interface and search understand English and Arabic, including bilingual queries for the same item.

---

## Where your data lives

IndexArc is **portable** — all your data sits under a single root folder:

```
<root>/
├── data/
│   ├── vault.json          ← your entries (encrypted if you set a password)
│   ├── vectors.json        ← search embeddings
│   ├── watched_folders.json
│   └── scan_sessions.json
├── config/
│   └── settings.json       ← AI provider, keys, language
├── backups/                ← automatic timestamped backups
├── logs/
└── tmp/
```

- **Portable build:** the root is the folder next to the `.exe`. Copy the exe **and** these folders together to move to a USB drive.
- **Installer build:** the root is your install folder (default `C:\Users\<you>\.IndexArc`).
- The desktop app **remembers** its data location across updates/reinstalls, so upgrading never loses your data. See [Build & Release → Data safety](./BUILD_AND_RELEASE.md#data-safety-on-update--reinstall).

To force a specific location, set the `INDEXARC_ROOT` environment variable.

---

## Troubleshooting

**"My saved entries disappeared after reinstalling / updating."**
Your data isn't deleted by updates. The app may just be pointing at a different, empty folder. IndexArc persists its data location (Windows registry + an AppData marker) and restores it on launch. If it still shows empty, set `INDEXARC_ROOT` to the folder that contains your real `data/vault.json`, then relaunch. Check `data/vault.json` file size — a real vault is non-empty.

**"The vault is locked" (HTTP 423) / I can't see my entries.**
Encryption is enabled and the vault is locked. Enter your master password on the Lock Screen.

**AI features do nothing / say no provider.**
No AI provider is configured or reachable. Install/start Ollama, or add an API key in Settings. Extraction still works via heuristics.

**Ollama won't start.**
Make sure it's installed. In the desktop app use the Setup Checker's install/start buttons. Manually, run `ollama serve` and confirm <http://127.0.0.1:11434/api/tags> responds.

**Port 3000 already in use.**
Another instance or app is using it. Close the other instance, or set the `PORT` environment variable (dev/web) to a free port.

**I forgot my master password.**
Encrypted data can't be recovered without it. If you have an **unencrypted** backup from before you set the password, you can restore that.

**Where are the logs?**
The **Logs** tab shows recent system/AI events. Files live under `<root>/logs/`.
