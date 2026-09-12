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
const vaultRaw = JSON.parse(fs.readFileSync(path.join(before, "data", "vault.json"), "utf8"));
const vaultBefore = {
  encrypted: !!vaultRaw.encrypted,
  kdf: vaultRaw.kdf ? vaultRaw.kdf.algo : null,
  entries: Array.isArray(vaultRaw.entries) ? vaultRaw.entries.length : null,
};
console.log("before:", JSON.stringify(vaultBefore), "| dir =", before);

console.log("silent install:", setupPath);
execFileSync(setupPath, ["/S"], { stdio: "ignore", timeout: 240000 });
console.log("install completed");

const after = installLocation();
const vaultPath = path.join(after, "data", "vault.json");
if (!fs.existsSync(vaultPath)) throw new Error("DATA LOST — vault.json missing after reinstall");
const vaultAfterRaw = JSON.parse(fs.readFileSync(vaultPath, "utf8"));
const vaultAfter = {
  encrypted: !!vaultAfterRaw.encrypted,
  kdf: vaultAfterRaw.kdf ? vaultAfterRaw.kdf.algo : null,
  entries: Array.isArray(vaultAfterRaw.entries) ? vaultAfterRaw.entries.length : null,
};
console.log("after:", JSON.stringify(vaultAfter), "| exe mtime =", fs.statSync(path.join(after, "IndexArc.exe")).mtime.toISOString());
if (vaultAfter.encrypted !== vaultBefore.encrypted) throw new Error("encryption state changed by reinstall!");
if (vaultBefore.entries !== null && vaultAfter.entries !== vaultBefore.entries) throw new Error("entry count changed!");
console.log("PASS ✅ reinstall preserved the vault (encrypted=" + vaultAfter.encrypted + ", kdf=" + vaultAfter.kdf + ", entries=" + vaultAfter.entries + ")");
