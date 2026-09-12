import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { AuditLog } from "./audit.js";
import { ensurePortableLayout } from "./paths.js";

// The audit trail is a hash chain: appending works, verification passes, and
// any after-the-fact edit/deletion/reorder must break verification exactly
// at the tampered record (audit P2 requirement).
describe("hash-chained audit log", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let audit: AuditLog;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-audit-test-"));
    paths = ensurePortableLayout(tmpDir);
    audit = new AuditLog(paths);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("appends records and verifies a clean chain", () => {
    audit.log("vault.unlock", "success");
    audit.log("vault.lock", "manual");
    audit.log("note.protect", "tab=abc");

    const v = audit.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(3);

    const tail = audit.tail(10);
    expect(tail.length).toBe(3);
    expect(tail[0].event).toBe("vault.unlock");
    expect(tail[2].seq).toBe(tail[1].seq + 1);
    // No record ever carries a secret value — detail is a redacted string.
    expect(typeof tail[0].detail).toBe("string");
  });

  it("detects an edited record at the exact sequence", () => {
    audit.log("vault.unlock", "success");
    audit.log("vault.lock", "manual");
    audit.log("note.unprotect", "tab=abc");

    // Tamper: rewrite the second record's detail.
    const file = path.join(paths.dataDir, "audit.log");
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const rec = JSON.parse(lines[1]);
    rec.detail = "nothing happened here";
    lines[1] = JSON.stringify(rec);
    fs.writeFileSync(file, lines.join("\n") + "\n");

    const tampered = new AuditLog(paths);
    const v = tampered.verify();
    expect(v.ok).toBe(false);
    expect(v.brokenAtSeq).toBe(rec.seq);
  });

  it("detects a deleted middle record", () => {
    audit.log("a", "1");
    audit.log("b", "2");
    audit.log("c", "3");

    const file = path.join(paths.dataDir, "audit.log");
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    lines.splice(1, 1); // delete the middle record
    fs.writeFileSync(file, lines.join("\n") + "\n");

    const v = new AuditLog(paths).verify();
    expect(v.ok).toBe(false);
  });

  it("continues the chain across instances", () => {
    audit.log("vault.unlock", "success");
    const second = new AuditLog(paths);
    second.log("vault.lock", "manual");
    const v = second.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(2);
    expect(second.tail(2)[1].seq).toBe(2);
  });
});
