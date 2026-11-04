#!/usr/bin/env node
// Refresh latest.yml and the installer's .blockmap after the installer was
// signed outside electron-builder (SignPath). Signing changes the file's bytes,
// so the sha512 and size electron-builder wrote no longer match, and
// electron-updater would reject the download.
//
//   node scripts/refresh-update-manifest.mjs dist-desktop
//
// Rewrites, for every file listed in <dir>/latest.yml: its sha512 and size,
// the top-level sha512, and <file>.blockmap. Exits 1 if a listed file is missing.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const dir = path.resolve(process.argv[2] || "dist-desktop");
const manifest = path.join(dir, "latest.yml");

function sha512(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash("sha512");
    fs.createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("base64")))
      .on("error", reject);
  });
}

async function rebuildBlockmap(file) {
  // electron-builder's own block map writer (same format the updater reads).
  let buildBlockMap;
  try {
    ({ buildBlockMap } = require("app-builder-lib/out/targets/blockmap/blockmap.js"));
  } catch {
    console.warn(`  (no blockmap writer found; removing ${path.basename(file)}.blockmap, the updater falls back to a full download)`);
    fs.rmSync(`${file}.blockmap`, { force: true });
    return;
  }
  await buildBlockMap(file, "gzip", `${file}.blockmap`);
}

const text = fs.readFileSync(manifest, "utf8");
const lines = text.split(/\r?\n/);
const urls = [...new Set(lines.map((l) => /^\s*-\s*url:\s*(.+?)\s*$/.exec(l)?.[1]).filter(Boolean))];
const topPath = lines.map((l) => /^path:\s*(.+?)\s*$/.exec(l)?.[1]).find(Boolean);
if (!urls.length) {
  console.error(`No files listed in ${manifest}`);
  process.exit(1);
}

const info = {};
for (const url of urls) {
  const file = path.join(dir, url);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${file}`);
    process.exit(1);
  }
  info[url] = { sha512: await sha512(file), size: fs.statSync(file).size };
  if (fs.existsSync(`${file}.blockmap`)) await rebuildBlockmap(file);
  console.log(`  ${url}: ${info[url].size} bytes`);
}

// Rewrite in place, keeping every other line as it was.
let current = null;
const out = lines.map((l) => {
  const u = /^(\s*-\s*url:\s*)(.+?)\s*$/.exec(l);
  if (u) {
    current = u[2];
    return l;
  }
  if (/^\S/.test(l)) current = null;
  const s = /^(\s+)sha512:/.exec(l);
  if (s && current && info[current]) return `${s[1]}sha512: ${info[current].sha512}`;
  const z = /^(\s+)size:/.exec(l);
  if (z && current && info[current]) return `${z[1]}size: ${info[current].size}`;
  if (/^sha512:/.test(l) && topPath && info[topPath]) return `sha512: ${info[topPath].sha512}`;
  return l;
});
fs.writeFileSync(manifest, out.join("\n"));
console.log(`Updated ${manifest}`);
