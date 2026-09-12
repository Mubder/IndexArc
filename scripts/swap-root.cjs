// Backup/restore the portable-root pointers (registry + marker file) so a
// test launch with INDEXARC_ROOT can never hijack the user's real binding.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const mode = process.argv[2];
const regKey = "HKCU\\Software\\IndexArc";
const marker = path.join(process.env.APPDATA, "IndexArc", "vault-root.json");
const backup = path.join(__dirname, "..", "tmp");

if (mode === "save") {
  let root = "";
  try {
    const out = execFileSync("reg", ["query", regKey, "/v", "Root"], { encoding: "utf8" });
    const m = out.match(/REG_SZ\s+(.+)/);
    if (m) root = m[1].trim();
  } catch {}
  fs.writeFileSync(path.join(backup, "root-backup.txt"), root);
  let markerCopied = false;
  try {
    fs.copyFileSync(marker, path.join(backup, "vault-root-backup.json"));
    markerCopied = true;
  } catch {}
  console.log(`saved: reg Root="${root}" marker=${markerCopied}`);
} else if (mode === "restore") {
  const root = fs.readFileSync(path.join(backup, "root-backup.txt"), "utf8").trim();
  if (root) {
    execFileSync("reg", ["add", regKey, "/v", "Root", "/t", "REG_SZ", "/d", root, "/f"], { stdio: "ignore" });
    console.log(`restored reg Root="${root}"`);
  } else {
    console.log("no reg Root saved — nothing to restore");
  }
  const mb = path.join(backup, "vault-root-backup.json");
  if (fs.existsSync(mb)) {
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.copyFileSync(mb, marker);
    console.log("restored vault-root.json marker");
  }
}
