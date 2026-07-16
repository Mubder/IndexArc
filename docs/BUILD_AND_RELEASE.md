# IndexArc — Build & Release

How to produce distributable builds, how packaging works, and — critically — how user data survives updates and reinstalls.

- [Prerequisites](#prerequisites)
- [Build scripts](#build-scripts)
- [How packaging works](#how-packaging-works)
- [Windows builds](#windows-builds)
- [macOS builds](#macos-builds)
- [Linux builds](#linux-builds)
- [electron-builder configuration](#electron-builder-configuration)
- [The NSIS installer](#the-nsis-installer)
- [Code signing](#code-signing)
- [Data safety on update / reinstall](#data-safety-on-update--reinstall)
- [Release checklist](#release-checklist)
- [Troubleshooting builds](#troubleshooting-builds)

---

## Prerequisites

| Target | Requirements |
|--------|--------------|
| All | Node.js 18+, `npm install` |
| Windows | Windows 10/11 x64 (for signing: `signtool.exe` + a certificate) |
| macOS | A Mac (or CI) for `.dmg`/`.zip`; Apple cert for notarization |
| Linux | A Linux host (or CI) for AppImage/tar.gz |

---

## Build scripts

| Script | Output |
|--------|--------|
| `npm run build` | UI → `dist/`, server → `dist/server.cjs` |
| `npm run desktop` | Dev Electron shell (after build) — uses isolated `.desktop-sandbox/` data |
| `npm run desktop:win` | Windows **portable .exe + NSIS installer** (x64) |
| `npm run desktop:pack` | Unpacked Windows folder only (`dist-desktop/win-unpacked/`) |
| `npm run desktop:mac` | macOS `.dmg` + `.zip` (x64 + arm64) |
| `npm run desktop:linux` | Linux AppImage + tar.gz (x64) |
| `npm run desktop:dist` | Alias → `desktop:win` |
| `npm run clean` | Remove `dist/` and `dist-desktop/` |

All artifacts land in `dist-desktop/`.

---

## How packaging works

1. **`vite build`** compiles the React UI into static assets in `dist/`.
2. **esbuild** bundles `server.ts` into a single **`dist/server.cjs`** (`--platform=node --format=cjs`, externalizing `vite` and `electron`). This means the packaged app needs **no `node_modules` at runtime**.
3. **electron-builder** wraps Electron + `dist/` + `electron-main.cjs` + `preload.cjs` + `public/` into platform installers.

At runtime, Electron sets: `INDEXARC_ROOT` (portable data root), `INDEXARC_DIST_DIR` (packaged assets), `NODE_ENV=production`, and forks the server which binds `127.0.0.1` only.

> **`asar` is disabled** (`asar: false`) in the build config, so app files live under `resources/app/` unpacked.

---

## Windows builds

```bash
npm run desktop:win
```

Produces (signed):

| File | Description |
|------|-------------|
| `dist-desktop/IndexArc-Portable-2.0.0.exe` | Single portable executable (no install). Extracts to a temp dir at runtime. |
| `dist-desktop/IndexArc-Setup-2.0.0.exe` | NSIS installer with Start Menu / desktop shortcuts. |

Unpacked (for debugging):

```bash
npm run desktop:pack   # → dist-desktop/win-unpacked/IndexArc.exe
```

> **Portable note:** the portable exe unpacks to a random `%TEMP%` folder, so its `process.execPath` isn't a stable data location. It relies on the **persisted registry root** to find your vault (see [Data safety](#data-safety-on-update--reinstall)).

---

## macOS builds

```bash
npm run desktop:mac
```

Outputs under `dist-desktop/`: `IndexArc-2.0.0-mac-x64.dmg` / `…-arm64.dmg` plus zip archives. Apple signing/notarization is **not configured** yet — add certificates under `build.mac` for distribution outside your own Mac.

---

## Linux builds

```bash
npm run desktop:linux
```

Outputs: `IndexArc-2.0.0-linux-x64.AppImage` and `IndexArc-2.0.0-linux-x64.tar.gz`.

---

## electron-builder configuration

Defined in `package.json` under `"build"`. Key points:

- `appId`: `com.indexarc.vault`; `productName`: `IndexArc`; `icon`: `assets/icon.png`.
- `directories.output`: `dist-desktop`, `buildResources`: `assets`.
- `asar: false`.
- **`files`** — includes `dist/**/*`, `public/**/*`, `electron-main.cjs`, `preload.cjs`, `package.json`, and **excludes all user data**:

  ```
  !data{,/**/*}   !config{,/**/*}   !logs{,/**/*}
  !tmp{,/**/*}    !backups{,/**/*}  !.desktop-sandbox{,/**/*}
  !**/*vault*.json   !**/*vector*.json
  !**/scan_sessions.json   !**/watched_folders.json   !**/settings.json
  !**/.env   !**/.env.*
  ```

  This guarantees no secrets are ever baked into an installer.

- **Windows targets:** `portable` + `nsis` (x64). **macOS:** `dmg` + `zip` (x64/arm64). **Linux:** `AppImage` + `tar.gz` (x64).

---

## The NSIS installer

Configured under `build.nsis`, customized by `build/installer.nsh`:

- `oneClick: false`, `perMachine: false` (per-user, no admin), `allowToChangeInstallationDirectory: true`, desktop + Start Menu shortcuts.
- **`preInit`** reuses the previously saved install location: it reads `HKCU\Software\IndexArc\InstallLocation`; if present, the update targets the **same folder**; otherwise it defaults to `%PROFILE%\.IndexArc`.
- **`customInstall`** writes `InstallLocation = $INSTDIR` so future updates reuse it.
- **`customUnInstall`** leaves `data/`, `config/`, `logs/`, `backups/` behind — the uninstaller removes program files only.

The net effect: **updating or reinstalling never changes where your vault lives, and never deletes it.**

---

## Code signing

Windows artifacts are signed with `signtool.exe` during the build (the exe, the portable, the uninstaller, and helper binaries). Ensure a valid code-signing certificate is available to `signtool` in your environment. macOS notarization is not yet configured.

---

## Data safety on update / reinstall

This is a deliberate, defense-in-depth design so users never lose their vault. See [Architecture → Data-safety design](./ARCHITECTURE.md#data-safety-design) for the full picture; the packaging-relevant pieces:

1. **Persisted vault root** — on every launch the app saves its data root to `HKCU\Software\IndexArc\Root` and `%APPDATA%\IndexArc\vault-root.json`, and restores it on the next launch. Neither location is touched by installers, so the root is stable across updates.
2. **Installer reuses `InstallLocation`** — the NSIS `preInit`/`customInstall` logic keeps updates in the same folder as the previous install.
3. **User data excluded from the package** — `data/`, `config/`, `logs/`, `backups/` are created at runtime and excluded via the `files` globs; the uninstaller leaves them in place.
4. **Migration safety** — if a newly chosen root has no vault, the app adopts a prior location that does (previous install dir, `userData`, `~/.IndexArc`, AppData marker parent).
5. **Automatic backups** — timestamped, de-duplicated copies (last 10) are written to `backups/` on startup; encrypted vaults stay encrypted.
6. **Atomic writes** — temp file + rename prevents corruption if a write is interrupted.

### Verifying data safety after a build

A quick manual check that an update-style launch keeps data:

1. Ensure a real vault exists (non-empty `data/vault.json`) and the registry root points at it:
   `reg add "HKCU\Software\IndexArc" /v Root /t REG_SZ /d "<path-to-root>" /f`
2. Launch the freshly built `IndexArc-Portable-2.0.0.exe` (no `INDEXARC_ROOT` env).
3. Query `GET http://127.0.0.1:3000/api/status` and confirm `portable_root` points at your vault and `stats.total_saved` matches your entry count.

---

## Release checklist

1. Bump `version` in `package.json` (drives artifact names).
2. `npm run lint` — must pass.
3. `node --check electron-main.cjs` and `node --check preload.cjs`.
4. `npm run desktop:win` (and mac/linux on their hosts/CI).
5. Confirm both Windows artifacts exist in `dist-desktop/` and are signed.
6. Smoke-test the portable exe: launch, unlock (if encrypted), verify entries via `/api/status`.
7. Verify [data safety](#verifying-data-safety-after-a-build).
8. Publish artifacts.

CI: `.github/workflows/desktop-builds.yml` automates desktop builds.

---

## Troubleshooting builds

**`EBUSY` / `EPERM` on a network or locked drive (e.g. `G:\`).**
Build to a local path:
```bash
npm run build
npx electron-builder --win portable nsis --x64 --config.directories.output=C:\Users\%USERNAME%\IndexArc-build
```

**Signing fails.**
Confirm `signtool.exe` is on PATH and a valid certificate is installed/selected. Without signing config, remove/adjust the signing step for local test builds.

**Portable exe starts but shows an empty vault.**
It couldn't resolve the persisted root. Set `INDEXARC_ROOT` to your data folder, or set `HKCU\Software\IndexArc\Root` to the correct path, then relaunch. See [Data safety](#data-safety-on-update--reinstall).

**Window never appears / server didn't start.**
Electron waits for `GET /api/ping`. Check the crash log at `%TEMP%\indexarc-crash.log` and confirm nothing else occupies the port.
