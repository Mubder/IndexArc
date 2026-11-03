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

Skeleton for when the certificate exists. It is **not** in `package.json`
today; adding it is an owner decision. Keep the secrets in CI and out of the
repository:

```jsonc
// package.json → build.win
"signingHashAlgorithms": ["sha256"],
// either a PFX supplied via env (CSC_LINK = base64/path, CSC_KEY_PASSWORD)
// or a certificate already installed in the Windows store:
"certificateSubjectName": "<publisher CN>"

// package.json → build.mac  (only once notarization is funded)
"identity": "Developer ID Application: <name> (<team id>)",
"hardenedRuntime": true,
"notarize": true            // reads APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID
```

```yaml
# workflow step env, replacing CSC_IDENTITY_AUTO_DISCOVERY: "false"
CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
```

Signing matters more now that the Electron fuses are on (see below). The
fuses and the asar integrity hash are only as trustworthy as the
signature on the executable that holds them.

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

## 3. What already protects a build (no owner decision needed)

- **Electron fuses** (`build.electronFuses`): RunAsNode, `NODE_OPTIONS` and
  `--inspect` are off. Embedded asar integrity validation and
  only-load-from-asar are on.
- **dist manifest**: `dist-manifest.json` (sha256 of every unpacked `dist/`
  file) is packed inside `app.asar`. The packaged app verifies `dist/`
  against it before loading the server bundle, and refuses to start on a
  mismatch.
- **SBOM**: the desktop workflow uploads a CycloneDX `sbom.cdx.json`
  (production deps) as the `IndexArc-SBOM` artifact. Attach it to the release.
- **Dependabot**: weekly grouped npm and GitHub Actions updates. Actions are
  pinned to commit SHAs and workflows run with `permissions: contents: read`.

Details are in [BUILD_AND_RELEASE.md](./BUILD_AND_RELEASE.md#release-trust-fuses-dist-manifest-sbom).

## 4. Pre-release checklist

- [ ] `npm ci && npm run lint && npm test` green locally.
- [ ] CI green, including `installer-preservation` job.
- [ ] `npm audit --audit-level=high` clean.
- [ ] Version bumped in `package.json`; `CHANGELOG.md` `[Unreleased]` moved under the new version; tag `vX.Y.Z`.
- [ ] Built on a clean machine: `npm run desktop:win` (`check:dist` confirms the dist manifest).
- [ ] `npx @electron/fuses read --app dist-desktop/win-unpacked/IndexArc.exe` shows the fuse table from section 3.
- [ ] `sbom.cdx.json` from CI attached to the release.
- [ ] Fresh-VM smoke test: install → first-run master-password gate → save
      an entry → quit → reinstall → entry still present, no unlock prompt
      loss.
- [ ] THREAT-MODEL.md reviewed if any trust boundary changed.

## 5. Incident notes

- Lost master password = data is unrecoverable by design. Emergency
  snapshots are ciphertext once encryption is on — that is intentional.
- If a build ever ships with a broken uninstaller (data deletion), the
  machine-level emergency snapshots in `%APPDATA%\IndexArc\emergency` are
  the recovery path (Settings → Emergency Plan).
