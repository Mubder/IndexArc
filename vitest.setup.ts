// Global test isolation: every vitest file inherits this. Emergency
// snapshots fan out to machine-level locations (%APPDATA%, home) that hold
// the REAL user's history on this machine — test runs must never write
// (and prune) there. Redirect to a per-run temp directory instead.
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-test-emergency-"));
process.env.INDEXARC_EMERGENCY_DIR = dir;

// SQLite keeps vault.db open; on Windows an open file cannot be deleted, so
// close every record database before a test removes its temp root.
import { closeAllRecordDbs } from "./server/db/recordDb";
for (const name of ["rmSync", "rmdirSync"] as const) {
  const orig = fs[name] as (...a: unknown[]) => unknown;
  (fs as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
    closeAllRecordDbs();
    return orig.apply(fs, args);
  };
}
const origRm = fs.promises.rm;
fs.promises.rm = ((...args: Parameters<typeof origRm>) => {
  closeAllRecordDbs();
  return origRm.apply(fs.promises, args);
}) as typeof origRm;
