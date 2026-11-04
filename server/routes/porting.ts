import { Router } from "express";
import { addLog } from "../logs.js";
import { throttle, recordFailure, recordSuccess } from "./throttle.js";
import { buildEncryptedExport, buildEnvExport, parseImport, withoutDuplicates, type ImportFormat } from "../porting.js";
import type { RouteContext } from "./types.js";
import { validateBody } from "../request-body.js";
import { BODIES } from "./bodies.js";

// Import / export (R6.2). Mounted under /api/porting, which is in
// protectedPaths (unlocked vault required). Import only PREVIEWS: the user
// reviews candidates and saves them through /api/entries/save as usual.
export function portingRoutes(ctx: RouteContext) {
  const r = Router();
  const { store, audit } = ctx;
  const FORMATS: ImportFormat[] = ["env", "indexarc", "bitwarden", "csv", "keepass-xml"];

  r.post("/import/preview", validateBody(BODIES.porting["POST /import/preview"]), async (req, res) => {
    const { content, filename, format, passphrase } = req.body || {};
    if (typeof content !== "string" || !content.trim()) return res.status(400).json({ error: "File content is required" });
    if (format != null && !FORMATS.includes(format)) return res.status(400).json({ error: "Unknown format" });
    try {
      const parsed = await parseImport(content, { format, filename: String(filename || ""), passphrase: passphrase ? String(passphrase) : undefined });
      const result = withoutDuplicates(parsed, store.listEntries());
      audit?.log("vault.import.preview", `${result.format}: ${result.candidates.length} candidates`);
      res.json(result);
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Could not read this file" });
    }
  });

  r.post("/export", validateBody(BODIES.porting["POST /export"]), async (req, res) => {
    // Bulk export is the biggest single exfiltration step: re-confirm the
    // master password even on an unlocked session.
    const gate = throttle(req, res, { max: 10 });
    if (!gate) return;
    const { format, password, passphrase, ids } = req.body || {};
    if (format !== "env" && format !== "indexarc") return res.status(400).json({ error: "format must be env or indexarc" });
    if (store.isEncryptionEnabled()) {
      if (!password || !(await store.verifyMasterPassword(String(password)))) {
        recordFailure(req);
        return setTimeout(() => res.status(401).json({ error: "Incorrect master password" }), gate.delayMs || 500);
      }
    }
    recordSuccess(req);
    let entries = store.listEntries();
    if (Array.isArray(ids) && ids.length) {
      const want = new Set(ids.map(String));
      entries = entries.filter((e) => want.has(e.id));
    }
    if (format === "env") entries = entries.filter((e) => e.family === "secret");
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const content = format === "env" ? buildEnvExport(entries) : await buildEncryptedExport(entries, String(passphrase || ""));
      const filename = format === "env" ? `indexarc-${stamp}.env` : `indexarc-${stamp}.iaexport`;
      addLog("SECURITY", `Vault export (${format}): ${entries.length} entries${format === "env" ? " — PLAINTEXT" : ", encrypted"}.`);
      audit?.log("vault.export", `${format}: ${entries.length} entries`);
      res.json({ filename, count: entries.length, content });
    } catch (e: any) {
      res.status(400).json({ error: e?.message || "Export failed" });
    }
  });

  return r;
}
