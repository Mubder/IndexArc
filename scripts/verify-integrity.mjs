import fs from "fs";
import crypto from "crypto";

const manifestPath = "./data/manifest.json";
const keyPath = "./config/manifest.key";
const tracked = [
  "vault.json",
  "vectors.json",
  "scratchpad.json",
  "scratchpad_archive.json",
  "note_revisions.json",
  "settings.json",
];

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const keyBuf = Buffer.from(fs.readFileSync(keyPath, "utf-8"), "hex");
let warnings = [];
for (const f of tracked) {
  const p = "./data/" + f;
  if (!fs.existsSync(p)) continue;
  const data = fs.readFileSync(p);
  const mac = crypto.createHmac("sha256", keyBuf).update(data).digest("hex");
  const stored = manifest.hmacs?.[f];
  if (stored && stored !== mac) warnings.push(f + " MISMATCH");
  else console.log(f + ": OK");
}
console.log(warnings.length ? "WARNINGS: " + warnings.join(", ") : "All integrity checks pass — no warnings.");
