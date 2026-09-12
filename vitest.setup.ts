// Global test isolation: every vitest file inherits this. Emergency
// snapshots fan out to machine-level locations (%APPDATA%, home) that hold
// the REAL user's history on this machine — test runs must never write
// (and prune) there. Redirect to a per-run temp directory instead.
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-test-emergency-"));
process.env.INDEXARC_EMERGENCY_DIR = dir;
