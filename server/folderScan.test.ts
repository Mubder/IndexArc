import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { walkFiles } from "./services/folderScan.js";

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
