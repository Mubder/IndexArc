#!/usr/bin/env node
// Write resources/app-update.yml into an unpacked Windows app, for builds whose
// installer is made with `electron-builder --prepackaged` (the SignPath flow in
// .github/workflows/desktop-builds.yml). electron-builder only writes this file
// while it packages the app itself, so a prepackaged build would otherwise ship
// without it and the in-app updater could not check for updates.
//
//   node scripts/write-app-update-yml.mjs dist-desktop/win-unpacked "SignPath Foundation"
//
// publisherName is what electron-updater checks the downloaded installer's
// Authenticode signature against; shared/updater.cjs only offers to install
// updates when it is present.

import fs from "node:fs";
import path from "node:path";

const [appDir, ...publishers] = process.argv.slice(2);
if (!appDir || !publishers.length) {
  console.error("Usage: write-app-update-yml.mjs <win-unpacked dir> <publisher name>…");
  process.exit(2);
}
const resources = path.join(path.resolve(appDir), "resources");
if (!fs.existsSync(resources)) {
  console.error(`No resources folder in ${appDir}`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const pub = [pkg.build?.publish].flat().find((p) => p?.provider === "github");
if (!pub) {
  console.error("package.json build.publish has no github provider");
  process.exit(1);
}

const q = (s) => JSON.stringify(String(s));
const lines = [
  `owner: ${q(pub.owner)}`,
  `repo: ${q(pub.repo)}`,
  `provider: github`,
  ...(pub.releaseType ? [`releaseType: ${pub.releaseType}`] : []),
  // Same value electron-builder uses: sanitized package name + "-updater".
  `updaterCacheDirName: ${q(pkg.name.toLowerCase() + "-updater")}`,
  `publisherName:`,
  ...publishers.map((p) => `  - ${q(p)}`),
];
fs.writeFileSync(path.join(resources, "app-update.yml"), lines.join("\n") + "\n");
console.log(`Wrote ${path.join(resources, "app-update.yml")}`);
