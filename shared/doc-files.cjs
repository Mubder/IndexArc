// @ts-check
// Which disk paths the document window may open.
// The vault directory is never a document, even if someone passes its path.
const path = require("path");

// Plain text the editor can read and write back.
const EDITABLE = new Set([
  ".md", ".markdown", ".txt", ".text", ".log",
  ".json", ".jsonc", ".yaml", ".yml", ".toml",
  ".ini", ".cfg", ".conf", ".env", ".properties",
  ".xml", ".svg", ".csv", ".tsv", ".sql", ".rst",
  ".html", ".htm", ".css",
  ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".py", ".sh", ".ps1", ".bat", ".cmd",
]);

// Binary formats the Files window can display but never write back.
const READONLY = new Set([".pdf"]);

/**
 * @param {string} child
 * @param {string} parent
 */
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * @param {string} vaultRoot portable root that holds data/, config/, logs/
 * @param {string} requested
 * @returns {{ ok: true, path: string, ext: string, editable: boolean, name: string } | { ok: false, reason: string }}
 */
function classifyDocPath(vaultRoot, requested) {
  if (typeof requested !== "string" || !requested.trim() || requested.includes("\0")) {
    return { ok: false, reason: "path" };
  }
  let abs;
  try {
    abs = path.resolve(requested);
  } catch {
    return { ok: false, reason: "path" };
  }
  const root = vaultRoot ? path.resolve(vaultRoot) : "";
  if (root && isInside(abs, root)) return { ok: false, reason: "vault" };
  const ext = path.extname(abs).toLowerCase();
  if (EDITABLE.has(ext)) return { ok: true, path: abs, ext, editable: true, name: path.basename(abs) };
  if (READONLY.has(ext)) return { ok: true, path: abs, ext, editable: false, name: path.basename(abs) };
  return { ok: false, reason: "type" };
}

module.exports = { classifyDocPath, isInside, EDITABLE, READONLY };
