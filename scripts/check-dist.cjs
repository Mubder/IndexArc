// Build preflight: the desktop packagers MUST NOT run unless dist/ holds both
// halves of the app. `vite build` alone EMPTIES dist/ (default emptyOutDir),
// which deletes dist/server.cjs — packaging then ships a UI with no backend
// and the app boots to a blank window.
const fs = require("fs");
const path = require("path");

// parse-worker.cjs: the document-parsing worker thread (docParse.ts).
// pdf.worker.mjs: pdf.js loads it from beside server.cjs (PDF folder scans).
// dist-manifest.json: sha256 of every dist file, packed inside app.asar and
// checked by electron-main.cjs before the server bundle loads.
const { verifyDist } = require("../shared/verify-dist.cjs");
const required = ["dist/index.html", "dist/server.cjs", "dist/parse-worker.cjs", "dist/pdf.worker.mjs", "dist-manifest.json"];
let ok = true;
for (const f of required) {
  if (!fs.existsSync(path.join(process.cwd(), f))) {
    console.error(`[build-check] MISSING ${f}`);
    ok = false;
  }
}
if (ok) {
  const res = verifyDist(path.join(process.cwd(), "dist"), path.join(process.cwd(), "dist-manifest.json"));
  if (!res.ok) {
    console.error(`[build-check] ${res.reason}:\n  ${res.problems.join("\n  ")}`);
    ok = false;
  }
}
if (!ok) {
  console.error(
    "[build-check] Incomplete build output. Run the FULL build first: npm run build (vite build + esbuild server bundle)."
  );
  process.exit(1);
}
console.log("[build-check] dist OK (index.html + server.cjs + parse-worker.cjs + pdf.worker.mjs present, manifest matches)");
