# Code signing (Windows)

The release workflow (`.github/workflows/desktop-builds.yml`) can sign Windows
builds in two ways. It picks one by itself, and only for **release** events:

| | Azure Trusted Signing (option A) | SignPath Foundation (option B) |
|---|---|---|
| Turns on when | repository variable `AZURE_SIGNING_ENDPOINT` is set | `SIGNPATH_ORGANIZATION_ID` is set and Azure is not |
| Publisher Windows shows | **your verified name** (or your company's) | "SignPath Foundation" |
| Signed | app exe, Electron's DLLs, installer, **uninstaller**, portable exe | app exe, installer, portable exe |
| Cost | about US$10/month (Basic plan) | free for open-source projects |
| Approval per release | automatic | manual click in SignPath |
| Who can sign up | limited by country and identity checks (below) | qualifying open-source projects |

With neither configured, CI builds unsigned artifacts as it always has.
macOS and Linux builds are not affected by either option.

---

## Option A — Azure Trusted Signing (preferred once paid for)

Microsoft runs the certificate. Your identity is verified once, and each
signature uses a short-lived certificate in your name. electron-builder
supports it directly, so the build is the normal one-step build.

### What the workflow does

1. `scripts/azure-sign-config.mjs` writes `electron-builder.azure.json`:
   package.json's `build` section plus `win.azureSignOptions` from the
   repository variables, `signExts: [".dll"]` and `forceCodeSigning: true`.
   A signing failure fails the build; it never ships unsigned.
2. `electron-builder --config electron-builder.azure.json --win portable nsis`
   builds and signs everything, and writes `publisherName` into
   `app-update.yml`. Installed builds then verify each update against your
   name before installing it.
3. **Verify signatures (Azure)** checks that every `.exe` is validly signed by
   exactly `AZURE_SIGNING_PUBLISHER_NAME`, and that `app-update.yml` carries a
   publisher.

### One-time setup (owner)

Terms change. These are as last known, so check Microsoft's current
"Trusted Signing" (also called "Artifact Signing") documentation.

1. **Check eligibility.** Individual developers have only been accepted in a
   few countries (the US and Canada). Organisations are accepted in more
   countries (US, Canada, EU, UK), with a business-verification step that has
   required several years of verifiable history.
2. **Azure:** create an Azure subscription, then a **Trusted Signing account**
   (Basic SKU) in a region near you. Note its **endpoint** URL (for example
   `https://weu.codesigning.azure.net/`) and the **account name**.
3. **Identity validation:** in the account, request *Public Trust* identity
   validation (individual or organisation) and complete Microsoft's
   verification. This can take days to weeks.
4. **Certificate profile:** once validated, create a *Public Trust*
   certificate profile. Note the **profile name**, and the exact **subject CN**
   it will sign with (your validated legal name).
5. **App registration for CI:** in Microsoft Entra ID, register an app, create
   a client secret, and give it the **Trusted Signing Certificate Profile
   Signer** role on the account (or the profile).
6. **GitHub** → Settings → Secrets and variables → Actions:

   | Kind | Name | Value |
   |---|---|---|
   | Variable | `AZURE_SIGNING_ENDPOINT` | the account endpoint URL |
   | Variable | `AZURE_SIGNING_ACCOUNT` | the Trusted Signing account name |
   | Variable | `AZURE_SIGNING_PROFILE` | the certificate profile name |
   | Variable | `AZURE_SIGNING_PUBLISHER_NAME` | the certificate's subject CN, **exactly** |
   | Variable (optional) | `AZURE_SIGN_DLLS` | `false` to sign only `.exe` files |
   | Secret | `AZURE_TENANT_ID` | Entra tenant id |
   | Secret | `AZURE_CLIENT_ID` | the app registration's client id |
   | Secret | `AZURE_CLIENT_SECRET` | its client secret |

   Recommended: put the three secrets in a GitHub **Environment** (e.g.
   `release`) with yourself as required reviewer, and add `environment:
   release` to the build job when you do.
7. Publish a release. The Windows job signs while it builds.

**Do not change `AZURE_SIGNING_PUBLISHER_NAME` casually.** Installed copies
only accept updates signed by the name they were built with. A rename (for
example, moving from your own name to a company) needs one release that lists
both names: give `publisherName` both values in `scripts/azure-sign-config.mjs`
for that release.

**SmartScreen:** a new publisher starts with little reputation, so early
downloads may still show "not commonly downloaded". This fades as installs
accumulate.

---

## Option B — SignPath Foundation (free, open source)

The certificate belongs to **SignPath Foundation**, so Windows shows *"SignPath
Foundation"* as the publisher. The signing is free, and SignPath checks that
each signed file was built by this repository's GitHub Actions.

### What the workflow does

1. `electron-builder --win dir` packages the app unpacked (`dist-desktop/win-unpacked`).
2. SignPath signs `IndexArc.exe` inside it (artifact configuration **`app`**).
3. `scripts/write-app-update-yml.mjs` writes `resources/app-update.yml` with
   `publisherName: SignPath Foundation`. `--prepackaged` builds skip the step
   that normally writes it.
4. `electron-builder --win nsis portable --prepackaged signed/win-unpacked`
   builds the installer and portable exe around the signed app.
5. SignPath signs both (artifact configuration **`installers`**).
6. `scripts/refresh-update-manifest.mjs` recomputes the sha512 and size in
   `latest.yml` and rebuilds the `.blockmap`. Signing changed the installer's
   bytes, so the old values would make the updater reject the download.
7. The unsigned files sent to SignPath (`signpath-input-*` artifacts) are never
   attached to the release, and they expire after a day.

Not signed with this option: the NSIS uninstaller, `elevate.exe` and
Electron's DLLs.

### One-time setup (owner)

1. **Meet the program's conditions** (check [signpath.org](https://signpath.org)):
   - OSI-approved license with no proprietary parts — ✅ GPL-3.0 (`LICENSE`);
   - the README has a *Code signing policy* and a *Privacy* section — ✅;
   - the project is public, maintained and already released — publish a first
     (unsigned) GitHub Release before applying;
   - multi-factor authentication on GitHub and SignPath.
2. **Apply** on signpath.org for a free open-source subscription, and link
   `github.com/Mubder/IndexArc`. Their review usually takes a few weeks.
3. **In SignPath**, once approved:
   - create (or confirm) the project and note its **slug**;
   - add two artifact configurations, with slugs `app` and `installers`, from
     `.signpath/artifact-configurations/app.xml` and `installers.xml`;
   - note the **release signing policy** slug (manual approval per request);
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
   signing requests in SignPath (10 minutes each by default).

### Testing option B's build steps locally (no signing)

```bash
npx electron-builder --win dir --x64 --publish never
node scripts/write-app-update-yml.mjs dist-desktop/win-unpacked "SignPath Foundation"
npx electron-builder --win nsis portable --x64 --publish never --prepackaged dist-desktop/win-unpacked
node scripts/refresh-update-manifest.mjs dist-desktop
```

Do not install such a build to test updates: its `app-update.yml` claims a
signer the files do not have.

---

## Switching from B to A later

Installed copies accept an update only when it is signed by a name listed in
their `app-update.yml`. Copies signed via SignPath list only "SignPath
Foundation", so they will **not** auto-install the first Azure-signed release.
Either:
- ship one bridge release through SignPath whose `app-update.yml` lists both
  names: `node scripts/write-app-update-yml.mjs signed/win-unpacked "SignPath Foundation" "<your Azure name>"`.
  Then switch to Azure; or
- accept that those users install the Azure build once by hand. The app links
  to the release page when it cannot install an update itself.

Unsigned installs are unaffected: they never auto-install, and always link to
the release page.

## Verifying a release

```powershell
Get-AuthenticodeSignature .\IndexArc-Setup-2.2.0.exe | Format-List Status, SignerCertificate
```

`Status` must be `Valid`, and the subject must be your Azure name (A) or
`CN=SignPath Foundation` (B). In an installed signed build, *Settings →
Updates* offers *Install* instead of a link to the release page.
