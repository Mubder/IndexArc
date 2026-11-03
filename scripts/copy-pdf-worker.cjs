// pdf.js (via pdf-parse v2) loads its worker from a file NEXT TO the bundle
// that imports it — dist/server.cjs looks for dist/pdf.worker.mjs. The
// worker is self-contained, so a copy is all it needs. Without it, every PDF
// in a folder scan fails with "Setting up fake worker failed".
const fs = require("fs");
const path = require("path");

// pdf-parse/worker resolves to dist/worker/cjs/index.cjs; the worker sits one up.
const worker = path.join(path.dirname(require.resolve("pdf-parse/worker")), "..", "pdf.worker.mjs");
const dest = path.join(process.cwd(), "dist", "pdf.worker.mjs");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(worker, dest);
console.log(`[build] pdf.worker.mjs → ${path.relative(process.cwd(), dest)}`);
