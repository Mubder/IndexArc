import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { hashDist, verifyDist } = require("./verify-dist.cjs");

describe("verify-dist", () => {
  let root: string;
  let dist: string;
  let manifest: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-dist-"));
    dist = path.join(root, "dist");
    fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
    fs.writeFileSync(path.join(dist, "server.cjs"), "module.exports = 1;");
    fs.writeFileSync(path.join(dist, "pdf.worker.mjs"), "export {};");
    fs.writeFileSync(path.join(dist, "assets", "index.js"), "console.log(1)");
    fs.writeFileSync(path.join(dist, "server.cjs.map"), "{}");
    manifest = path.join(root, "dist-manifest.json");
    fs.writeFileSync(manifest, JSON.stringify({ version: 1, algorithm: "sha256", files: hashDist(dist) }));
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it("hashes every shipped file except source maps", () => {
    expect(Object.keys(hashDist(dist))).toEqual(["assets/index.js", "pdf.worker.mjs", "server.cjs"]);
  });

  it("accepts an untouched dist", () => {
    expect(verifyDist(dist, manifest)).toEqual({ ok: true, checked: 3 });
  });

  it("rejects a modified server bundle", () => {
    fs.appendFileSync(path.join(dist, "server.cjs"), "\nrequire('child_process');");
    const res = verifyDist(dist, manifest);
    expect(res.ok).toBe(false);
    expect(res.problems).toEqual(["server.cjs: hash mismatch"]);
  });

  it("rejects a missing file", () => {
    fs.rmSync(path.join(dist, "pdf.worker.mjs"));
    expect(verifyDist(dist, manifest).problems).toEqual(["pdf.worker.mjs: missing"]);
  });

  it("fails closed without a manifest", () => {
    fs.rmSync(manifest);
    expect(verifyDist(dist, manifest)).toMatchObject({ ok: false, reason: "manifest missing or unreadable" });
  });

  it("rejects a manifest that omits the server bundle or escapes dist", () => {
    fs.writeFileSync(
      manifest,
      JSON.stringify({ version: 1, algorithm: "sha256", files: { "pdf.worker.mjs": "x", "../evil.js": "y" } }),
    );
    const res = verifyDist(dist, manifest);
    expect(res.ok).toBe(false);
    expect(res.problems).toContain("server.cjs: not listed in manifest");
    expect(res.problems).toContain("../evil.js: path escapes dist");
  });
});
