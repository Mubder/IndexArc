# IndexArc — API Reference

All endpoints are served by the Express backend (`server.ts`) at `http://127.0.0.1:<PORT>` (default `3000`). The server binds to **localhost only**.

- [Conventions](#conventions)
- [Vault lock behavior](#vault-lock-behavior)
- [System & misc](#system--misc)
- [Vault lock / password (security)](#vault-lock--password-security)
- [Entries](#entries)
- [Folder scan & watch](#folder-scan--watch)
- [Filesystem browser](#filesystem-browser)
- [AI: analyze / ask / rewrite](#ai-analyze--ask--rewrite)
- [Ollama helpers](#ollama-helpers)
- [Legacy alias](#legacy-alias)
- [Core object shapes](#core-object-shapes)

---

## Conventions

- All request bodies are **JSON** (`express.json({ limit: "2mb" })`).
- All responses are JSON unless noted.
- **There are no file-upload endpoints** — no `multipart`/`multer`. Folder ingestion reads files directly on the server host (see [Folder scan](#folder-scan--watch) and [Filesystem browser](#filesystem-browser)).
- Unmatched `/api/*` routes return `404 { error }`. In production, non-API routes serve `index.html`.

---

## Vault lock behavior

The `checkVaultUnlocked` middleware returns **`423 { error: "Vault is locked", is_locked: true }`** when encryption is enabled and the vault is locked. It is applied to these prefixes:

- `/api/entries`
- `/api/analyze`
- `/api/folders`
- `/api/ask`
- `/api/snippets`

Everything else is reachable without unlocking (including `/api/vault/*`, `/api/status`, `/api/settings`, `/api/fs/*`, `/api/ollama/*`, `/api/rewrite`, `/api/backups`, `/api/logs`).

---

## System & misc

| Method | Path | Description | Request | Response | Lock req. |
|--------|------|-------------|---------|----------|:--------:|
| GET | `/favicon.ico` | Serves app logo as favicon | — | PNG (binary) | No |
| GET | `/api/ping` | Health check | — | `{ status: "ok" }` | No |
| GET | `/api/backups` | List timestamped vault backups | — | `{ backups: [{ name, size, created_at }], dir }` | No |
| GET | `/api/logs` | In-memory app logs | — | `LogEntry[]` | No |
| GET | `/api/status` | Full system status | — | `SystemStatus` (see below) | No |
| GET | `/api/settings` | Current settings (keys echoed) | — | `AppSettings` | No |
| POST | `/api/settings` | Update allowed settings keys | any of the `AppSettings` keys | updated `AppSettings`; `400 { error }` if `ai_provider` invalid | No |

**`SystemStatus`**:
```jsonc
{
  "portable_root": "string",
  "ai_provider": "auto|local|api|openai|groq|openrouter|anthropic|local_openai",
  "active_provider": "local|api|...|heuristic",
  "is_ollama_online": true,
  "ollama_models": ["..."],
  "is_gemini_configured": false,
  "stats": {
    "total_saved": 0, "needs_attention": 0,
    "total_commands": 0, "total_notes": 0, "total_secrets": 0
  }
}
```

**Accepted `POST /api/settings` keys:** `ai_provider`, `ollama_base_url`, `ollama_llm_model`, `ollama_embed_model`, `gemini_api_key`, `gemini_llm_model`, `gemini_embed_model`, `openai_api_key`, `openai_llm_model`, `groq_api_key`, `groq_llm_model`, `openrouter_api_key`, `openrouter_llm_model`, `anthropic_api_key`, `anthropic_llm_model`, `local_openai_base_url`, `local_openai_api_key`, `local_openai_llm_model`, `ui_language`. Only defined keys are applied.

---

## Vault lock / password (security)

| Method | Path | Description | Request | Response | Lock req. |
|--------|------|-------------|---------|----------|:--------:|
| GET | `/api/vault/status` | Lock + encryption state | — | `{ is_locked, encryption_enabled }` | No |
| POST | `/api/vault/unlock` | Unlock with master password | `{ password }` | `{ success: true }`; `400` if empty; `401 { error }` (500ms delay) on wrong password | No |
| POST | `/api/vault/lock` | Lock (clear in-memory key) | — | `{ success: true }` | No |
| POST | `/api/vault/setup-password` | Enable encryption | `{ password }` (min 4 chars) | `{ success: true }`; `400 { error }` if too short or already encrypted | No |
| POST | `/api/vault/remove-password` | Decrypt back to plaintext | `{ password }` | `{ success: true }`; `400` if empty; `401` (500ms delay) on wrong password | No |

---

## Entries

All under the `/api/entries` lock middleware — **require unlock**.

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| POST | `/api/entries/save` | Save one or many candidates | `{ paste_id?, candidates?/items?: Candidate[] }` or single `{ value, type, name, ... }` | batch: `{ entries: VaultEntry[] }`; single: `{ entry: VaultEntry }`; `400` if value missing |
| POST | `/api/entries/park` | Save items as incomplete | `{ paste_id?, candidates: Candidate[] }` (or single) | `{ entries: VaultEntry[] }` |
| GET | `/api/entries` | List entries | query `status?`, `family?` (`status=attention` → needs-attention) | `VaultEntry[]` |
| GET | `/api/entries/:id` | Get a single entry | `:id` | `VaultEntry`; `404 { error }` |
| PATCH | `/api/entries/:id` | Clarify/update an entry | `{ type?, name?, notes?, labels? }` | updated `VaultEntry`; `404` |
| DELETE | `/api/entries/:id` | Delete an entry (+ its vectors) | `:id` | `{ success: true }`; `404` |
| POST | `/api/entries/bulk-delete` | Delete many | `{ ids: string[] }` | `{ success: true, removed }` |
| POST | `/api/entries/check-duplicate` | Check for existing value / similar name | `{ value, name? }` | `{ is_duplicate: false }` or `{ is_duplicate: true, existing_entry, match_type: "exact_value"\|"similar_name" }`; `400` if value empty |

A **candidate** for save/park: `{ value, type, name, raw_fragment?, labels?, type_aliases?, family?, notes?, source_file? }`.

---

## Folder scan & watch

All under the `/api/folders` lock middleware — **require unlock** (except `/api/fs/*`).

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/folders` | Watched folders + active session | — | `{ folders: WatchedFolder[] (with live), active_session_id: string\|null }` |
| GET | `/api/folders/sessions` | All scan review sessions | — | `FolderScanSession[]` |
| GET | `/api/folders/sessions/active` | Open review session | — | `FolderScanSession`; `404` if none |
| GET | `/api/folders/sessions/:id` | One session | `:id` | `FolderScanSession`; `404` |
| POST | `/api/folders/scan` | Scan a folder on the host FS | `{ path, use_ai?, watch? (default true) }` | `FolderScanSession`; `400` if path empty/invalid |
| PATCH | `/api/folders/sessions/:id/candidates` | Update candidate decisions/fields | `{ candidates: [{ temp_id, type?, name?, family?, decision?, labels? }] }` (or single) | updated `FolderScanSession`; `404`/`400` |
| POST | `/api/folders/sessions/:id/commit` | Commit save/park/discard | `{ mode?: "selected"\|"all_ready"\|"all_pending"\|"apply" }` | `{ saved: VaultEntry[], parked: VaultEntry[], discarded, session_id }`; `404`/`400` |
| POST | `/api/folders/sessions/:id/apply` | Apply decisions (ready→save else park) | `:id` | `{ saved_count, parked_count, discarded_count, saved, parked }`; `404`/`400` |
| POST | `/api/folders/sessions/:id/discard` | Mark session discarded | `:id` | `{ success: true }`; `404` |
| POST | `/api/folders/:id/unwatch` | Stop watching (keep record) | `:id` | `{ success: true }` |
| DELETE | `/api/folders/:id` | Remove watched folder | `:id` | `{ success: true }`; `404` |

---

## Filesystem browser

Server-side directory browser (no upload, **no lock required**).

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/fs/roots` | List FS roots (drives / `/` + home) | — | `{ roots: [{ path, label }] }`; `500 { error }` |
| GET | `/api/fs/list` | List subdirectories (folders only) | query `path?` (empty → roots) | `{ path, parent: string\|null, entries: [{ name, path, isDirectory: true }] }`; `400`/`500` |

---

## AI: analyze / ask / rewrite

| Method | Path | Description | Request | Response | Lock req. |
|--------|------|-------------|---------|----------|:--------:|
| POST | `/api/analyze` | Multi-extract candidates (no save) | `{ content \| paste }` | `{ paste_id, raw_paste, candidates: AnalyzeCandidate[], provider_used }`; `400`/`500` | **Yes** |
| POST | `/api/ask` | Hybrid search + optional answer | `{ query, limit? (default 12) }` | `{ results: [{ entry, score, match_reason }], answer?, provider_used, mode: "hybrid" }`; `400`/`500` | **Yes** |
| POST | `/api/rewrite` | Rewrite text in a chosen tone | `{ text, style? }` (`human\|professional\|technical\|concise\|formal\|casual`, default `professional`) | `{ original, rewritten, style, provider_used }`; `400`; `503` if no provider; `500` | No |

---

## Ollama helpers

| Method | Path | Description | Request | Response |
|--------|------|-------------|---------|----------|
| GET | `/api/ollama/models` | Ollama status + models | — | `{ online, models, base_url, error? }` |
| POST | `/api/ollama/ensure` | Pull + load required models into VRAM | — | `{ status: "success", models, llm_loaded, embed_loaded }`; `503` if not running |
| POST | `/api/ollama/warm` | Warm LLM + embedder into VRAM | — | `{ status, model, embed_model, embed_loaded }`; `503` if offline |

---

## Legacy alias

| Method | Path | Description | Response | Lock req. |
|--------|------|-------------|----------|:--------:|
| GET | `/api/snippets` | Legacy: entries as snippet objects | `[{ id, type, title, content, user_note, created_at }]` | **Yes** |

---

## Core object shapes

**`VaultEntry`**
```jsonc
{
  "id": "uuid",
  "value": "string",
  "type": "string",              // freeform, e.g. "telegram user id"
  "name": "string",             // required for secrets
  "raw_fragment": "string",
  "paste_id": "string?",
  "labels": ["string"],
  "type_aliases": ["string"],
  "status": "saved|needs_name|needs_type|needs_review",
  "family": "secret|command|note|unknown",
  "created_at": "iso", "updated_at": "iso",
  "notes": "string?",
  "source_file": "string?"
}
```

**`AnalyzeCandidate`**
```jsonc
{
  "temp_id": "string",
  "value": "string", "type": "string", "name": "string",
  "raw_fragment": "string",
  "labels": ["string"], "type_aliases": ["string"],
  "family": "secret|command|note|unknown",
  "confidence": 0.0,
  "needs_type": false, "needs_name": false, "ready": true,
  "model_notes": "string?",
  "source_file": "string?", "source_name": "string?",
  "decision": "save|park|discard?"
}
```

**`FolderScanSession`**
```jsonc
{
  "id": "string", "folder_path": "string",
  "created_at": "iso", "updated_at": "iso",
  "status": "review|committed|discarded",
  "watching": true,
  "summary": { /* FolderScanSummary */ },
  "processed_files": [ /* ProcessedFile */ ],
  "skipped_files": [ /* SkippedFile */ ],
  "candidates": [ /* AnalyzeCandidate */ ],
  "brief": "string"
}
```

**`WatchedFolder`**: `{ id, path, watching, last_scan_id?, last_scan_at?, created_at }`.

See [Architecture → Data types](./ARCHITECTURE.md#data-types) for the full type model.
