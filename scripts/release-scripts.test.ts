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

describe("azure-sign-config (Azure Trusted Signing)", () => {
  const env = {
    AZURE_SIGNING_ENDPOINT: "https://weu.codesigning.azure.net/",
    AZURE_SIGNING_ACCOUNT: "acct",
    AZURE_SIGNING_PROFILE: "prof",
    AZURE_SIGNING_PUBLISHER_NAME: "Example Publisher",
  };
  const run = (extra: Record<string, string>) => {
    const out = path.join(tmp(), "cfg.json");
    execFileSync(process.execPath, [script("azure-sign-config.mjs"), out], { env: { ...process.env, ...extra }, stdio: "pipe" });
    return JSON.parse(fs.readFileSync(out, "utf8"));
  };

  it("adds azureSignOptions to the package.json build config and forces signing", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
    const cfg = run(env);
    expect(cfg.win.azureSignOptions).toEqual({
      endpoint: env.AZURE_SIGNING_ENDPOINT,
      codeSigningAccountName: "acct",
      certificateProfileName: "prof",
      publisherName: "Example Publisher",
    });
    expect(cfg.win.signExts).toEqual([".dll"]);
    expect(cfg.forceCodeSigning).toBe(true);
    // Everything else is the normal build config.
    expect(cfg.appId).toBe(pkg.build.appId);
    expect(cfg.nsis).toEqual(pkg.build.nsis);
    expect(cfg.extraResources).toEqual(pkg.build.extraResources);
  });

  it("can leave DLLs unsigned", () => {
    expect(run({ ...env, AZURE_SIGN_DLLS: "false" }).win.signExts).toBeUndefined();
  });

  it("fails when a setting is missing", () => {
    const out = path.join(tmp(), "cfg.json");
    const e = { ...process.env, ...env, AZURE_SIGNING_PROFILE: "" };
    expect(() => execFileSync(process.execPath, [script("azure-sign-config.mjs"), out], { env: e, stdio: "pipe" })).toThrow();
    expect(fs.existsSync(out)).toBe(false);
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
