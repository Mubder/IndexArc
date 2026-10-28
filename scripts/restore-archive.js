/**
 * Restore archived scratchpad notes from the repo data/ to a live app data dir.
 *
 * Usage: node scripts/restore-archive.js [target-data-dir]
 *
 * If no target is given, it scans common Windows locations and reports
 * archive counts in each, then exits without writing anything.
 */
import fs from "fs";
import path from "path";
import os from "os";

const REPO_DATA = path.resolve("data");
const REPO_ARCHIVE = path.join(REPO_DATA, "scratchpad_archive.json");
const REPO_ARCHIVE_PREV = path.join(REPO_DATA, "scratchpad_archive.json.prev");

function countArchive(dir) {
  const f = path.join(dir, "scratchpad_archive.json");
  if (!fs.existsSync(f)) return null;
  try {
    const d = JSON.parse(fs.readFileSync(f, "utf-8"));
    return Array.isArray(d.tabs) ? d.tabs.length : 0;
  } catch {
    return -1;
  }
}

function readArchive(dir) {
  const f = path.join(dir, "scratchpad_archive.json");
  return JSON.parse(fs.readFileSync(f, "utf-8"));
}

function candidateDirs() {
  const appData = process.env.APPDATA || "";
  const home = os.homedir();
  const cands = [
    path.join(appData, "IndexArc", "data"),
    path.join(home, ".IndexArc", "data"),
    path.join(home, "IndexArc", "data"),
    REPO_DATA,
  ];
  // Also check one level up (some installers put data/ next to the app root)
  try {
    for (const entry of fs.readdirSync(appData, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.toLowerCase().includes("indexarc")) {
        cands.push(path.join(appData, entry.name, "data"));
      }
    }
  } catch {}
  // dedupe
  const seen = new Set();
  return cands.filter((d) => {
    if (seen.has(d)) return false;
    seen.add(d);
    return true;
  });
}

function backupFile(file) {
  if (!fs.existsSync(file)) return null;
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .replace("Z", "");
  const bak = `${file}.restore-bak-${stamp}`;
  fs.copyFileSync(file, bak);
  return bak;
}

async function main() {
  const target = process.argv[2];

  if (!fs.existsSync(REPO_ARCHIVE)) {
    console.error("ERROR: repo archive not found at", REPO_ARCHIVE);
    process.exit(1);
  }
  const repoArchive = readArchive(REPO_DATA);
  const repoCount = Array.isArray(repoArchive.tabs) ? repoArchive.tabs.length : 0;
  console.log(`Repo archive: ${repoCount} tabs at ${REPO_ARCHIVE}`);

  const cands = candidateDirs();
  console.log("\nCandidate data directories:");
  let liveDir = null;
  for (const d of cands) {
    const c = countArchive(d);
    const exists = fs.existsSync(d);
    const marker = d === REPO_DATA ? " (repo)" : "";
    if (c === null) {
      console.log(`  [missing] ${d}${marker}`);
    } else if (c === -1) {
      console.log(`  [corrupt] ${d}${marker}`);
    } else {
      console.log(`  ${c} archived tabs  ${d}${marker}`);
      if (d !== REPO_DATA && c < repoCount && c >= 0) {
        liveDir = d; // likely the depleted live app dir
      }
    }
  }

  if (target) {
    const tResolved = path.resolve(target);
    if (!fs.existsSync(tResolved)) {
      console.error("ERROR: target dir does not exist:", tResolved);
      process.exit(1);
    }
    liveDir = tResolved;
  }

  if (!liveDir) {
    console.log(
      "\nNo depleted live-app dir auto-detected. Re-run with the target path:\n" +
        `  node ${path.basename(__filename)} "C:\\Users\\you\\AppData\\Roaming\\IndexArc\\data"`
    );
    process.exit(0);
  }

  console.log(`\nTarget live dir: ${liveDir}`);
  const liveCount = countArchive(liveDir) ?? 0;
  console.log(`Live archive currently: ${liveCount} tabs`);

  if (liveCount >= repoCount) {
    console.log("Live archive already has >= repo count. Nothing to restore.");
    process.exit(0);
  }

  // Back up the depleted live state first
  const liveArchive = path.join(liveDir, "scratchpad_archive.json");
  const bak = backupFile(liveArchive);
  if (bak) console.log(`Backed up depleted live archive to: ${bak}`);

  // Also back up the .prev if present
  const livePrev = path.join(liveDir, "scratchpad_archive.json.prev");
  if (fs.existsSync(livePrev)) backupFile(livePrev);

  // Write repo archive into live dir
  fs.writeFileSync(liveArchive, fs.readFileSync(REPO_ARCHIVE, "utf-8"), "utf-8");
  console.log(`\nRESTORED: copied ${repoCount} archived tabs to ${liveArchive}`);

  // Also copy the repo .prev as a fallback reference
  if (fs.existsSync(REPO_ARCHIVE_PREV)) {
    fs.writeFileSync(livePrev, fs.readFileSync(REPO_ARCHIVE_PREV, "utf-8"), "utf-8");
    console.log(`Copied repo .prev reference to ${livePrev}`);
  }

  console.log("\nRestart the IndexArc app to see the restored archived notes.");
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
