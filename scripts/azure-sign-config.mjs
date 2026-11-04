#!/usr/bin/env node
// Write an electron-builder config that signs Windows builds with Azure
// Trusted Signing (Microsoft's code-signing service). It is package.json's
// "build" section plus win.azureSignOptions, filled from environment
// variables, so nothing account-specific lives in the repository.
//
//   node scripts/azure-sign-config.mjs electron-builder.azure.json
//   npx electron-builder --config electron-builder.azure.json --win nsis portable
//
// Required env (repository variables in CI):
//   AZURE_SIGNING_ENDPOINT        e.g. https://weu.codesigning.azure.net/
//   AZURE_SIGNING_ACCOUNT         Trusted Signing account name
//   AZURE_SIGNING_PROFILE         certificate profile name
//   AZURE_SIGNING_PUBLISHER_NAME  the certificate's subject CN, exactly; the
//                                 in-app updater checks updates against it
// Optional:
//   AZURE_SIGN_DLLS=false         sign only .exe files (default also signs
//                                 the app folder's .dll files, i.e. Electron's)
// Login (read by the TrustedSigning PowerShell module, not by this script):
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET

import fs from "node:fs";

const out = process.argv[2];
if (!out) {
  console.error("Usage: azure-sign-config.mjs <output.json>");
  process.exit(2);
}

const need = ["AZURE_SIGNING_ENDPOINT", "AZURE_SIGNING_ACCOUNT", "AZURE_SIGNING_PROFILE", "AZURE_SIGNING_PUBLISHER_NAME"];
const missing = need.filter((k) => !process.env[k]?.trim());
if (missing.length) {
  console.error(`Missing: ${missing.join(", ")}. See docs/CODE_SIGNING.md.`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const build = structuredClone(pkg.build);
build.win = {
  ...build.win,
  azureSignOptions: {
    endpoint: process.env.AZURE_SIGNING_ENDPOINT.trim(),
    codeSigningAccountName: process.env.AZURE_SIGNING_ACCOUNT.trim(),
    certificateProfileName: process.env.AZURE_SIGNING_PROFILE.trim(),
    publisherName: process.env.AZURE_SIGNING_PUBLISHER_NAME.trim(),
  },
  ...(process.env.AZURE_SIGN_DLLS === "false" ? {} : { signExts: [".dll"] }),
};
// A signing failure must fail the build, never ship unsigned.
build.forceCodeSigning = true;

fs.writeFileSync(out, JSON.stringify(build, null, 2) + "\n");
console.log(`Wrote ${out} (publisher: ${build.win.azureSignOptions.publisherName})`);
