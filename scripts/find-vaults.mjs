import fs from "fs";

function scan(dir, results = []) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const p = dir + "/" + e.name;
      if (e.isDirectory()) {
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

const roots = ["G:/GitHubRepos/IndexArc", "C:/Users/balfa/.IndexArc", "C:/Users/balfa/AppData/Roaming/IndexArc", "C:/Users/balfa/IndexArc"];
for (const r of roots) {
  const v = scan(r);
  if (v.length) {
    console.log("ROOT:", r);
    for (const x of v) {
      console.log("  ", x.path, "encrypted:", x.encrypted, "entries:", x.entries);
    }
  }
}
