// Build preflight: the desktop packagers MUST NOT run unless dist/ holds both
// halves of the app. `vite build` alone EMPTIES dist/ (default emptyOutDir),
// which deletes dist/server.cjs — packaging then ships a UI with no backend
// and the app boots to a blank window.
const fs = require("fs");
const path = require("path");

const required = ["dist/index.html", "dist/server.cjs"];
let ok = true;
for (const f of required) {
  if (!fs.existsSync(path.join(process.cwd(), f))) {
    console.error(`[build-check] MISSING ${f}`);
    ok = false;
  }
}
if (!ok) {
  console.error(
    "[build-check] Incomplete build output. Run the FULL build first: npm run build (vite build + esbuild server bundle)."
  );
  process.exit(1);
}
console.log("[build-check] dist OK (index.html + server.cjs present)");
