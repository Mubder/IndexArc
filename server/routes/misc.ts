import { Router } from "express";
import { addLog } from "../logs.js";
import type { RouteContext } from "./types.js";

export function miscRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;

  r.get("/ping", (_req, res) => {
    res.json({ status: "ok" });
  });

  r.get("/backups", (_req, res) => {
    res.json({ backups: store.listBackups(), dir: ctx.paths.backupsDir });
  });

  r.get("/emergency", (_req, res) => {
    res.json({ snapshots: store.listEmergencySnapshots() });
  });

  r.post("/emergency/create", (_req, res) => {
    const name = store.createEmergencySnapshot();
    if (name) addLog("SYSTEM", `Emergency snapshot created (manual) → ${name}`);
    res.json({ ok: !!name, name });
  });

  r.post("/emergency/restore", (req, res) => {
    const name = String(req.body?.name ?? "").trim();
    if (!name) return res.status(400).json({ ok: false, error: "name required" });
    // Strict allowlist: this value is joined onto snapshot directory paths, so
    // anything but a genuine snapshot filename is a path-traversal attempt.
    if (!/^indexarc-emergency-[\w\-.]+\.iabak$/.test(name)) {
      return res.status(400).json({ ok: false, error: "invalid snapshot name" });
    }
    const ok = store.restoreEmergencySnapshot(name);
    if (ok) addLog("SYSTEM", `Restored from emergency snapshot → ${name}`);
    res.json({ ok, locked: store.isLocked() });
  });

  r.get("/scratchpad", (_req, res) => {
    res.json({ tabs: store.getScratchpad() });
  });

  // --- Note revisions (server-side history) ---
  r.get("/scratchpad/tabs/:id/revisions", (req, res) => {
    res.json({ revisions: store.getNoteRevisions(req.params.id) });
  });

  r.post("/scratchpad/tabs/:id/revisions", (req, res) => {
    const b = req.body || {};
    const rev = {
      id: String(b.id ?? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
      tabId: req.params.id,
      timestamp: Number(b.timestamp) || Date.now(),
      title: String(b.title ?? "Note"),
      content: String(b.content ?? ""),
      charCount: Number(b.charCount) || 0,
      wordCount: Number(b.wordCount) || 0,
      reason: b.reason ? String(b.reason) : undefined,
    };
    const revisions = store.addNoteRevision(rev);
    res.json({ revisions });
  });

  r.post("/scratchpad", (req, res) => {
    const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs : [];
    const force = req.body?.force === true;
    const baseRevs = req.body?.base_revs;
    // Optimistic concurrency: reject saves that would silently overwrite a
    // tab another window (or a stale client) already changed.
    if (!force) {
      const conflicts = store.findScratchpadConflicts(tabs, baseRevs);
      if (conflicts.length) {
        return res.status(409).json({
          error: "Notes were changed elsewhere since they were loaded",
          conflicts,
          server_tabs: store.getScratchpad(),
        });
      }
    }
    res.json({ tabs: store.saveScratchpad(tabs, { force }) });
  });

  r.get("/scratchpad/archive", (_req, res) => {
    const archive = store.getScratchpadArchive();
    res.json({ tabs: archive, count: archive.length });
  });

  r.get("/scratchpad/archive/count", (_req, res) => {
    res.json({ count: store.getScratchpadArchive().length });
  });

  r.post("/scratchpad/archive-tab", (req, res) => {
    const tabId = String(req.body?.tabId || "").trim();
    const tabFallback = req.body?.tab;
    if (!tabId) return res.status(400).json({ ok: false, error: "tabId required" });
    const result = store.archiveScratchpadTab(tabId, tabFallback);
    res.json({ ok: result.success, ...result });
  });

  r.post("/scratchpad/restore-tab", (req, res) => {
    const tabId = String(req.body?.tabId || "").trim();
    if (!tabId) return res.status(400).json({ ok: false, error: "tabId required" });
    const result = store.restoreScratchpadTab(tabId);
    res.json({ ok: result.success, ...result });
  });

  r.post("/scratchpad/delete-archived", (req, res) => {
    const tabId = String(req.body?.tabId || "").trim();
    if (!tabId) return res.status(400).json({ ok: false, error: "tabId required" });
    const result = store.deleteArchivedScratchpadTab(tabId);
    res.json({ ok: result.success, ...result });
  });

  r.get("/snippets", (_req, res) => {
    res.json(
      store.listEntries().map((e) => ({
        id: e.id,
        type: e.type,
        title: e.name,
        content: e.value,
        user_note: e.notes,
        created_at: e.created_at,
      }))
    );
  });

  return r;
}
