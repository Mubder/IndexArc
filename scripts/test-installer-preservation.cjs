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

/** The current user's PATH as stored (unexpanded), split into non-empty segments. */
function userPathSegments() {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", "Path"], { encoding: "utf8" });
    const m = out.match(/REG_(?:EXPAND_)?SZ\s+(.*)$/m);
    return m ? m[1].trim().split(";").filter(Boolean) : [];
  } catch {
    return [];
  }
}

const sameDir = (a, b) => a.replace(/\\+$/, "").toLowerCase() === b.replace(/\\+$/, "").toLowerCase();

function runInstaller(setup, label) {
  console.log(`[installer-preservation] ${label}: running ${path.basename(setup)} /S …`);
  execFileSync(setup, ["/S"], { stdio: "ignore" });
  ok(`${label} install completed`);
}

function main() {
  if (process.platform !== "win32") fail("Windows only");
  const setup = findSetup();

  const pathBefore = userPathSegments();

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

  // 4b) The `indexarc` command: standalone binary, on the user's PATH once
  // (the reinstall removed and re-added it), other PATH entries untouched.
  const cliDir = path.join(root, "resources", "cli");
  const cliExe = path.join(cliDir, "indexarc.exe");
  if (!fs.existsSync(cliExe)) fail("resources/cli/indexarc.exe missing");
  const help = execFileSync(cliExe, ["help"], { encoding: "utf8" });
  if (!/indexarc/i.test(help)) fail("indexarc.exe did not print its help");
  const installed = userPathSegments();
  const hits = installed.filter((s) => sameDir(s, cliDir)).length;
  if (hits !== 1) fail(`expected the CLI folder on the user PATH once, found ${hits}× in: ${installed.join(";")}`);
  const others = installed.filter((s) => !sameDir(s, cliDir));
  if (others.join(";") !== pathBefore.filter((s) => !sameDir(s, cliDir)).join(";")) fail("the install changed other user PATH entries");
  ok("indexarc.exe runs and its folder is on the user PATH exactly once");

  // 5) Cleanup: silent uninstall (also validates our customRemoveFiles on
  // explicit uninstall) — data dirs are expected to REMAIN, which is fine on CI.
  try {
    execFileSync('"' + path.join(root, "Uninstall IndexArc.exe") + '" /S', { stdio: "ignore", shell: true });
  } catch {}
  // The uninstaller re-launches itself from a temp copy, so wait for it.
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline && userPathSegments().some((s) => sameDir(s, cliDir))) {
    execFileSync(process.execPath, ["-e", "setTimeout(() => {}, 1000)"]);
  }
  const after = userPathSegments();
  if (after.some((s) => sameDir(s, cliDir))) fail("uninstall left the CLI folder on the user PATH");
  if (after.join(";") !== pathBefore.filter((s) => !sameDir(s, cliDir)).join(";")) fail("uninstall changed other user PATH entries");
  ok("uninstall removed the CLI folder from the user PATH and nothing else");
  console.log("[installer-preservation] PASS ✅");
}

main();
