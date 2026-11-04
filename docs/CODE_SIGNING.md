# Code signing (Windows) — SignPath Foundation

IndexArc's Windows builds are signed through **SignPath**'s free program for
open-source projects. The certificate belongs to **SignPath Foundation**, so
Windows shows *"SignPath Foundation"* as the publisher. It is not a personal or
company certificate. In exchange the signing is free, and SignPath checks that
every signed file was built by this repository's GitHub Actions.

Until the steps below are done, CI keeps building unsigned artifacts exactly as
before. The signing steps switch on only for **release** events, and only once
the repository variable `SIGNPATH_ORGANIZATION_ID` exists.

## What the workflow does

`.github/workflows/desktop-builds.yml`, Windows leg, on a published release:

1. `electron-builder --win dir` packages the app unpacked (`dist-desktop/win-unpacked`).
2. SignPath signs `IndexArc.exe` inside it (artifact configuration **`app`**).
3. `scripts/write-app-update-yml.mjs` writes `resources/app-update.yml` with
   `publisherName: SignPath Foundation`. `--prepackaged` builds skip the step
   that normally writes it, and the in-app updater only installs updates whose
   signature matches this name.
4. `electron-builder --win nsis portable --prepackaged signed/win-unpacked`
   builds the installer and portable exe around the signed app.
5. SignPath signs both (artifact configuration **`installers`**).
6. `scripts/refresh-update-manifest.mjs` recomputes the sha512 and size in
   `latest.yml` and rebuilds the `.blockmap`. Signing changed the installer's
   bytes, so the old values would make the updater reject the download.
7. The existing steps upload the finished files, and `publish-release`
   attaches them to the GitHub Release. The unsigned files sent to SignPath
   (`signpath-input-*` artifacts) are never attached, and they expire after a day.

Not signed: the NSIS uninstaller and `elevate.exe` inside the installer, and
Electron's own DLLs. Windows does not show a warning for the uninstaller, which
runs from an already-installed folder. macOS and Linux builds are unaffected.

## One-time setup (owner)

1. **Meet the program's conditions.** At the time of writing (check
   [signpath.org](https://signpath.org) for the current terms):
   - OSI-approved license with no proprietary parts — ✅ GPL-3.0 (`LICENSE`);
   - the README has a *Code signing policy* and a *Privacy* section — ✅;
   - the project is public, maintained and already released — publish a first
     (unsigned) GitHub Release before applying;
   - multi-factor authentication is on for GitHub and SignPath accounts.
2. **Apply** on signpath.org for a free open-source subscription, and link
   `github.com/Mubder/IndexArc`. Their review usually takes a few weeks.
3. **In SignPath**, once approved:
   - create (or confirm) the project and note its **slug**;
   - add two artifact configurations, with slugs `app` and `installers`, from
     `.signpath/artifact-configurations/app.xml` and `installers.xml`;
   - note the **release signing policy** slug (requires a manual approval per
     request, which is what you want);
   - add the GitHub Actions trusted build system to the project;
   - create a CI user / API token with *submitter* rights on that policy.
4. **In GitHub** → Settings → Secrets and variables → Actions:

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `SIGNPATH_API_TOKEN` | the API token from step 3 |
   | Variable | `SIGNPATH_ORGANIZATION_ID` | your SignPath organization id |
   | Variable | `SIGNPATH_PROJECT_SLUG` | the project slug |
   | Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | the release policy slug |

5. Publish a release. The Windows job waits for you to approve each of the two
   signing requests in SignPath (10 minutes each by default), then continues.

## Verifying a release

```powershell
Get-AuthenticodeSignature .\IndexArc-Setup-2.2.0.exe | Format-List Status, SignerCertificate
# Status: Valid · Subject: CN=SignPath Foundation, …
```

An installed signed build has
`resources\app-update.yml` with `publisherName: SignPath Foundation`, and
*Settings → Updates* offers *Install* instead of a link to the release page.

## Testing the flow locally (no signing)

```bash
npx electron-builder --win dir --x64 --publish never
node scripts/write-app-update-yml.mjs dist-desktop/win-unpacked "SignPath Foundation"
npx electron-builder --win nsis portable --x64 --publish never --prepackaged dist-desktop/win-unpacked
node scripts/refresh-update-manifest.mjs dist-desktop
```

Do not install such a build to test updates: its `app-update.yml` claims a
signer the files do not have. electron-updater will (correctly) refuse to install
any update into it.
