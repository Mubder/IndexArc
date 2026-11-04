import fs from "fs";
import os from "os";
import path from "path";
import { heuristicAnalyze } from "./ai/heuristics.js";

// Redacted diagnostics bundle (R5). Built to be attached to a public bug
// report: it must never carry a secret value, an e-mail address or the
// user's name (home path). Redaction reuses the paste heuristics' own secret
// detectors, then applies blunt pattern rules on top as a backstop.

const LONG_TOKEN = /\b[A-Za-z0-9+/_=-]{24,}\b/g;
const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const URL_CREDS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi;
const KV_SECRET = /\b((?:api[_-]?key|token|secret|password|passwd|pwd|authorization|bearer)\s*[:=]\s*)(?!\[REDACTED)("[^"]*"|'[^']*'|\S+)/gi;
// Well-known credential prefixes too short for the generic long-token rule.
const KNOWN_PREFIX =
  /\b(?:(?:AKIA|ASIA|AGPA|AIDA|AROA)[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{20,}|glpat-[0-9A-Za-z_-]{20,}|xox[abprs]-[0-9A-Za-z-]{10,}|sk-[0-9A-Za-z_-]{16,})\b/g;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactText(input: string, home = os.homedir()): string {
  let s = String(input ?? "");
  if (!s) return s;
  // 1) The heuristics' own detectors (same rules that classify pastes).
  try {
    for (const c of heuristicAnalyze(s)) {
      if (c.family !== "secret" || !c.value || c.value.length < 6) continue;
      s = s.split(c.value).join(`[REDACTED:${c.type || "secret"}]`);
    }
  } catch {}
  // 2) Backstops.
  s = s.replace(KNOWN_PREFIX, "[REDACTED]");
  s = s.replace(URL_CREDS, "$1[REDACTED]@");
  s = s.replace(KV_SECRET, "$1[REDACTED]");
  s = s.replace(EMAIL, "[EMAIL]");
  s = s.replace(LONG_TOKEN, (m) => (/^[0-9a-f-]{36}$/i.test(m) || /^\d+$/.test(m) ? m : "[REDACTED]"));
  // 3) Who the user is: home directory and Windows/Unix user segments.
  if (home) s = s.replace(new RegExp(escapeRe(home), "gi"), "~").replace(new RegExp(escapeRe(home.replace(/\\/g, "/")), "gi"), "~");
  s = s.replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s"']+/gi, "$1<user>").replace(/(\/(?:home|Users)\/)[^/\s"']+/g, "$1<user>");
  return s;
}

/** Redact every string in a JSON-like value. */
export function redactDeep<T>(value: T, home = os.homedir()): T {
  if (typeof value === "string") return redactText(value, home) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, home)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, home);
    return out as T;
  }
  return value;
}

export function buildDiagnostics(input: { health: unknown; logs: Array<{ time: string; type: string; message: string }>; settings: Record<string, unknown>; crashes?: CrashRecord[] }) {
  const home = os.homedir();
  return {
    format: "indexarc-diagnostics",
    version: 1,
    generated_at: new Date().toISOString(),
    note: "Redacted: secret-shaped strings, e-mail addresses and the user's home path are removed. No vault contents are included.",
    environment: {
      app_version: process.env.npm_package_version || process.env.INDEXARC_VERSION || null,
      node: process.versions.node,
      electron: process.versions.electron || null,
      platform: process.platform,
      arch: process.arch,
      os_release: os.release(),
      memory_mb: Math.round(os.totalmem() / 1048576),
      uptime_s: Math.round(process.uptime()),
    },
    health: redactDeep(input.health, home),
    settings: redactDeep(input.settings, home),
    logs: redactDeep(input.logs.slice(-500), home),
    // Already redacted when recorded; redacted again in case rules improved.
    crashes: redactDeep(input.crashes ?? [], home),
  };
}

// ── Opt-in crash log (R5) ─────────────────────────────────────────────────
// logs/crashes.jsonl, newest last, capped. Each line is redacted BEFORE it is
// written, so the file is safe to attach as-is. Never a minidump: those hold
// process memory, which can contain decrypted secrets.
const CRASH_FILE = "crashes.jsonl";
const CRASH_KEEP = 50;

export interface CrashRecord {
  at: string;
  source: string;
  message: string;
  stack: string;
}

export function recordCrash(logsDir: string, c: { source: string; message: string; stack?: string }): void {
  const rec: CrashRecord = {
    at: new Date().toISOString(),
    source: String(c.source).slice(0, 64),
    message: redactText(String(c.message ?? "").slice(0, 2000)),
    stack: redactText(String(c.stack ?? "").slice(0, 8000)),
  };
  const file = path.join(logsDir, CRASH_FILE);
  fs.mkdirSync(logsDir, { recursive: true });
  const prev = readCrashes(logsDir).slice(-(CRASH_KEEP - 1));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, [...prev, rec].map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.renameSync(tmp, file);
}

export function readCrashes(logsDir: string): CrashRecord[] {
  try {
    return fs
      .readFileSync(path.join(logsDir, CRASH_FILE), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as CrashRecord);
  } catch {
    return [];
  }
}
