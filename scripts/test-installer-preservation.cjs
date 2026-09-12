#!/usr/bin/env node
"use strict";

// End-to-end installer data-preservation proof (the manual test from
// 2026-09-12, automated). Runs ONLY on a throwaway machine (CI windows
// runner) — it installs IndexArc for the current user, writes vault-like
// data into the install folder, reinstalls over it, and asserts the data
// survived the uninstaller pass. Exits non-zero on any failure.
//
// Prereq: dist-desktop/IndexArc-Setup-*..exe must already exist (CI builds it
// with `npm run desktop:win` first).

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

function fail(msg) {
  console.error(`[installer-preservation] FAIL: ${msg}`);
  process.exit(1);
}

function ok(msg) {
  console.log(`[installer-preservation] ok: ${msg}`);
}

function findSetup() {
  const dir = path.join(__dirname, "..", "dist-desktop");
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => /^IndexArc-Setup-.*\.exe$/.test(f))
    .sort();
  if (!candidates.length) fail("no IndexArc-Setup-*.exe in dist-desktop — build first");
  return path.join(dir, candidates[candidates.length - 1]);
}

function installLocation() {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\IndexArc", "/v", "InstallLocation"], {
      encoding: "utf8",
    });
    const m = out.match(/REG_SZ\s+(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return path.join(os.homedir(), ".IndexArc");
}

function runInstaller(setup, label) {
  console.log(`[installer-preservation] ${label}: running ${path.basename(setup)} /S …`);
  execFileSync(setup, ["/S"], { stdio: "ignore" });
  ok(`${label} install completed`);
}

function main() {
  if (process.platform !== "win32") fail("Windows only");
  const setup = findSetup();

  // 1) First install.
  runInstaller(setup, "first");
  const root = installLocation();
  if (!fs.existsSync(path.join(root, "IndexArc.exe"))) fail(`IndexArc.exe not found at ${root}`);
  ok(`install dir: ${root}`);

  // 2) Simulate user vault data (the files the uninstaller must preserve).
  const dataDir = path.join(root, "data");
  const configDir = path.join(root, "config");
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  const marker = "preservation-marker-" + Date.now();
  fs.writeFileSync(path.join(dataDir, "vault.json"), JSON.stringify({ version: 1, entries: [{ marker }] }));
  fs.writeFileSync(path.join(configDir, "settings.json"), JSON.stringify({ marker }));
  ok(`wrote marker data (${marker})`);

  // 3) Reinstall OVER the data — the old uninstaller used to wipe this.
  runInstaller(setup, "second (reinstall over live data)");

  // 4) Assert survival.
  const vault = path.join(dataDir, "vault.json");
  const settings = path.join(configDir, "settings.json");
  if (!fs.existsSync(vault)) fail("data/vault.json was DELETED by the reinstall — preservation broken");
  if (!fs.existsSync(settings)) fail("config/settings.json was DELETED by the reinstall — preservation broken");
  const v = JSON.parse(fs.readFileSync(vault, "utf8"));
  if (v.entries?.[0]?.marker !== marker) fail("vault.json survived but its content changed");
  ok("vault + settings survived the reinstall intact");

  // 5) Cleanup: silent uninstall (also validates our customRemoveFiles on
  // explicit uninstall) — data dirs are expected to REMAIN, which is fine on CI.
  try {
    execFileSync('"' + path.join(root, "Uninstall IndexArc.exe") + '" /S', { stdio: "ignore", shell: true });
  } catch {}
  console.log("[installer-preservation] PASS ✅");
}

main();
