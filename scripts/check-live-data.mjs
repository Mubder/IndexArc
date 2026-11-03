// Diagnostic: list files in an IndexArc data directory with tab/entry counts.
//
// Usage:
//   node scripts/check-live-data.mjs [dataDir]
//
// dataDir defaults to $INDEXARC_ROOT/data, else ~/.IndexArc/data.
import fs from "fs";
import os from "os";
import path from "path";

const d = path.resolve(
  process.argv[2] ||
    (process.env.INDEXARC_ROOT
      ? path.join(process.env.INDEXARC_ROOT, "data")
      : path.join(os.homedir(), ".IndexArc", "data")),
);

if (!fs.existsSync(d)) {
  console.error(`Data directory not found: ${d}`);
  console.error("Pass a path as the first argument or set INDEXARC_ROOT.");
  process.exit(1);
}

const files = fs.readdirSync(d);
console.log(`Files in data dir ${d}:`);
for (const f of files) {
  const p = path.join(d, f);
  const st = fs.statSync(p);
  console.log(`  ${f} ${st.size} bytes`);
  if (!st.isFile()) continue;
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (j.tabs) console.log(`     tabs: ${j.tabs.length} archived: ${j.tabs.filter((t) => t.archived).length}`);
    if (j.entries) console.log(`     entries: ${j.entries.length}`);
  } catch {}
}
