# Scratchpad Overhaul & Note Protection — Design Plan

**Status:** Proposal · **Date:** 2026-09-04 · Companion to [`AUDIT_REPORT.md`](./AUDIT_REPORT.md)

This plan covers three things: (1) how to fix and restructure the Scratchpad, (2) a Pin / Protect / Lock feature for notes, and (3) the roadmap to industry-level vault quality.

---

## Part 1 — Scratchpad: what's wrong and how to improve it

### 1.1 Root causes behind nearly every Scratchpad bug

The current component (`src/components/ScratchpadTab.tsx`, 3,329 lines) keeps **five persistence layers** for the same notes — localStorage, idb-keyval, y-indexeddb, note revisions, and the server's `scratchpad.json` — with no defined source of truth. Every data-loss and desync bug found in the audit (lost edits on tab switch, server-clobbers-local, fake Yjs "Synced" badge, unencrypted plaintext at rest) is a symptom of this.

`ScratchTab` today is just `{ id, title, content }` (`src/types.ts:158-164`) — no timestamps, no revision counter, no protection flags. The server save API (`POST /api/scratchpad`, `server/routes/misc.ts`) **replaces the entire tabs array** with whatever the client sends, so the server cannot defend anything.

### 1.2 Target architecture: one source of truth

**Rule: the server (`data/scratchpad.json`) is the only durable store. The browser is a cache, nothing more.**

1. **Delete localStorage and idb-keyval persistence entirely.** They are redundant, they diverge, and they are the plaintext-at-rest problem (audit H-5). The server file is atomic-written and backed up (`.prev` + emergency snapshots) already.
2. **Kill the fake Yjs layer.** Either remove `yjs`/`y-indexeddb`/`y-prosemirror` + the "Synced" badge (recommended — collaboration is not a product goal), or implement real syncing. Decorative persistence that lies about durability is worse than none.
3. **Fix autosave semantics:** debounce stays (~800 ms), but the effect cleanup must **flush** the pending save on unmount/tab-switch (`flushSync` the fetch or use `navigator.sendBeacon`), instead of cancelling it (audit finding: last 1.2 s of edits lost).
4. **Optimistic concurrency:** add `rev: number` to each tab, incremented server-side on every save. Client sends its base `rev`; server returns `409 { server_tab }` on mismatch and the UI offers "reload / overwrite". This eliminates the whole class of silent-clobber bugs structurally rather than by careful timing.
5. **Server becomes defensive:** `saveScratchpad` validates tab shape (id/title/content strings, content ≤ N MB), never deletes tabs it didn't receive (merge by id instead of array replace), and enforces note protection (Part 2).

### 1.3 Split the monolith

Extraction seams (verified to exist in the current code):

| Extract | From | Contents |
|---|---|---|
| `lib/noteHtml.ts` | `ScratchpadTab.tsx:130-202` | `ensureHtmlParagraphs`, `smartFormatParagraphs`, `htmlToPlainText` |
| `lib/textTokens.ts` | `:311-451` | tokenization + `detectBaseDir` (currently duplicated in `spellcheck.worker.ts:5-39`) |
| `hooks/useScratchpadTabs.ts` | `:209-247`, `:1197-1278` | tab list state, server sync, revision counting — the dual-write fix lives here |
| `hooks/useNoteHistory.ts` | `:845-942` | undo/redo — or delete it (see below) |
| `hooks/useSpellcheck.ts` | `:560-620`, `:1099-1290`, `:1353-1429` | worker + HTTP + context menu + underline overlay |
| `hooks/useGhostText.ts` | `:1450-1489`, `:1609-1618` | autocomplete: debounce 500 ms, abort previous fetch, min trigger length |
| `components/NoteToolbar.tsx` | `:2662-2923` | formatting toolbar |
| `components/ArchivePanel.tsx` + `RevisionsModal.tsx` | `:2938-3290` | cold storage + revision history |
| `components/SpellContextMenu.tsx`, `SlashMenu.tsx`, `GhostBadge.tsx` | `:2435-2590` | small popups |

Delete outright: the `execCommand` fallback (`:973-997`, unreachable), the legacy `onPaste` (`:1621-1643`), the custom history stack **or** the `undoRedo: false` flag (audit H-6 — re-enabling TipTap's built-in undo/redo and deleting the custom stack is the cheaper, correct option).

### 1.4 Editing correctness (in order of user pain)

1. **Undo/redo:** remove `undoRedo: false` from StarterKit config (`:721`), delete the custom stack, remove the `tiptap` early-returns in `historyUndo`/`historyRedo`. Snapshot-before-dangerous-action (Format, AI rewrite, proofread) stays — keep revision snapshots as a separate, explicit "Versions" feature.
2. **Stop raw DOM writes into ProseMirror** (8 sites — audit). All mutations go through `editor.commands.setContent(...)` / `insertContentAt(...)`. One source of truth for HTML: `editor.getHTML()`; never `editorRef.current.innerHTML`.
3. **Sanitize everything rendered** (audit H-4): add `dompurify`, wrap all three `dangerouslySetInnerHTML` sinks, and sanitize AI output *before* `setContent` (current code pastes model HTML straight into notes and renders literal `<br>` text — `:1971`, `:2006` — fix the newline handling with a proper paragraph transform).
4. **Fix or remove "Paste plain":** wire the toggle into TipTap's `editorProps.handlePaste` (strip to text and insert as plain text when on). Currently attached to nothing.
5. **Spellcheck:** cap `_suggestCache` (`shared/languagetool.cjs:19`) and stop the permanent public-API fallthrough (stay local, or ask). Route all checking through the worker (already exists) instead of splitting between worker + HTTP + main-process IPC.

### 1.5 Feature polish that makes it feel finished

- Word/char count + reading time in the status bar (data is already in `contentRef`).
- Find & Replace within the note (Ctrl+F) — TipTap has no built-in; a small decoration-based implementation is ~100 lines.
- Per-note search and sort (title / updated / created) in the tab strip overflow menu.
- Export note as `.md` / `.html` / `.txt`; import a file as a new note.
- Note tags (freeform labels, reused later for Ask scoring) — cheap now, pays off in search.
- Markdown paste conversion: when pasting markdown, convert to TipTap nodes (currently rich HTML goes in raw).
- All new strings go through i18n (en/ar) — the audit found dozens of hardcoded English strings; don't add more.

---

## Part 2 — Pin / Protect / Lock for notes

Goal: *the most important notes cannot be edited, renamed, deleted, archived, or lost — even by a bug, a bad autosave, or a stray click.* Three tiers, independent flags:

### 2.1 Data model (server is authoritative)

```ts
// src/types.ts + server/types.ts — ScratchTab v2 (migrated on read, defaults for old tabs)
interface ScratchTab {
  id: string;
  title: string;
  content: string;
  rev?: number;              // Part 1.2 optimistic concurrency
  created_at?: string;       // ISO
  updated_at?: string;       // ISO
  pinned?: boolean;          // Tier 1: sorts first
  pinned_at?: number;
  protected?: boolean;       // Tier 2: read-only + undeletable, server-enforced
  protected_at?: number;
  locked?: boolean;          // Tier 3 (later): content stored encrypted, needs vault unlock
}
```

- Migration mirrors the existing `archived` migration in `store.getScratchpad()`: absent flags = false; bump `{ version: 2 }` in the file envelope.

### 2.2 Enforcement — server-side, not just UI

The current `POST /api/scratchpad` replaces the whole array, so protection **must** live in `store.ts`. Rules for `saveScratchpad(tabs, opts)`:

1. Load current server state first. For every incoming tab whose server copy has `protected: true`: if `content` or `title` differ → **reject with `409 { violations: [ids] }`** unless `opts.override_protected === true` (set only by the dedicated unprotect endpoint flow).
2. **Protected tabs cannot disappear:** if the incoming array omits a protected tab, reject the save the same way. This makes deletion-by-omission impossible — including from a buggy autosave, which is exactly the class of bug the audit found.
3. `archiveScratchpadTab` / `deleteArchivedScratchpadTab` return `{ success: false, reason: "protected" }` for protected tabs.
4. Snapshot semantics: a protected tab still gets revision snapshots (protection must not disable the safety net), and every *successful* override-edit captures a "Before override" revision automatically.

New granular endpoints (the client should stop using whole-array saves for everything except pure ordering):

| Endpoint | Behavior |
|---|---|
| `POST /api/scratchpad/tabs/:id/pin` `{ pinned }` | set/clear pin, sets `pinned_at` |
| `POST /api/scratchpad/tabs/:id/protect` `{ protected }` | ON: free. OFF: requires `{ confirm_title }` matching the tab title exactly (type-to-confirm), clears flag |
| `POST /api/scratchpad/tabs/:id/content` `{ content, base_rev }` | single-tab content save with 409-on-conflict |
| `DELETE /api/scratchpad/tabs/:id` | explicit delete; 423 Locked if `protected` |

### 2.3 UI

- **Tab strip:** pinned tabs sort first (by `pinned_at` desc), show a 📌; protected tabs show a 🔒 and a "Protected" badge; both indicators also in the note header.
- **Context menu / ⋯ menu on each tab:** *Pin/Unpin*, *Protect note…*, *Export*, *Archive* (hidden for protected), *Delete* (disabled with tooltip for protected).
- **Protect flow:** confirm modal explaining exactly what protection blocks (edit, rename, delete, archive, AI rewrite/proofread targeting this note) with a shield icon; **Unprotect flow:** type-to-confirm the note title — deliberate friction, consistent with the app's "secrets deserve ceremony" philosophy.
- **Editor:** when active tab is protected → `editor.setEditable(false)` + subtle lock watermark/border; toolbar buttons disabled; ghost-text autocomplete off (no silent mutation vectors); the AI rewrite/proofread buttons hidden.
- **Revisions panel for protected notes stays viewable/restoreable** — restoring a revision to a protected note goes through the same override flow (confirm).
- All strings i18n'd; RTL-correct icons.

### 2.4 Edge cases handled by design

- Old clients / stale renders that still send whole-array saves: rule 2 means they can't hurt protected notes — the save 409s and the UI reloads server state.
- Emergency restore: snapshots already capture scratchpad (with flags — they're plain JSON fields).
- Vault entries (`VaultEntry`) can adopt the same `pinned`/`protected` fields later for the Library — same store-level enforcement pattern in `createEntry`/`updateEntry`/`bulkDelete`.

### 2.5 Tier 3 — Lock (roadmap)

`locked: true` notes are stored with `content_encrypted` (AES-256-GCM with the vault key — same crypto module) and render as a sealed card when the vault is locked; opening requires unlock. This is the natural extension once scratchpad storage is server-authoritative, and it closes audit H-5 for the notes users care about most.

---

## Part 3 — Roadmap to industry-level vault

### 3.1 Security core (beyond bug fixes)

1. **API pairing token + Host allowlist** (audit CRITICAL fix #1) — the single highest-value change in the codebase.
2. **Secrets in the OS keychain:** cloud API keys → Electron `safeStorage` (DPAPI on Windows); fall back to vault-key encryption. `settings.json` stops holding usable plaintext.
3. **Stronger KDF:** PBKDF2-SHA256 → 600k iterations minimum, or `crypto.scrypt` (N=2^15) — builtin, no new dependency. Re-derive-and-rewrap on next unlock (transparent upgrade path: store KDF params in the vault envelope).
4. **Auto-lock:** idle timeout (default 5 min, configurable) + lock-on-minimize; optionally clear clipboard N seconds after a copy of a secret (clipboard hygiene is standard in password managers: Bitwarden/KeePass do 30–120 s).
5. **Integrity manifest:** HMAC-SHA256 over each data file's bytes, stored in a manifest signed with a device key — detects tampering and the silent-corruption case before it auto-wipes (audit H-8 becomes "detected + quarantined + recoverable").
6. **Quarantine, never overwrite:** unparseable data files are renamed `*.corrupt-<stamp>` and the UI shows a recovery banner; combined with the manifest this turns the worst failure mode into a recoverable event.
7. **Log redaction middleware:** `addLog` auto-scrubs anything matching the heuristics' own secret regexes before storage — dogfooding the analyzer.

### 3.2 Supply chain & release engineering

1. **Code signing** (Authenticode) — unsigned Windows exes trigger SmartScreen and undermine a security product's credibility. EV cert if budget allows.
2. **Auto-update via electron-updater** with signature verification — currently updates = manual re-download, which means users run old, vulnerable versions.
3. **CI (GitHub Actions):** lint + tests + `npm audit --audit-level=high` gate + build on every PR; Dependabot/Renovate for the lockfile; SBOM (CycloneDX) attached to releases.
4. **Renderer hardening:** `sandbox: true`, CSP meta (`default-src 'self'; script-src 'self'`), remove the devtools-in-prod legacy paths.

### 3.3 Product trust

1. **Test pyramid:** supertest integration suite over the Express API (every endpoint, including the lock matrix), unit tests for heuristics classifiers + Ask scoring, one Playwright-Electron smoke test (launch → paste → save → restart → verify). Target: the audit's "untested core" list.
2. **`strict: true` TypeScript** — enable file-by-file with `// @ts-expect-error` burn-down; the `any`-typed store APIs are where the data-loss bugs hide.
3. **Full i18n + RTL audit** — finish the string extraction the audit catalogued; Arabic is a first-class feature, not a partial overlay.
4. **Local diagnostics export** (zero-telemetry): a redacted support bundle (versions, logs with secrets scrubbed, file checksums) users can attach to bug reports.
5. **Documentation truth pass:** SECURITY.md and README must match the implementation (KDF, key exposure) — the audit found both diverge.

### 3.4 Suggested sequencing

| Phase | Theme | Items |
|---|---|---|
| 1 (now) | Stop the bleeding | Pairing token + Host allowlist; API-key masking; confirm-cancel crash; undo/redo; autosave flush; DOMPurify + CSP |
| 2 | Data safety | Scratchpad single-source-of-truth refactor + `rev` concurrency; quarantine + integrity manifest; safeStorage for settings |
| 3 | The feature | Pin/Protect (this doc, Part 2) → Lock tier |
| 4 | Industry-grade | KDF upgrade, auto-lock + clipboard hygiene, CI + signing + updates, test pyramid, strict TS |
