import { parentPort, workerData } from "worker_threads";
import { parseDocumentInProcess, type DocKind } from "./docParse.js";

// Entry for dist/parse-worker.cjs (see docParse.ts parseDocument). Parses one
// document and posts the result; the parent terminates the thread after.
const { kind, data } = workerData as { kind: DocKind; data: Uint8Array };
parseDocumentInProcess(kind, Buffer.from(data.buffer, data.byteOffset, data.byteLength)).then(
  (r) => parentPort?.postMessage(r),
  (e) => parentPort?.postMessage({ ok: false, reason: String(e?.message || e) })
);
