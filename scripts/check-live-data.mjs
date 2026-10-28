import fs from "fs";
import path from "path";
const d = "C:\\Users\\balfa\\.IndexArc\\data";
const files = fs.readdirSync(d);
console.log("Files in live data dir:");
for (const f of files) {
  const p = path.join(d, f);
  const st = fs.statSync(p);
  console.log(`  ${f} ${st.size} bytes`);
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf-8"));
    if (j.tabs) console.log(`     tabs: ${j.tabs.length} archived: ${j.tabs.filter((t) => t.archived).length}`);
    if (j.entries) console.log(`     entries: ${j.entries.length}`);
  } catch {}
}
