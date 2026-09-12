# Release & Signing Guide

IndexArc ships unsigned today. Everything below is required before a release
should be called "industrial"; the build system already supports each step.

## 1. Code signing (Windows first — it is the primary install base)

1. Purchase an OV (or EV) code-signing certificate for the publishing
   identity you want users to trust.
2. Store it somewhere CI can use without leaking it (GitHub Actions
   secrets + a PFX, or a hardware token with a self-hosted runner for EV).
3. Wire it into `package.json` → `build.win`:
   - `certificateFile` / `certificatePassword` (or `certificateSubjectName`
     for a cert in the Windows store), plus `signingHashAlgorithms: ["sha256"]`.
4. electron-builder then signs `IndexArc.exe`, `IndexArc-Setup-*.exe`, and
   the uninstaller automatically on `npm run desktop:win`.
5. Remove `CSC_IDENTITY_AUTO_DISCOVERY: "false"` from
   `.github/workflows/ci.yml` once CI can sign.

macOS: add `identity` (Developer ID Application) and enable
`hardenedRuntime` + `entitlements` before distributing outside of
Gatekeeper bypass mode.

## 2. Auto-update

Updates are manual by design until BOTH of these exist:

1. **Signed artifacts** (above) — an update channel is only as trustworthy
   as its signatures.
2. **A hosting decision** — GitHub Releases (simplest; repo already has a
   remote), or static hosting for `latest.yml`.

Then: `npm i electron-updater`, publish config in `build` (`provider:
github`), and `autoUpdater.verifyUpdateCodeSignature` on Windows. The
installer already preserves user data folders across updates — the CI
preservation test guards that contract.

## 3. Pre-release checklist

- [ ] `npm ci && npm run lint && npm test` green locally.
- [ ] CI green, including `installer-preservation` job.
- [ ] `npm audit --audit-level=high` clean.
- [ ] Version bumped in `package.json`; CHANGELOG updated.
- [ ] Built on a clean machine: `npm run desktop:win`.
- [ ] Fresh-VM smoke test: install → first-run master-password gate → save
      an entry → quit → reinstall → entry still present, no unlock prompt
      loss.
- [ ] THREAT-MODEL.md reviewed if any trust boundary changed.

## 4. Incident notes

- Lost master password = data is unrecoverable by design. Emergency
  snapshots are ciphertext once encryption is on — that is intentional.
- If a build ever ships with a broken uninstaller (data deletion), the
  machine-level emergency snapshots in `%APPDATA%\IndexArc\emergency` are
  the recovery path (Settings → Emergency Plan).
