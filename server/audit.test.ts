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

  // AUD-005 regressions: the old rotation renamed the CURRENT file to .2
  // first (so .1 was never written and the previous .2 was destroyed), and
  // verify() seeded prev="" so every post-rotation file reported a FALSE
  // "chain broken" alarm.
  // Fills past the 5 MiB rotation threshold — genuinely long-running.
  it("rotates oldest-first, keeps both generations, and continues the chain across them", { timeout: 30_000 }, () => {
    const file = path.join(paths.dataDir, "audit.log");
    // Fill until the 5 MiB threshold triggers at least one rotation.
    let guard = 0;
    audit.log("fill", "x".repeat(400)); // create the file first
    while (!fs.existsSync(`${file}.1`) && guard++ < 60000) {
      audit.log("fill", "x".repeat(400));
    }
    expect(fs.existsSync(`${file}.1`)).toBe(true); // previous generation retained
    expect(fs.existsSync(file)).toBe(true); // fresh current file exists (old bug: .1 never written)

    const currentLines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    const firstLine = JSON.parse(currentLines[0]);
    expect(firstLine.event).toBe("__generation__");

    // Chain continuity: the generation header commits to the LAST record of
    // the previous generation, and seq numbering never restarts.
    const prevGenLines = fs.readFileSync(`${file}.1`, "utf8").split("\n").filter(Boolean);
    const lastOfPrevGen = JSON.parse(prevGenLines[prevGenLines.length - 1]);
    expect(firstLine.prev).toBe(lastOfPrevGen.hash);
    expect(firstLine.seq).toBe(lastOfPrevGen.seq + 1);

    // Verification passes ACROSS generations and counts every record.
    const v = audit.verify();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(prevGenLines.length + currentLines.length);
  });

  it("detects deletion of the whole trail instead of an all-clear", () => {
    audit.log("vault.unlock", "success");
    audit.log("vault.lock", "manual");
    fs.unlinkSync(path.join(paths.dataDir, "audit.log"));
    // Same instance, as the running app uses — it knows it wrote records.
    expect(audit.verify().ok).toBe(false);
  });

  it("detects deletion of only the current generation", () => {
    audit.log("vault.unlock", "success");
    const file = path.join(paths.dataDir, "audit.log");
    fs.renameSync(file, `${file}.1`); // simulate: current generation gone, .1 left
    expect(audit.verify().ok).toBe(false);
  });

  // Audit-anchor regressions: a FRESH process cannot see in-memory state —
  // before the persisted anchor, deleting the whole trail between restarts
  // verified as a clean "checked: 0" and a new log() restarted the chain at
  // seq 1 with prev "".
  it("a fresh instance detects trail deletion via the persisted anchor", () => {
    audit.log("vault.unlock", "success");
    audit.log("vault.lock", "manual");
    const anchor = JSON.parse(fs.readFileSync(path.join(paths.configDir, "audit.anchor.json"), "utf8"));
    expect(anchor.seq).toBe(2); // anchor tracks the last written record
    fs.rmSync(path.join(paths.dataDir, "audit.log"));
    expect(new AuditLog(paths).verify().ok).toBe(false);
  });

  it("a fresh instance CONTINUES the chain (seq + prev hash) after trail deletion", () => {
    audit.log("vault.unlock", "success");
    const last = audit.tail(1)[0];
    fs.rmSync(path.join(paths.dataDir, "audit.log"));

    const revived = new AuditLog(paths);
    revived.log("vault.lock", "manual");
    const records = revived.tail(10);
    expect(records[0].seq).toBe(last.seq + 1); // no seq restart
    expect(records[0].prev).toBe(last.hash); // chain continues from the anchor
    expect(revived.verify().checked).toBe(1); // the rebuilt file itself verifies
  });
});
