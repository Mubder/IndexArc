import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { VaultStore } from "../store.js";
import type {
  AnalyzeCandidate,
  AppSettings,
  FolderScanSession,
  FolderScanSummary,
  ProcessedFile,
  SkippedFile,
} from "../types.js";
import { heuristicAnalyze } from "../ai/heuristics.js";
import { analyzePaste } from "../ai/providers.js";
import { addLog } from "../logs.js";

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".svn",
  ".hg",
  "dist",
  "build",
  "coverage",
  ".next",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  ".idea",
  ".vscode",
  "dist-desktop",
]);

const SUPPORTED_EXT = new Set([
  ".env",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".jsonc",
  ".log",
  ".yml",
  ".yaml",
  ".ini",
  ".cfg",
  ".conf",
  ".config",
  ".csv",
  ".tsv",
  ".toml",
  ".properties",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".bat",
  ".cmd",
  ".py",
  ".js",
  ".ts",
  ".jsx",
  ".tsx",
  ".mjs",
  ".cjs",
  ".java",
  ".go",
  ".rs",
  ".rb",
  ".php",
  ".sql",
  ".xml",
  ".html",
  ".css",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.example",
  ".key",
  ".pem",
  ".crt",
  ".cer",
  ".secret",
  ".token",
  ".credentials",
]);

// extensionless names often used for secrets/config
const SUPPORTED_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".env.example",
  "dockerfile",
  "makefile",
  "procfile",
  "credentials",
  "secrets",
  "tokens",
]);

const MAX_FILE_BYTES = 512 * 1024; // 512 KB per file for extract
const MAX_FILES = 500;

function isSupportedFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (SUPPORTED_NAMES.has(base)) return true;
  if (base.startsWith(".env")) return true;
  const ext = path.extname(base).toLowerCase();
  return SUPPORTED_EXT.has(ext);
}

function isProbablyBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true;
  }
  // high ratio of non-text
  let weird = 0;
  for (let i = 0; i < n; i++) {
    const c = buf[i];
    if (c < 7 || (c > 14 && c < 32 && c !== 9 && c !== 10 && c !== 13)) weird++;
  }
  return n > 0 && weird / n > 0.3;
}

function readTextFile(filePath: string): { ok: true; text: string } | { ok: false; reason: string } {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { ok: false, reason: "Not a file" };
    if (stat.size === 0) return { ok: false, reason: "Empty file" };
    if (stat.size > MAX_FILE_BYTES) {
      return { ok: false, reason: `Too large (${Math.round(stat.size / 1024)}KB > ${MAX_FILE_BYTES / 1024}KB limit)` };
    }
    const buf = fs.readFileSync(filePath);
    if (isProbablyBinary(buf)) return { ok: false, reason: "Binary / non-text file" };
    let text = buf.toString("utf-8");
    // strip BOM
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // JSON pretty for key extraction
    if (path.extname(filePath).toLowerCase() === ".json") {
      try {
        const obj = JSON.parse(text);
        text = flattenJson(obj);
      } catch {
        /* keep raw */
      }
    }
    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, reason: e.message || "Read failed" };
  }
}

/** Flatten JSON to KEY=value lines for heuristic multi-extract */
function flattenJson(obj: unknown, prefix = ""): string {
  const lines: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      const key = p || "value";
      lines.push(`${key}=${String(v)}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, p ? `${p}_${i}` : String(i)));
      return;
    }
    if (typeof v === "object") {
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        const next = p ? `${p}_${k}` : k;
        walk(val, next);
      }
    }
  };
  walk(obj, prefix);
  return lines.join("\n");
}

export function walkFiles(rootDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) break;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORE_DIRS.has(ent.name.toLowerCase())) continue;
        if (ent.name.startsWith(".") && ent.name !== ".env") continue;
        walk(full);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  };
  walk(rootDir);
  return out;
}

function buildBrief(summary: FolderScanSummary, skipped: SkippedFile[]): string {
  const lines = [
    `Scanned folder: ${summary.folder_path}`,
    `Found ${summary.files_found} file(s) · processed ${summary.files_processed} · skipped ${summary.files_skipped}`,
    `Extracted ${summary.candidates_total} candidate(s): ${summary.candidates_ready} ready to save, ${summary.candidates_needs_review} need your type/name`,
    `Engine: ${summary.provider_used} · ${summary.duration_ms}ms`,
  ];
  if (skipped.length) {
    const reasons = new Map<string, number>();
    for (const s of skipped) {
      reasons.set(s.reason, (reasons.get(s.reason) || 0) + 1);
    }
    lines.push("Skipped breakdown:");
    for (const [reason, n] of reasons) {
      lines.push(`  · ${n}× ${reason}`);
    }
  }
  lines.push(
    "Review below: save ready items, identify incomplete ones, or discard what you do not want."
  );
  return lines.join("\n");
}

export interface ScanOptions {
  folderPath: string;
  /** Use AI per file (slow). Default false = heuristics only for bulk reliability. */
  useAi?: boolean;
  watching?: boolean;
}

export async function scanFolder(
  store: VaultStore,
  settings: AppSettings,
  options: ScanOptions
): Promise<FolderScanSession> {
  const started = Date.now();
  const folderPath = path.resolve(options.folderPath.trim());

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    throw new Error("Folder path is invalid or not a directory");
  }

  addLog("FOLDER", `Starting scan: ${folderPath}`);

  const allFiles = walkFiles(folderPath);
  const skipped: SkippedFile[] = [];
  const processed: ProcessedFile[] = [];
  const candidates: AnalyzeCandidate[] = [];
  let provider_used = "heuristic";

  for (const filePath of allFiles) {
    const name = path.basename(filePath);
    if (!isSupportedFile(filePath)) {
      skipped.push({
        path: filePath,
        name,
        reason: `Unsupported type (${path.extname(name) || "no extension"})`,
      });
      continue;
    }

    const read = readTextFile(filePath);
    if (read.ok === false) {
      skipped.push({ path: filePath, name, reason: read.reason });
      continue;
    }

    let fileCandidates: AnalyzeCandidate[] = [];
    try {
      if (options.useAi) {
        const result = await analyzePaste(read.text, settings);
        fileCandidates = result.candidates;
        provider_used = result.provider_used;
      } else {
        fileCandidates = heuristicAnalyze(read.text);
        provider_used = "heuristic";
      }
    } catch (e: any) {
      skipped.push({ path: filePath, name, reason: `Extract failed: ${e.message}` });
      continue;
    }

    // attach source + default decision
    fileCandidates = fileCandidates.map((c) => ({
      ...c,
      temp_id: c.temp_id || randomUUID(),
      source_file: filePath,
      source_name: name,
      labels: [...new Set([...(c.labels || []), name, path.relative(folderPath, filePath)])],
      decision: "pending" as const,
      // Prefer file-stem as name hint when secret needs name
      name:
        c.name && c.name !== "unnamed"
          ? c.name
          : c.family === "secret" || c.family === "unknown"
            ? suggestNameFromFile(name, c)
            : c.name || name,
    }));

    // recompute ready after name suggestion
    fileCandidates = fileCandidates.map((c) => {
      const needs_type =
        (c.family === "secret" || c.family === "unknown") && !String(c.type || "").trim();
      const needs_name =
        (c.family === "secret" || c.family === "unknown") &&
        (!String(c.name || "").trim() || c.name === "unnamed");
      return {
        ...c,
        needs_type,
        needs_name,
        ready: !needs_type && !needs_name,
        family: needs_type ? "unknown" : c.family,
      };
    });

    if (!fileCandidates.length) {
      skipped.push({
        path: filePath,
        name,
        reason: "No extractable secrets/commands/notes found",
      });
      continue;
    }

    const ready = fileCandidates.filter((c) => c.ready).length;
    const needs = fileCandidates.length - ready;
    let size = 0;
    try {
      size = fs.statSync(filePath).size;
    } catch {
      /* ignore */
    }

    processed.push({
      path: filePath,
      name,
      size,
      candidates_found: fileCandidates.length,
      ready,
      needs_review: needs,
    });
    candidates.push(...fileCandidates);
  }

  // Dedupe by value across files (keep first / higher confidence)
  const deduped = dedupeCandidates(candidates);

  const summary: FolderScanSummary = {
    folder_path: folderPath,
    files_found: allFiles.length,
    files_processed: processed.length,
    files_skipped: skipped.length,
    candidates_total: deduped.length,
    candidates_ready: deduped.filter((c) => c.ready).length,
    candidates_needs_review: deduped.filter((c) => !c.ready).length,
    candidates_discarded: 0,
    provider_used,
    duration_ms: Date.now() - started,
  };

  const session: FolderScanSession = {
    id: randomUUID(),
    folder_path: folderPath,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    status: "review",
    watching: !!options.watching,
    summary,
    processed_files: processed,
    skipped_files: skipped,
    candidates: deduped,
    brief: buildBrief(summary, skipped),
  };

  store.saveScanSession(session);
  addLog(
    "FOLDER",
    `Scan done: ${summary.files_processed} files, ${summary.candidates_total} candidates (${summary.candidates_needs_review} need review)`
  );
  return session;
}

function suggestNameFromFile(fileName: string, c: AnalyzeCandidate): string {
  if (c.name && c.name.trim() && c.name !== "unnamed") return c.name;
  const stem = fileName.replace(/\.[^.]+$/, "").replace(/^\./, "");
  if (c.labels?.[0] && /^[A-Za-z_][A-Za-z0-9_]*$/.test(c.labels[0])) {
    return c.labels[0].toLowerCase();
  }
  return stem || "";
}

function dedupeCandidates(list: AnalyzeCandidate[]): AnalyzeCandidate[] {
  const map = new Map<string, AnalyzeCandidate>();
  for (const c of list) {
    const key = c.value.trim();
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || (c.ready && !prev.ready) || c.confidence > prev.confidence) {
      map.set(key, c);
    }
  }
  return [...map.values()];
}

/** Scan a single file and merge into an existing review session (for live watch). */
export async function scanFileIntoSession(
  store: VaultStore,
  settings: AppSettings,
  sessionId: string,
  filePath: string,
  useAi = false
): Promise<FolderScanSession | null> {
  const session = store.getScanSession(sessionId);
  if (!session || session.status !== "review") return null;
  if (!isSupportedFile(filePath)) return session;

  const name = path.basename(filePath);
  const read = readTextFile(filePath);
  if (read.ok === false) {
    const skipped = [
      ...session.skipped_files.filter((s) => s.path !== filePath),
      { path: filePath, name, reason: read.reason },
    ];
    return store.updateScanSession(sessionId, {
      skipped_files: skipped,
      summary: {
        ...session.summary,
        files_skipped: skipped.length,
      },
    });
  }

  let fileCandidates: AnalyzeCandidate[] = [];
  if (useAi) {
    const result = await analyzePaste(read.text, settings);
    fileCandidates = result.candidates;
  } else {
    fileCandidates = heuristicAnalyze(read.text);
  }

  fileCandidates = fileCandidates.map((c) => {
    const needs_type =
      (c.family === "secret" || c.family === "unknown") && !String(c.type || "").trim();
    const needs_name =
      (c.family === "secret" || c.family === "unknown") && !String(c.name || "").trim();
    return {
      ...c,
      temp_id: randomUUID(),
      source_file: filePath,
      source_name: name,
      labels: [...new Set([...(c.labels || []), name])],
      decision: "pending" as const,
      name: c.name || suggestNameFromFile(name, c),
      needs_type,
      needs_name,
      ready: !needs_type && !needs_name,
    };
  });

  // replace prior candidates from same file, keep others
  const others = session.candidates.filter((c) => c.source_file !== filePath);
  const merged = dedupeCandidates([...others, ...fileCandidates]);

  const processed = [
    ...session.processed_files.filter((p) => p.path !== filePath),
    {
      path: filePath,
      name,
      size: fs.statSync(filePath).size,
      candidates_found: fileCandidates.length,
      ready: fileCandidates.filter((c) => c.ready).length,
      needs_review: fileCandidates.filter((c) => !c.ready).length,
    },
  ];

  const summary: FolderScanSummary = {
    ...session.summary,
    files_processed: processed.length,
    candidates_total: merged.length,
    candidates_ready: merged.filter((c) => c.ready).length,
    candidates_needs_review: merged.filter((c) => !c.ready).length,
  };

  return store.updateScanSession(sessionId, {
    candidates: merged,
    processed_files: processed,
    summary,
    brief: buildBrief(summary, session.skipped_files),
  });
}
