#!/usr/bin/env node
// Builds the `indexarc` command-line tool as a standalone executable (Node
// Single Executable Application), so users do not need Node installed.
//
//   node scripts/build-cli-sea.mjs        → build/cli/indexarc(.exe)
//
// Steps: bundle bin/indexarc.mjs to one CommonJS file (SEA runs CommonJS),
// turn it into a SEA blob, copy the running Node binary and inject the
// blob. The binary is the Node that runs this script, for this OS and
// architecture; CI builds it on each release runner.
//
// Signing: injecting invalidates Node's own signature. Windows: the release
// signing step signs indexarc.exe with the app (docs/CODE_SIGNING.md).
// macOS: re-signed ad hoc here; notarized builds sign it with the app.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "build", "cli");
const work = path.join(root, "build", "cli-work");
const isWin = process.platform === "win32";
const isMac = process.platform === "darwin";
const exe = path.join(outDir, isWin ? "indexarc.exe" : "indexarc");
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: root });

fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(work, { recursive: true });

// 1) One CommonJS file, Node built-ins only.
const bundle = path.join(work, "indexarc.cjs");
await build({
  entryPoints: [path.join(root, "bin", "indexarc.mjs")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: `node${process.versions.node.split(".")[0]}`,
  outfile: bundle,
  logLevel: "warning",
});

// 2) SEA blob.
const blob = path.join(work, "sea-prep.blob");
const config = path.join(work, "sea-config.json");
fs.writeFileSync(config, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false }, null, 2));
run(process.execPath, ["--experimental-sea-config", config]);

// 3) Copy this Node binary and inject the blob.
if (fs.existsSync(exe)) fs.rmSync(exe);
fs.copyFileSync(process.execPath, exe);
fs.chmodSync(exe, 0o755);
if (isMac) run("codesign", ["--remove-signature", exe]);
const postject = path.join(root, "node_modules", "postject", "dist", "cli.js");
run(process.execPath, [postject, exe, "NODE_SEA_BLOB", blob, "--sentinel-fuse", FUSE, ...(isMac ? ["--macho-segment-name", "NODE_SEA"] : [])]);
if (isMac) run("codesign", ["--sign", "-", exe]);

// 4) Smoke test: the binary runs the CLI, not Node.
const help = execFileSync(exe, ["help"], { encoding: "utf8" });
if (!/indexarc/i.test(help)) throw new Error(`built CLI did not print its help:\n${help}`);
fs.rmSync(work, { recursive: true, force: true });
console.log(`CLI built: ${path.relative(root, exe)} (${(fs.statSync(exe).size / 1048576).toFixed(1)} MB)`);
