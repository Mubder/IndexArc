import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parsePublisherNames } = require("../shared/updater.cjs");
const script = (name: string) => path.join(__dirname, name);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ia-release-"));

describe("write-app-update-yml (SignPath flow)", () => {
  it("writes a file the updater reads the publisher from", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "resources"));
    execFileSync(process.execPath, [script("write-app-update-yml.mjs"), dir, "SignPath Foundation"]);
    const yml = fs.readFileSync(path.join(dir, "resources", "app-update.yml"), "utf8");
    expect(parsePublisherNames(yml)).toEqual(["SignPath Foundation"]);
    expect(yml).toMatch(/^provider: github$/m);
    expect(yml).toMatch(/^owner: "Mubder"$/m);
    expect(yml).toMatch(/^updaterCacheDirName: "indexarc-updater"$/m);
  });

  it("refuses to run without a publisher name", () => {
    expect(() => execFileSync(process.execPath, [script("write-app-update-yml.mjs"), tmp()], { stdio: "pipe" })).toThrow();
  });
});

describe("refresh-update-manifest (after external signing)", () => {
  it("rewrites sha512 and size and rebuilds the blockmap", () => {
    const dir = tmp();
    const exe = path.join(dir, "IndexArc-Setup-9.9.9.exe");
    fs.writeFileSync(exe, crypto.randomBytes(300_000));
    fs.writeFileSync(`${exe}.blockmap`, "stale");
    fs.writeFileSync(
      path.join(dir, "latest.yml"),
      ["version: 9.9.9", "files:", "  - url: IndexArc-Setup-9.9.9.exe", "    sha512: OLD", "    size: 1", "path: IndexArc-Setup-9.9.9.exe", "sha512: OLD", "releaseDate: '2026-11-04T00:00:00.000Z'", ""].join("\n")
    );
    execFileSync(process.execPath, [script("refresh-update-manifest.mjs"), dir], { stdio: "pipe" });

    const want = crypto.createHash("sha512").update(fs.readFileSync(exe)).digest("base64");
    const yml = fs.readFileSync(path.join(dir, "latest.yml"), "utf8");
    expect(yml.match(/sha512: (.+)/g)).toEqual([`sha512: ${want}`, `sha512: ${want}`]);
    expect(yml).toContain("    size: 300000");
    expect(yml).toContain("releaseDate: '2026-11-04T00:00:00.000Z'");
    const map = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${exe}.blockmap`)).toString("utf8"));
    expect(map.files?.[0]?.checksums?.length).toBeGreaterThan(0);
  });

  it("fails when a listed file is missing", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "latest.yml"), "files:\n  - url: gone.exe\n    sha512: x\n    size: 1\npath: gone.exe\nsha512: x\n");
    expect(() => execFileSync(process.execPath, [script("refresh-update-manifest.mjs"), dir], { stdio: "pipe" })).toThrow();
  });
});
