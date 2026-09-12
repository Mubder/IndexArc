import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { PortablePaths } from "./paths.js";

// ── Tamper-evident audit trail ─────────────────────────────────────────────
// Security-relevant events (unlocks, failures, restores, consent changes…)
// append to data/audit.log as a hash chain: every record commits to the
// hash of the previous one, so any after-the-fact edit, deletion, or
// reordering breaks verification at that exact record.
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

function recordHash(rec: Omit<AuditRecord, "hash">): string {
  return crypto
    .createHash("sha256")
    .update(`${rec.seq}|${rec.ts}|${rec.event}|${rec.detail}|${rec.prev}`)
    .digest("hex");
}

export class AuditLog {
  private file: string;
  private nextSeq = 1;
  private lastHash = "";
  private loaded = false;

  constructor(paths: PortablePaths) {
    this.file = path.join(paths.dataDir, "audit.log");
  }

  private load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const lines = fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as AuditRecord;
          if (rec && typeof rec.seq === "number") {
            this.nextSeq = Math.max(this.nextSeq, rec.seq + 1);
            this.lastHash = rec.hash || "";
          }
        } catch {}
      }
    } catch {}
  }

  private rotateIfNeeded() {
    try {
      if (!fs.existsSync(this.file)) return;
      if (fs.statSync(this.file).size < MAX_BYTES) return;
      for (let i = KEEP_GENERATIONS - 1; i >= 1; i--) {
        const from = i === 1 ? this.file : `${this.file}.${i}`;
        const to = `${this.file}.${i + 1}`;
        if (fs.existsSync(from)) fs.renameSync(from, to);
      }
      fs.renameSync(this.file, `${this.file}.1`);
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
    } catch {}
  }

  /** Verify the whole chain; returns entries checked and the first break. */
  verify(): { ok: boolean; checked: number; brokenAtSeq: number | null } {
    this.load();
    let checked = 0;
    let prev = "";
    try {
      const lines = fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        let rec: AuditRecord;
        try {
          rec = JSON.parse(line);
        } catch {
          return { ok: false, checked, brokenAtSeq: null };
        }
        if (rec.prev !== prev || recordHash(rec) !== rec.hash) {
          return { ok: false, checked, brokenAtSeq: rec.seq ?? null };
        }
        prev = rec.hash;
        checked++;
      }
    } catch {}
    return { ok: true, checked, brokenAtSeq: null };
  }

  /** Most recent records, newest last. */
  tail(n = 200): AuditRecord[] {
    this.load();
    try {
      const lines = fs.readFileSync(this.file, "utf8").split("\n").filter(Boolean);
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
