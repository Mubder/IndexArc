import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import * as mammoth from "mammoth";

// Binary document parsing (.docx/.pdf/.xlsx). In the packaged app this runs
// in a worker thread with its own heap limit (R3.1): a hostile file that
// blows up a parser is terminated with the worker, not the vault server.

export type ParseResult = { ok: true; text: string } | { ok: false; reason: string };
export type DocKind = ".docx" | ".pdf" | ".xlsx";

/** Hard ceiling for one parser call — a pathological file must not hang a scan. */
export const PARSER_TIMEOUT_MS = 30_000;
/** Heap ceiling for the parse worker (old generation). */
export const PARSER_HEAP_MB = 512;

/** Rejects when `work` takes longer than `ms`; the caller reports a skip. */
export function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    timer.unref?.();
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

const LABEL: Record<DocKind, string> = { ".docx": "DOCX", ".pdf": "PDF", ".xlsx": "XLSX" };

/** Parses in the current thread. Size and zip-budget checks happen before this. */
export async function parseDocumentInProcess(kind: DocKind, buf: Buffer): Promise<ParseResult> {
  try {
    let text = "";
    if (kind === ".docx") {
      const res = await withTimeout(mammoth.extractRawText({ buffer: buf }), PARSER_TIMEOUT_MS, "DOCX parse");
      text = (res.value || "").trim();
    } else if (kind === ".pdf") {
      // pdf-parse v2 exports a class (the v1 function call threw for every
      // PDF — a stale local type stub hid it from the compiler).
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: new Uint8Array(buf) });
      try {
        text = ((await withTimeout(parser.getText(), PARSER_TIMEOUT_MS, "PDF parse")).text || "").trim();
      } finally {
        await parser.destroy().catch(() => {});
      }
    } else {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await withTimeout(workbook.xlsx.load(buf as any), PARSER_TIMEOUT_MS, "XLSX parse");
      const parts: string[] = [];
      workbook.eachSheet((sheet) => {
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
      text = parts.join("\n").trim();
    }
    return text ? { ok: true, text } : { ok: false, reason: "No extractable text" };
  } catch (e: any) {
    return { ok: false, reason: `${LABEL[kind]} read failed: ${e.message}` };
  }
}

/**
 * The bundled worker (dist/parse-worker.cjs) sits beside the server bundle.
 * Source runs (tsx, vitest) have no bundle and parse in-process.
 */
function bundledWorkerPath(): string | null {
  const dirs = [process.env.INDEXARC_DIST_DIR, typeof __dirname !== "undefined" ? __dirname : undefined];
  for (const d of dirs) {
    if (!d) continue;
    const p = path.join(d, "parse-worker.cjs");
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Parses in a worker thread with a heap limit and a hard deadline. On
 * timeout the worker is terminated — the parser actually stops, unlike a
 * bare timeout race. Falls back to in-process parsing without a bundle.
 */
export function parseDocument(
  kind: DocKind,
  buf: Buffer,
  opts: { workerPath?: string | null; timeoutMs?: number; heapMb?: number } = {}
): Promise<ParseResult> {
  const workerPath = opts.workerPath === undefined ? bundledWorkerPath() : opts.workerPath;
  if (!workerPath) return parseDocumentInProcess(kind, buf);
  const timeoutMs = opts.timeoutMs ?? PARSER_TIMEOUT_MS + 5_000;
  const label = LABEL[kind];

  return new Promise<ParseResult>((resolve) => {
    let settled = false;
    const finish = (r: ParseResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(r);
    };
    // Copy into a fresh ArrayBuffer: a pooled Buffer shares memory with
    // unrelated data, which must not be transferred to (or seen by) the worker.
    const data = new Uint8Array(buf.byteLength);
    data.set(buf);
    const worker = new Worker(workerPath, {
      workerData: { kind, data },
      transferList: [data.buffer],
      resourceLimits: { maxOldGenerationSizeMb: opts.heapMb ?? PARSER_HEAP_MB, maxYoungGenerationSizeMb: 64 },
      stdout: true,
      stderr: true,
    });
    const timer = setTimeout(
      () => finish({ ok: false, reason: `${label} parse timed out after ${Math.round(timeoutMs / 1000)}s` }),
      timeoutMs
    );
    worker.on("message", (r: ParseResult) => finish(r));
    worker.on("error", (e: any) =>
      finish({
        ok: false,
        reason:
          e?.code === "ERR_WORKER_OUT_OF_MEMORY"
            ? `${label} parse exceeded the ${opts.heapMb ?? PARSER_HEAP_MB}MB memory limit`
            : `${label} read failed: ${e?.message || e}`,
      })
    );
    worker.on("exit", (code) => finish({ ok: false, reason: `${label} parser stopped (exit ${code})` }));
  });
}
