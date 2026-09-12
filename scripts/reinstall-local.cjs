// One-off: deterministic silent reinstall of the locally built Setup over
// the user's live install, then data-survival verification. Same mechanism
// as scripts/test-installer-preservation.cjs (execFileSync, no shell).
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

const dir = path.join(__dirname, "..", "dist-desktop");
const setup = fs
  .readdirSync(dir)
  .filter((f) => /^IndexArc-Setup-.*\.exe$/.test(f))
  .sort()
  .pop();
if (!setup) throw new Error("no Setup exe found");
const setupPath = path.join(dir, setup);

function installLocation() {
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Software\\IndexArc", "/v", "InstallLocation"], { encoding: "utf8" });
    const m = out.match(/REG_SZ\s+(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  return path.join(os.homedir(), ".IndexArc");
}

const before = installLocation();
const vaultBefore = JSON.parse(fs.readFileSync(path.join(before, "data", "vault.json"), "utf8"));
console.log("before: entries =", vaultBefore.entries.length, "| dir =", before);

console.log("silent install:", setupPath);
execFileSync(setupPath, ["/S"], { stdio: "ignore", timeout: 240000 });
console.log("install completed");

const after = installLocation();
const vaultPath = path.join(after, "data", "vault.json");
if (!fs.existsSync(vaultPath)) throw new Error("DATA LOST — vault.json missing after reinstall");
const vaultAfter = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
console.log("after: entries =", vaultAfter.entries.length, "| exe mtime =", fs.statSync(path.join(after, "IndexArc.exe")).mtime.toISOString());
if (vaultAfter.entries.length !== vaultBefore.entries.length) throw new Error("entry count changed!");
console.log("PASS ✅ reinstall preserved", vaultAfter.entries.length, "entries");
