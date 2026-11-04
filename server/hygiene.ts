import fs from "fs";
import path from "path";
import type { VaultEntry } from "./types.js";

// Secret hygiene (R6.3): expiry dates, rotation reminders, and "where is this
// key used" — a bounded local search of the user's watched folders.

export const EXPIRING_WITHIN_DAYS = 14;
const DAY = 86_400_000;

export type HygieneState = "expired" | "expiring" | "rotation_due" | "ok";

export interface HygieneItem {
  id: string;
  name: string;
  type: string;
  state: Exclude<HygieneState, "ok">;
  due_at: string;
}

/** Validate a hygiene patch from the API. Returns the fields to store. */
export function hygienePatch(body: any, now = Date.now()): Partial<VaultEntry> {
  const out: Partial<VaultEntry> = {};
  if ("expires_at" in (body || {})) {
    if (body.expires_at === null || body.expires_at === "") out.expires_at = undefined;
    else {
      const t = Date.parse(String(body.expires_at));
      if (!Number.isFinite(t)) throw new Error("expires_at must be a date");
      out.expires_at = new Date(t).toISOString();
    }
  }
  if ("rotate_every_days" in (body || {})) {
    if (body.rotate_every_days === null || body.rotate_every_days === "" || body.rotate_every_days === 0) out.rotate_every_days = undefined;
    else {
      const n = Math.round(Number(body.rotate_every_days));
      if (!Number.isFinite(n) || n < 1 || n > 3650) throw new Error("rotate_every_days must be 1–3650");
      out.rotate_every_days = n;
    }
  }
  if (body?.rotated === true) out.last_rotated_at = new Date(now).toISOString();
  return out;
}

export function hygieneState(e: VaultEntry, now = Date.now()): { state: HygieneState; due_at: string | null } {
  if (e.expires_at) {
    const t = Date.parse(e.expires_at);
    if (Number.isFinite(t)) {
      if (t <= now) return { state: "expired", due_at: e.expires_at };
      if (t - now <= EXPIRING_WITHIN_DAYS * DAY) return { state: "expiring", due_at: e.expires_at };
    }
  }
  if (e.rotate_every_days) {
    const base = Date.parse(e.last_rotated_at || e.created_at);
    if (Number.isFinite(base)) {
      const due = base + e.rotate_every_days * DAY;
      if (due <= now) return { state: "rotation_due", due_at: new Date(due).toISOString() };
    }
  }
  return { state: "ok", due_at: null };
}

export function hygieneSummary(entries: VaultEntry[], now = Date.now()) {
  const items: HygieneItem[] = [];
  for (const e of entries) {
    const { state, due_at } = hygieneState(e, now);
    if (state !== "ok" && due_at) items.push({ id: e.id, name: e.name, type: e.type, state, due_at });
  }
  const order: Record<HygieneItem["state"], number> = { expired: 0, rotation_due: 1, expiring: 2 };
  items.sort((a, b) => order[a.state] - order[b.state] || a.due_at.localeCompare(b.due_at));
  const counts = { expired: 0, expiring: 0, rotation_due: 0 };
  for (const i of items) counts[i.state]++;
  return { items, counts, tracked: entries.filter((e) => e.expires_at || e.rotate_every_days).length };
}

// ── Where used ──────────────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", "build", "out", ".next", ".cache", "__pycache__", ".venv", "venv", "target", "vendor"]);
const MAX_FILE_BYTES = 1024 * 1024;

export interface Usage {
  file: string;
  line: number;
}

export interface UsageResult {
  usages: Usage[];
  scanned_files: number;
  truncated: boolean;
}

/**
 * Find files under `roots` that contain `value`. Bounded by file count,
 * file size, hit count and a deadline; binary files are skipped. Synchronous
 * on purpose (the value never leaves this process; no worker message).
 */
export function findUsages(
  value: string,
  roots: string[],
  limits: { maxFiles?: number; maxHits?: number; deadlineMs?: number } = {}
): UsageResult {
  const maxFiles = limits.maxFiles ?? 20_000;
  const maxHits = limits.maxHits ?? 100;
  const deadline = Date.now() + (limits.deadlineMs ?? 10_000);
  const needle = Buffer.from(value, "utf8");
  const usages: Usage[] = [];
  let scanned = 0;
  let truncated = false;
  const stack = [...roots];
  const seen = new Set<string>();
  while (stack.length) {
    if (scanned >= maxFiles || usages.length >= maxHits || Date.now() > deadline) {
      truncated = true;
      break;
    }
    const dir = stack.pop()!;
    let ents: fs.Dirent[];
    try {
      const real = fs.realpathSync(dir);
      if (seen.has(real)) continue;
      seen.add(real);
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name)) stack.push(p);
        continue;
      }
      if (!ent.isFile()) continue;
      if (scanned >= maxFiles || usages.length >= maxHits) {
        truncated = true;
        break;
      }
      let buf: Buffer;
      try {
        if (fs.statSync(p).size > MAX_FILE_BYTES) continue;
        buf = fs.readFileSync(p);
      } catch {
        continue;
      }
      scanned++;
      if (buf.subarray(0, 8000).includes(0)) continue; // binary
      let at = buf.indexOf(needle);
      while (at >= 0 && usages.length < maxHits) {
        let line = 1;
        for (let i = 0; i < at; i++) if (buf[i] === 10) line++;
        usages.push({ file: p, line });
        at = buf.indexOf(needle, at + needle.length);
      }
    }
  }
  return { usages, scanned_files: scanned, truncated };
}
