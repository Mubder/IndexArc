// Diagnostic: list every vault.json under the usual IndexArc data roots.
//
// Usage:
//   node scripts/find-vaults.mjs [root ...]
//
// Roots, in priority order:
//   1. command-line arguments, if any
//   2. INDEXARC_SEARCH_ROOTS (path-delimiter separated, ';' on Windows, ':' elsewhere)
//   3. defaults: INDEXARC_ROOT (if set), the repo checkout, ~/.IndexArc,
//      the per-user app-data folder, and ~/IndexArc
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

function scan(dir, results = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        scan(p, results);
      } else if (e.name === "vault.json") {
        try {
          const j = JSON.parse(fs.readFileSync(p, "utf-8"));
          results.push({ path: p, encrypted: !!j.encrypted, entries: j.entries?.length || "blob" });
        } catch {
          results.push({ path: p, encrypted: "?", entries: "?" });
        }
      }
    }
  } catch {}
  return results;
}

function defaultRoots() {
  const home = os.homedir();
  const appData =
    process.env.APPDATA ||
    (process.platform === "darwin"
      ? path.join(home, "Library", "Application Support")
      : process.env.XDG_CONFIG_HOME || path.join(home, ".config"));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return [
    process.env.INDEXARC_ROOT,
    repoRoot,
    path.join(home, ".IndexArc"),
    path.join(appData, "IndexArc"),
    path.join(home, "IndexArc"),
  ].filter(Boolean);
}

const argRoots = process.argv.slice(2);
const envRoots = (process.env.INDEXARC_SEARCH_ROOTS || "").split(path.delimiter).filter(Boolean);
const roots = [...new Set((argRoots.length ? argRoots : envRoots.length ? envRoots : defaultRoots()).map((r) => path.resolve(r)))];

for (const r of roots) {
  const v = scan(r);
  if (v.length) {
    console.log("ROOT:", r);
    for (const x of v) {
      console.log("  ", x.path, "encrypted:", x.encrypted, "entries:", x.entries);
    }
  }
}
