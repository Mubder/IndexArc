// @ts-check
// Integrity check for the unpacked dist/ folder of a packaged build.
//
// dist/ has to live in app.asar.unpacked (pdf.js imports dist/pdf.worker.mjs
// from disk, and the server bundle is require()d from there), so Electron's
// asar integrity fuse does not cover it. The build writes dist-manifest.json
// (sha256 of every shipped dist file) into the app root, which IS packed
// inside app.asar and therefore integrity-protected once the
// EnableEmbeddedAsarIntegrityValidation + OnlyLoadAppFromAsar fuses are on.
// Before the server bundle is loaded, each file is re-hashed and compared.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MANIFEST_NAME = "dist-manifest.json";

/**
 * @typedef {{ version: 1, algorithm: "sha256", files: Record<string, string> }} DistManifest
 * @typedef {{ ok: true, checked: number } | { ok: false, reason: string, problems: string[] }} VerifyResult
 */

/** @param {string} file */
function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/**
 * Hash every file under distDir except source maps (which are not shipped).
 * Keys are POSIX-style paths relative to distDir.
 * @param {string} distDir
 * @returns {Record<string, string>}
 */
function hashDist(distDir) {
  /** @type {Record<string, string>} */
  const files = {};
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && !e.name.endsWith(".map")) {
        files[path.relative(distDir, p).split(path.sep).join("/")] = sha256File(p);
      }
    }
  };
  walk(distDir);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Verify distDir against the manifest. Fails closed: a missing or unreadable
 * manifest, a missing file, or any hash mismatch is a failure.
 * @param {string} distDir
 * @param {string} manifestPath
 * @returns {VerifyResult}
 */
function verifyDist(distDir, manifestPath) {
  /** @type {DistManifest} */
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (e) {
    return { ok: false, reason: "manifest missing or unreadable", problems: [manifestPath] };
  }
  if (!manifest || manifest.algorithm !== "sha256" || !manifest.files || typeof manifest.files !== "object") {
    return { ok: false, reason: "manifest malformed", problems: [manifestPath] };
  }
  const entries = Object.entries(manifest.files);
  const required = ["server.cjs", "pdf.worker.mjs"];
  /** @type {string[]} */
  const problems = required.filter((r) => !(r in manifest.files)).map((r) => `${r}: not listed in manifest`);
  for (const [rel, expected] of entries) {
    const abs = path.resolve(distDir, rel);
    const relToDist = path.relative(distDir, abs);
    if (!relToDist || relToDist.startsWith("..") || path.isAbsolute(relToDist)) {
      problems.push(`${rel}: path escapes dist`);
      continue;
    }
    let actual;
    try {
      actual = sha256File(abs);
    } catch {
      problems.push(`${rel}: missing`);
      continue;
    }
    if (actual !== expected) problems.push(`${rel}: hash mismatch`);
  }
  if (problems.length) return { ok: false, reason: "dist files do not match the build manifest", problems };
  return { ok: true, checked: entries.length };
}

module.exports = { MANIFEST_NAME, hashDist, verifyDist };
