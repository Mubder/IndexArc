// Last build step: record sha256 of every shipped dist/ file in
// dist-manifest.json at the project root. electron-builder packs that file
// INSIDE app.asar (integrity-protected by the asar fuses), while dist/ itself
// stays in app.asar.unpacked. electron-main.cjs verifies dist/ against it
// before loading the server bundle (see shared/verify-dist.cjs).
const fs = require("fs");
const path = require("path");
const { MANIFEST_NAME, hashDist } = require("../shared/verify-dist.cjs");

const root = process.cwd();
const distDir = path.join(root, "dist");
const files = hashDist(distDir);
for (const required of ["server.cjs", "pdf.worker.mjs"]) {
  if (!files[required]) {
    console.error(`[build] dist manifest: dist/${required} is missing — run the full build`);
    process.exit(1);
  }
}
const manifest = { version: 1, algorithm: "sha256", files };
fs.writeFileSync(path.join(root, MANIFEST_NAME), JSON.stringify(manifest, null, 2) + "\n");
console.log(`[build] ${MANIFEST_NAME}: ${Object.keys(files).length} dist files hashed`);
