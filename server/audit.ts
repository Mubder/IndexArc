import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { PortablePaths } from "./paths.js";
import { addLog } from "./logs.js";

// ── Tamper-evident audit trail ─────────────────────────────────────────────
// Security-relevant events (unlocks, failures, restores, consent changes…)
// append to data/audit.log as a hash chain: every record commits to the
// hash of the previous one, so any after-the-fact edit, deletion, or
// reordering breaks verification at that exact record.
//
// Rotation: at MAX_BYTES the file shifts to audit.log.1 (and .1 → .2), and a
// "generation" record chaining from the carried hash is written as the first
// line of the fresh file — the chain continues across generations instead of
// silently restarting at "".
//
// Honest scope (same as the integrity manifest): the chain lives on the same
// disk as the data, so an attacker with unrestricted file write can reforge
// it. What it DOES give: detection of casual tampering, accidental
// truncation, and a compliance-grade "who did what when" trail for the
// machine's legitimate owner. No secret values are ever recorded.

export interface AuditRecord {
  seq: number;
  ts: string;
  event: string;
  detail: string;
  prev: string;
  hash: string;
}

const MAX_BYTES = 5 * 1024 * 1024;
const KEEP_GENERATIONS = 2;
const GENERATION_EVENT = "__generation__";

interface AuditAnchor {
  seq: number;
  hash: string;
  ts: string;
}

function recordHash(rec: Omit<AuditRecord, "hash">): string {
  return crypto
    .createHash("sha256")
    .update(`${rec.seq}|${rec.ts}|${rec.event}|${rec.detail}|${rec.prev}`)
    .digest("hex");
}

function readRecords(file: string): string[] {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export class AuditLog {
  private file: string;
  // Persisted last-written {seq, hash} OUTSIDE the trail files. A fresh
  // process cannot otherwise know a trail ever existed — deleting the whole
  // trail between restarts used to verify as a clean "checked: 0". The anchor
  // lives in config/ (survives data/ trail deletion by a casual attacker who
  // only knows about audit.log*), written atomically after every append.
  private anchorFile: string;
  private nextSeq = 1;
  private lastHash = "";
  private loaded = false;
  private wroteAnything = false;
  private reportedWriteFailure = false;

  constructor(paths: PortablePaths) {
    this.file = path.join(paths.dataDir, "audit.log");
    this.anchorFile = path.join(paths.configDir, "audit.anchor.json");
  }

  private readAnchor(): AuditAnchor | null {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.anchorFile, "utf8")) as AuditAnchor;
      if (parsed && typeof parsed.seq === "number" && typeof parsed.hash === "string" && parsed.seq >= 1) {
        return parsed;
      }
    } catch {}
    return null;
  }

  private writeAnchor() {
    try {
      fs.mkdirSync(path.dirname(this.anchorFile), { recursive: true });
      const anchor: AuditAnchor = { seq: this.nextSeq - 1, hash: this.lastHash, ts: new Date().toISOString() };
      const tmp = `${this.anchorFile}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(anchor), "utf8");
      fs.renameSync(tmp, this.anchorFile);
    } catch {}
  }

  /** Existing generations, OLDEST first: [".2", ".1", ""]. */
  private generationSuffixes(): string[] {
    const suffixes: string[] = [];
    for (let i = KEEP_GENERATIONS; i >= 1; i--) {
      suffixes.push(`.${i}`);
    }
    suffixes.push("");
    return suffixes;
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    // Seed seq/hash across ALL generations (oldest first) so a crash right
    // after rotation doesn't restart the chain at seq 1 / prev "".
    for (const suffix of this.generationSuffixes()) {
      for (const line of readRecords(this.file + suffix)) {
        try {
          const rec = JSON.parse(line) as AuditRecord;
          if (rec && typeof rec.seq === "number") {
            this.nextSeq = Math.max(this.nextSeq, rec.seq + 1);
            this.lastHash = rec.hash || "";
            this.wroteAnything = true;
          }
        } catch {}
      }
    }
    // The anchor may be AHEAD of the trail files (trail deleted between
    // runs): adopt it so seq numbering never restarts, and remember that a
    // trail used to exist (verify() must fail-closed on that state).
    const anchor = this.readAnchor();
    if (anchor && anchor.seq >= this.nextSeq) {
      this.nextSeq = anchor.seq + 1;
      this.lastHash = anchor.hash;
      if (anchor.seq >= 1) this.wroteAnything = true;
    }
  }

  private rotateIfNeeded() {
    try {
      if (!fs.existsSync(this.file)) return;
      if (fs.statSync(this.file).size < MAX_BYTES) return;
      // Shift OLDEST first: .1 → .2, then current → .1. (The old loop renamed
      // the CURRENT file to .2 first, so the trailing rename to .1 hit ENOENT,
      // .1 was never written, and the previous .2 was destroyed.)
      for (let i = KEEP_GENERATIONS - 1; i >= 1; i--) {
        const from = `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        if (fs.existsSync(to)) {
          try {
            fs.unlinkSync(to);
          } catch {}
        }
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(this.file, `${this.file}.1`);
      // Generation header: the fresh file's chain continues from the carried
      // hash instead of restarting at "" (which made verify() report a false
      // break after every rotation).
      const rec: Omit<AuditRecord, "hash"> = {
        seq: this.nextSeq,
        ts: new Date().toISOString(),
        event: GENERATION_EVENT,
        detail: `rotated (previous ${KEEP_GENERATIONS} generation(s) retained)`,
        prev: this.lastHash,
      };
      const full: AuditRecord = { ...rec, hash: recordHash(rec) };
      this.nextSeq++;
      this.lastHash = full.hash;
      fs.appendFileSync(this.file, JSON.stringify(full) + "\n", "utf8");
    } catch (e: any) {
      this.reportWriteFailure("rotate", e);
    }
  }

  private reportWriteFailure(what: string, e: unknown) {
    if (this.reportedWriteFailure) return; // once per process, not per event
    this.reportedWriteFailure = true;
    try {
      addLog("SECURITY", `Audit trail write failed during ${what}: ${e instanceof Error ? e.message : String(e)} — security events may be missing from the trail.`);
    } catch {}
  }

  /** Append an event. Detail must already be redacted (ids, never values). */
  log(event: string, detail: string): void {
    try {
      this.load();
      this.rotateIfNeeded();
      const rec: Omit<AuditRecord, "hash"> = {
        seq: this.nextSeq,
        ts: new Date().toISOString(),
        event,
        detail: String(detail ?? "").slice(0, 500),
        prev: this.lastHash,
      };
      const full: AuditRecord = { ...rec, hash: recordHash(rec) };
      this.nextSeq++;
      this.lastHash = full.hash;
      fs.appendFileSync(this.file, JSON.stringify(full) + "\n", "utf8");
      this.wroteAnything = true;
      this.writeAnchor();
    } catch (e) {
      this.reportWriteFailure("append", e);
    }
  }

  /**
   * Verify the whole chain across all retained generations (oldest → current).
   * The first record of the OLDEST generation is the anchor: its parent
   * generation has been pruned, so its `prev` cannot be checked further back.
   * Everything after it must chain strictly. A missing/unreadable trail on a
   * log that HAS written records is a broken trail (deletion defeats
   * verification otherwise), reported as ok:false.
   */
  verify(): { ok: boolean; checked: number; brokenAtSeq: number | null } {
    this.load();
    const suffixes = this.generationSuffixes().filter((s) => fs.existsSync(this.file + s));
    if (suffixes.length === 0) {
      return this.wroteAnything
        ? { ok: false, checked: 0, brokenAtSeq: null } // trail deleted
        : { ok: true, checked: 0, brokenAtSeq: null }; // never wrote anything
    }
    let checked = 0;
    let prev: string | null = null; // null = at the anchor (oldest generation's first record)
    // A retained generation without a current file means the current
    // generation was deleted (or a crash in the tiny rename→header window,
    // which reportWriteFailure logs) — either way, fail closed.
    if (suffixes.includes(".1") && !suffixes.includes("")) {
      return { ok: false, checked: 0, brokenAtSeq: null };
    }
    for (const suffix of suffixes) {
      for (const line of readRecords(this.file + suffix)) {
        let rec: AuditRecord;
        try {
          rec = JSON.parse(line);
        } catch {
          return { ok: false, checked, brokenAtSeq: null };
        }
        if (prev !== null && rec.prev !== prev) {
          return { ok: false, checked, brokenAtSeq: rec.seq ?? null };
        }
        if (recordHash(rec) !== rec.hash) {
          return { ok: false, checked, brokenAtSeq: rec.seq ?? null };
        }
        prev = rec.hash;
        checked++;
      }
    }
    return { ok: true, checked, brokenAtSeq: null };
  }

  /** Most recent records, newest last. */
  tail(n = 200): AuditRecord[] {
    this.load();
    try {
      const lines = readRecords(this.file);
      return lines.slice(-n).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      }).filter(Boolean) as AuditRecord[];
    } catch {
      return [];
    }
  }
}
