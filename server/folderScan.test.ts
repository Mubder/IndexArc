import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { walkFiles, extractText } from "./services/folderScan.js";

// AUD-017 regression: the walk used to be synchronous and unbounded in
// directories/depth — MAX_FILES only capped COLLECTED files, so scanning a
// deep or directory-heavy tree froze the server's event loop to exhaustion.
describe("walkFiles traversal budgets", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-walk-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("collects files from a normal tree without truncation", async () => {
    fs.mkdirSync(path.join(tmpDir, "src", "util"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "a.env"), "TOKEN=x\n");
    fs.writeFileSync(path.join(tmpDir, "src", "b.txt"), "hello");
    fs.writeFileSync(path.join(tmpDir, "src", "util", "c.json"), "{}");

    const { files, truncated } = await walkFiles(tmpDir);
    expect(truncated).toBe(false);
    expect(files.length).toBe(3);
  });

  it("stops at MAX_DEPTH and reports truncation", async () => {
    // Build a chain 20 levels deep with a file at the bottom.
    let dir = tmpDir;
    for (let i = 0; i < 20; i++) {
      dir = path.join(dir, `d${i}`);
      fs.mkdirSync(dir);
    }
    fs.writeFileSync(path.join(dir, "deep.txt"), "bottom");
    fs.writeFileSync(path.join(tmpDir, "shallow.txt"), "top");

    const { files, truncated } = await walkFiles(tmpDir);
    expect(truncated).toBe(true);
    expect(files).toContain(path.join(tmpDir, "shallow.txt"));
    expect(files).not.toContain(path.join(dir, "deep.txt")); // beyond MAX_DEPTH
  });

  it("caps collected files at MAX_FILES and reports truncation", async () => {
    for (let i = 0; i < 600; i++) {
      fs.writeFileSync(path.join(tmpDir, `f${i}.txt`), "x");
    }
    const { files, truncated } = await walkFiles(tmpDir);
    expect(files.length).toBeLessThanOrEqual(500);
    expect(files.length).toBe(500);
    expect(truncated).toBe(true);
  });

  it("skips dot-directories (except .env files are kept) and IGNORE_DIRS", async () => {
    fs.mkdirSync(path.join(tmpDir, ".git"));
    fs.mkdirSync(path.join(tmpDir, "node_modules"));
    fs.writeFileSync(path.join(tmpDir, ".git", "config"), "x");
    fs.writeFileSync(path.join(tmpDir, "node_modules", "pkg.js"), "x");
    fs.writeFileSync(path.join(tmpDir, ".env"), "SECRET=1");

    const { files } = await walkFiles(tmpDir);
    expect(files).toEqual([path.join(tmpDir, ".env")]);
  });

  it("does not follow symlinked directories", async () => {
    const real = path.join(tmpDir, "real");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(real, "s.txt"), "x");
    fs.symlinkSync(real, path.join(tmpDir, "link"));
    fs.writeFileSync(path.join(tmpDir, "root.txt"), "x");

    const { files } = await walkFiles(tmpDir);
    expect(files).not.toContain(path.join(tmpDir, "link", "s.txt"));
    expect(files).toContain(path.join(tmpDir, "real", "s.txt"));
  });
});

// Minimal one-page PDF with a single text run; xref offsets computed so the
// parser doesn't need to repair the file.
function minimalPdf(text: string): Buffer {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 12 Tf 20 100 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

describe("extractText — PDF", () => {
  it("extracts text from a PDF (pdf-parse v2 class API)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-pdf-"));
    try {
      const file = path.join(dir, "keys.pdf");
      fs.writeFileSync(file, minimalPdf("OPENAI_KEY sk-test-abc123"));
      const r = await extractText(file);
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.text).toContain("sk-test-abc123");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("scanFileIntoSession — concurrent watcher updates", () => {
  it("two files changed together both keep their candidates", async () => {
    const { VaultStore } = await import("./store.js");
    const { ensurePortableLayout } = await import("./paths.js");
    const { scanFileIntoSession } = await import("./services/folderScan.js");
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-watchrace-"));
    try {
      const paths = ensurePortableLayout(root);
      const store = new VaultStore(paths);
      const dir = path.join(root, "watched");
      fs.mkdirSync(dir);
      const a = path.join(dir, "a.env");
      const b = path.join(dir, "b.env");
      fs.writeFileSync(a, "ALPHA_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n");
      fs.writeFileSync(b, "BETA_TOKEN=ghp_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n");
      const now = new Date().toISOString();
      store.saveScanSession({
        id: "s1",
        folder_path: dir,
        created_at: now,
        updated_at: now,
        status: "review",
        watching: true,
        summary: {
          folder_path: dir, files_found: 0, files_processed: 0, files_skipped: 0,
          candidates_total: 0, candidates_ready: 0, candidates_needs_review: 0,
          candidates_discarded: 0, provider_used: "heuristic", duration_ms: 0,
        } as any,
        processed_files: [],
        skipped_files: [],
        candidates: [],
        brief: "",
      });
      const settings = store.getSettings();
      await Promise.all([
        scanFileIntoSession(store, settings, "s1", a),
        scanFileIntoSession(store, settings, "s1", b),
      ]);
      const values = store.getScanSession("s1")!.candidates.map((c) => c.value);
      expect(values.some((v) => v.includes("ghp_aaaa"))).toBe(true);
      expect(values.some((v) => v.includes("ghp_bbbb"))).toBe(true);
      expect(store.getScanSession("s1")!.processed_files.length).toBe(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
