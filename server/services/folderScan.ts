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
import * as mammoth from "mammoth";

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
  ".docx",
  ".pdf",
  ".xlsx",
  ".jsonl",
  ".ndjson",
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

async function readTextFile(filePath: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) return { ok: false, reason: "Not a file" };
    if (stat.size === 0) return { ok: false, reason: "Empty file" };
    if (stat.size > MAX_FILE_BYTES) {
      return { ok: false, reason: `Too large (${Math.round(stat.size / 1024)}KB > ${MAX_FILE_BYTES / 1024}KB limit)` };
    }
    const buf = await fs.promises.readFile(filePath);
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

const MAX_DOC_BYTES = 5 * 1024 * 1024; // 5MB for binary documents

/** True for a directory name the scan (and the watcher) never descends into. */
export function isIgnoredDirName(name: string): boolean {
  return IGNORE_DIRS.has(name.toLowerCase()) || (name.startsWith(".") && name !== ".env");
}

// Zip-bomb guard for .docx/.xlsx (both are zip containers): a 5 MB file can
// inflate to gigabytes inside mammoth/exceljs, which buffer it all in memory.
export const MAX_ZIP_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 5000;
// A hostile document can also keep a parser busy forever.
export const PARSER_TIMEOUT_MS = 30_000;

/**
 * Sums the declared uncompressed sizes from a zip's central directory.
 * Returns a reason string when the archive is malformed, ZIP64 (never
 * produced by Office for files this small), or over budget; null when OK.
 */
export function zipBudgetProblem(buf: Buffer): string | null {
  // End-of-central-directory record: last 22 bytes + up to 64 KB comment.
  const min = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return "Not a valid Office (zip) document";
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) return "ZIP64 documents are not supported";
  if (count > MAX_ZIP_ENTRIES) return `Too many parts (${count})`;
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return "Corrupt zip directory";
    const size = buf.readUInt32LE(p + 24);
    if (size === 0xffffffff) return "ZIP64 documents are not supported";
    total += size;
    if (total > MAX_ZIP_UNCOMPRESSED_BYTES) {
      return `Expands beyond ${MAX_ZIP_UNCOMPRESSED_BYTES / 1024 / 1024}MB — refusing (possible zip bomb)`;
    }
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  return null;
}

/** Rejects when `work` takes longer than `ms`; the caller reports a skip. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Extract searchable text from a file. Handles binary document formats
 * (.docx/.pdf/.xlsx) and JSON-Lines (.jsonl/.ndjson); falls back to the
 * plain-text reader for everything else.
 */
export async function extractText(
  filePath: string
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
  const ext = path.extname(filePath).toLowerCase();

  // JSON Lines / NDJSON: one JSON object per line
  if (ext === ".jsonl" || ext === ".ndjson") {
    const r = await readTextFile(filePath);
    if (!r.ok) return r;
    const out = r.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        try {
          return flattenJson(JSON.parse(l));
        } catch {
          return l;
        }
      })
      .join("\n");
    return { ok: true, text: out };
  }

  // Microsoft Word (.docx)
  if (ext === ".docx") {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size === 0) return { ok: false, reason: "Empty file" };
      if (stat.size > MAX_DOC_BYTES)
        return { ok: false, reason: `Too large (${Math.round(stat.size / 1024 / 1024)}MB)` };
      const buf = await fs.promises.readFile(filePath);
      const zipProblem = zipBudgetProblem(buf);
      if (zipProblem) return { ok: false, reason: zipProblem };
      const res = await withTimeout(mammoth.extractRawText({ buffer: buf }), PARSER_TIMEOUT_MS, "DOCX parse");
      const text = (res.value || "").trim();
      return text ? { ok: true, text } : { ok: false, reason: "No extractable text" };
    } catch (e: any) {
      return { ok: false, reason: `DOCX read failed: ${e.message}` };
    }
  }

  // PDF
  if (ext === ".pdf") {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size === 0) return { ok: false, reason: "Empty file" };
      if (stat.size > MAX_DOC_BYTES)
        return { ok: false, reason: `Too large (${Math.round(stat.size / 1024 / 1024)}MB)` };
      const buf = await fs.promises.readFile(filePath);
      // pdf-parse v2 exports a class (the v1 function call threw for every
      // PDF — a stale local type stub hid it from the compiler).
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      let text = "";
      try {
        text = ((await withTimeout(parser.getText(), PARSER_TIMEOUT_MS, "PDF parse")).text || "").trim();
      } finally {
        await parser.destroy().catch(() => {});
      }
      return text ? { ok: true, text } : { ok: false, reason: "No extractable text" };
    } catch (e: any) {
      return { ok: false, reason: `PDF read failed: ${e.message}` };
    }
  }

  // Excel (.xlsx)
  if (ext === ".xlsx") {
    try {
      const stat = await fs.promises.stat(filePath);
      if (stat.size === 0) return { ok: false, reason: "Empty file" };
      if (stat.size > MAX_DOC_BYTES)
        return { ok: false, reason: `Too large (${Math.round(stat.size / 1024 / 1024)}MB)` };
      const buf = await fs.promises.readFile(filePath);
      const zipProblem = zipBudgetProblem(buf);
      if (zipProblem) return { ok: false, reason: zipProblem };
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await withTimeout(workbook.xlsx.load(buf as any), PARSER_TIMEOUT_MS, "XLSX parse");
      const parts: string[] = [];
      workbook.eachSheet((sheet, sheetId) => {
        parts.push(`## Sheet: ${sheet.name}`);
        const rows: string[] = [];
        sheet.eachRow({ includeEmpty: false }, (row) => {
          const vals: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            vals.push(String(cell.value ?? ""));
          });
          rows.push(vals.join(","));
        });
        parts.push(rows.join("\n"));
      });
      const text = parts.join("\n").trim();
      return text ? { ok: true, text } : { ok: false, reason: "No extractable text" };
    } catch (e: any) {
      return { ok: false, reason: `XLSX read failed: ${e.message}` };
    }
  }

  // Default: plain-text file
  return readTextFile(filePath);
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

// Traversal budgets (AUD-017): MAX_FILES caps COLLECTED files only — a tree
// of empty/unsupported directories used to be walked to exhaustion
// (scanning C:\ traversed the whole drive), synchronously on the server's
// event loop. Depth + directory budgets bound the walk itself; the walk is
// async and yields to the event loop between directories so SSE, auto-lock
// and every API call stay responsive during a scan.
const MAX_DEPTH = 12;
const MAX_DIRS = 4000;

const yieldToEventLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

export async function walkFiles(
  rootDir: string
): Promise<{ files: string[]; truncated: boolean }> {
  const out: string[] = [];
  let dirsVisited = 0;
  let truncated = false;

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (out.length >= MAX_FILES) return;
    if (depth > MAX_DEPTH || dirsVisited >= MAX_DIRS) {
      truncated = true;
      return;
    }
    dirsVisited++;
    // Yield between directories: a huge tree must not monopolize the loop.
    await yieldToEventLoop();
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (out.length >= MAX_FILES) {
        truncated = true;
        break;
      }
      const full = path.join(dir, ent.name);
      // NOTE: Dirent.isDirectory/isFile are false for symlinks — symlinked
      // files/dirs are skipped (never followed), which is the traversal-safe
      // behavior for a secret scanner.
      if (ent.isDirectory()) {
        if (isIgnoredDirName(ent.name)) continue;
        await walk(full, depth + 1);
      } else if (ent.isFile()) {
        out.push(full);
      }
    }
  };
  await walk(rootDir, 0);
  return { files: out, truncated };
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

  let rootStat: fs.Stats;
  try {
    rootStat = await fs.promises.stat(folderPath);
  } catch {
    throw new Error("Folder path is invalid or not a directory");
  }
  if (!rootStat.isDirectory()) {
    throw new Error("Folder path is invalid or not a directory");
  }

  addLog("FOLDER", `Starting scan: ${folderPath}`);

  const { files: allFiles, truncated: walkTruncated } = await walkFiles(folderPath);
  const skipped: SkippedFile[] = [];
  if (walkTruncated) {
    skipped.push({
      path: folderPath,
      name: path.basename(folderPath),
      reason: `Traversal budget reached (max ${MAX_FILES} files / ${MAX_DEPTH} levels / ${MAX_DIRS} folders) — scan is partial`,
    });
  }
  const processed: ProcessedFile[] = [];
  const candidates: AnalyzeCandidate[] = [];
  let provider_used = "heuristic";

  for (const filePath of allFiles) {
    // Yield between files so a 500-file scan interleaves with other requests.
    await yieldToEventLoop();
    const name = path.basename(filePath);
    if (!isSupportedFile(filePath)) {
      skipped.push({
        path: filePath,
        name,
        reason: `Unsupported type (${path.extname(name) || "no extension"})`,
      });
      continue;
    }

    const read = await extractText(filePath);
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
      size = (await fs.promises.stat(filePath)).size;
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
  const read = await extractText(filePath);
  if (read.ok === false) {
    // Re-read: other files may have updated the session while we awaited.
    const session = store.getScanSession(sessionId);
    if (!session || session.status !== "review") return null;
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

  const size = await fs.promises.stat(filePath).then((st) => st.size).catch(() => 0);

  // From here to updateScanSession there is NO await: merge into the session
  // as it is NOW. Merging into the copy read before extraction let two files
  // changed together each write "others as of the start + mine", silently
  // dropping the other file's candidates (audit finding).
  const current = store.getScanSession(sessionId);
  if (!current || current.status !== "review") return null;

  // replace prior candidates from same file, keep others
  const others = current.candidates.filter((c) => c.source_file !== filePath);
  const merged = dedupeCandidates([...others, ...fileCandidates]);

  const processed = [
    ...current.processed_files.filter((p) => p.path !== filePath),
    {
      path: filePath,
      name,
      size,
      candidates_found: fileCandidates.length,
      ready: fileCandidates.filter((c) => c.ready).length,
      needs_review: fileCandidates.filter((c) => !c.ready).length,
    },
  ];

  const summary: FolderScanSummary = {
    ...current.summary,
    files_processed: processed.length,
    candidates_total: merged.length,
    candidates_ready: merged.filter((c) => c.ready).length,
    candidates_needs_review: merged.filter((c) => !c.ready).length,
  };

  return store.updateScanSession(sessionId, {
    candidates: merged,
    processed_files: processed,
    summary,
    brief: buildBrief(summary, current.skipped_files),
  });
}
