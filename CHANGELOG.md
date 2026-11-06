# Changelog

All notable changes to IndexArc are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Commit messages follow the convention in
[docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md#commit-convention).

## [Unreleased]

### Added
- Applications page: keep each application's secrets together, split by environment (Production,
  Staging, Development or your own). Values stay masked with a copy button on every key; paste a
  whole `.env` file (with a preview of what is new or updated), copy an environment back as
  `.env`, move existing secrets in, and keep notes per application. Saving from the Scratchpad
  asks which application and environment the detected secrets belong to, and updates a key that is
  already there instead of adding a duplicate. The CLI takes `--app NAME [--env ENV]`, and
  encrypted exports keep both fields.
- Applications and the Scratchpad work together. Each application has Keys, Notes and Commands.
  Its notes are real Scratchpad notes, so they hold anything (steps, commands, explanations, keys):
  copy a whole note, open it in the Scratchpad, or start a new one from the application. Commands
  are saved with a name and copied with one click. In the Scratchpad, each note shows its
  application; the application selector at the start of the note tabs shows only that
  application's notes (and new notes join it); and "Save to {app}" saves the note's keys (pick the environment) and commands into it, skipping ones already there. The old
  single notes box becomes the application's "Overview" note, and renaming an application moves
  its notes too.
- Scratchpad: a "Copy all" button and a copy icon in the editor corner copy the whole note.
- The `indexarc` command-line tool is now a standalone program (no Node install needed), and the
  Windows installer adds it to your PATH; uninstalling removes it.
- CI checks performance at 10k entries on every push (`npm run bench`): p95 save under 50 ms and
  p95 Ask under 300 ms, with the timings in the job summary.
- Master password strength meter and a show/hide button on every password field.
- IndexArc is now open source under the GNU GPL v3 (`LICENSE`). The README states the code-signing
  policy and what the app sends over the network (only what the user turns on).
- Windows release builds can be signed through Azure Trusted Signing (publisher: your verified name;
  signs the app, DLLs, installer, uninstaller and portable exe) or SignPath Foundation's free
  open-source program. Each activates once its account is set up (`docs/CODE_SIGNING.md`).
- `indexarc` command-line tool: `get`, `env` and `run -- cmd` read secrets from the running,
  unlocked app. Tokens are created in Settings → CLI access and can only read secrets.
- Import from `.env`, Bitwarden JSON, 1Password or generic CSV, KeePass XML and IndexArc exports,
  with a review step. Export to an encrypted `.iaexport` file or, after a warning, a plain `.env`.
- Secret expiry dates, rotation reminders, "mark rotated", and "where used" (searches watched
  folders); a Home card lists what is expired, expiring or due.
- Change the master password. Optional recovery key: a one-time code that can reset a forgotten
  password from the lock screen.
- App health → "Download report": a redacted diagnostics file. Optional local crash log.
- Check for updates from GitHub Releases (manual, or at startup if turned on). Only builds that can
  verify the update signature install it; others link to the release page.

### Changed
- Scratchpad toolbar is one tidy row: the note's application, save, Copy all and Detect stay visible;
  Proofread, Rephrase (with its style), Format paragraphs and Predictions are under "AI", and
  History, Compare, Rescue and Clear are under "⋯".
- Storage: entries and search vectors move from JSON files into an SQLite database. Each row is
  encrypted separately and bound to its table and id. Existing vaults migrate on unlock after an
  automatic snapshot.
- Large vaults: the Library list is virtualized, and App health no longer parses whole snapshot
  files, so a 3,000-entry Library opens in about 2 s (was about 21 s).
- Dialogs are keyboard- and screen-reader-accessible; about 255 remaining English-only strings are
  translated.

### Fixed
- Terminal windows no longer flash up while the app runs: starting Ollama, the spelling server
  and the Ollama installer now run with their console windows hidden. A test fails if any new
  background process is started without that.
- Right-click menus open at the cursor and stay inside the window.
- Clipboard auto-clear never ran (Electron's `readText()` is asynchronous).
- A dev or test launch could repoint the installed app's data folder.

### Security
- New `docs/KEY-LIFECYCLE.md`: every key and secret, how it is created, stored, rotated and
  destroyed.
- Electron: no window can attach a `<webview>`, open a new window or leave the app, and the quit
  handshake now checks who sent it, like every other IPC message.
- CodeQL static analysis runs in CI on every push, pull request and weekly.
- Every API request body is checked against a schema before it is handled; a malformed body is
  refused with a 400 that names the field (never the value).
- Rolling back, removing or copying in a single record in `vault.db` is now detected on unlock
  (keyed checksum over the sealed rows) and shown as an integrity warning.
- Every encrypted vault file (header, vectors, notes, archive, revisions, scan sessions) is bound to
  its role, so one file copied over another is refused. Existing vaults are upgraded on unlock.
- New master passwords must be at least 12 characters, not a common password (checked offline)
  and not trivially guessable. Existing shorter passwords still unlock.
- Every API response is marked `Cache-Control: no-store`.
- Decryption requires the full 16-byte GCM tag.

## [2.1.0] - 2026-11-04

### Added
- New Home dashboard: a greeting with vault status, four clickable tiles (entries, secrets,
  commands, needs review) with 14-day trend lines and weekly counts, a vault health score with
  the top checks, a breakdown of what the vault holds, background service status (AI engine and
  folder watcher), and a compact "Recently saved" list with masked previews and one-click copy.
- Sidebar security card: encryption state, the auto-lock setting and a "Lock now" button
  (replaces the sidebar stats box, which Home now covers).
- Arabic translations for every new label.

### Changed
- Visual refresh: ambient background glow, softer borders, glass cards with a gradient edge and
  hover glow, a gradient primary button, a gradient wordmark, a lit active-tab bar, thin
  scrollbars, a consistent focus ring and a short fade-in on tab switch (off with reduced motion).
- Light theme: pastel background, dimmed starfield.
- Health and setup banners collapse to one line outside Home; the phone menu drawer works and
  closes after picking a tab; saving Settings confirms immediately.
- Internal: `App.tsx`, `SettingsTab.tsx` and `ScratchpadTab.tsx` are split into focused
  components and hooks; AI providers sit behind one adapter interface.

### Security
- A locked vault refuses to restore snapshots that contain plaintext data (HTTP 423).
- Auto-lock counts only real user input; background `GET` polls no longer keep the vault unlocked.
- Every lock path purges decrypted secrets from renderer state.
- An unreadable settings wrap key is never silently regenerated; wrapped API keys are kept.
- The fixed confirmation word no longer resets the password throttle.
- Removed two quadratic regular expressions from the extraction heuristics (ReDoS).
- Spellcheck is off on paste fields, legacy `localStorage` notes are removed, secrets copied to the
  clipboard are auto-cleared, and child processes get a scrubbed environment.
- `npm audit fix`: no high or critical advisories remain.

### Fixed
- PDF extraction uses the pdf-parse v2 class API, an `import.meta.url` shim and a bundled worker.
- Ask answers are generated by the provider the prompt was built for.

### Changed
- README and SECURITY.md corrected; `docs/INDUSTRIAL_ROADMAP.md` supersedes `docs/EXECUTION_PLAN.md`.

### Build / CI
- CI workflows run with `permissions: contents: read`, third-party actions are pinned to commit SHAs,
  and installs use `npm ci` only.
- Dependabot watches npm and GitHub Actions weekly (minor/patch updates grouped).
- Desktop builds produce a CycloneDX SBOM (`sbom.cdx.json`) as a workflow artifact.
- Diagnostic scripts no longer contain hard-coded per-user paths.
- Only runtime-needed packages ship: `app.asar` 183 MB → 7 MB (432 → 101 packages);
  unused `@typesafe-ai/sdk` removed.
- Electron fuses enabled (no RunAsNode / `NODE_OPTIONS` / `--inspect`; asar integrity validation;
  load app only from asar).
- Packaged builds verify the unpacked `dist/` against a sha256 manifest packed in `app.asar`
  before loading the server, and refuse to start on mismatch.
- `preload.cjs` is type-checked in `npm run lint` (`tsconfig.electron.json`).

## [2.0.0]

Baseline for this changelog. See the git history for earlier changes.
