import { Router } from "express";
import { ProtectedTabError } from "../store.js";
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

  r.get("/integrity", (_req, res) => {
    res.json({ warnings: store.getIntegrityWarnings() });
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

  // --- Granular scratchpad endpoints (preferred over whole-array saves) ---
  r.post("/scratchpad/tabs/:id/content", (req, res) => {
    const content = String(req.body?.content ?? "");
    const baseRev = req.body?.base_rev === undefined ? undefined : Number(req.body.base_rev);
    // NOTE: force/override is intentionally NOT accepted from request bodies —
    // protection can only be lifted via the dedicated /protect route.
    const result = store.updateScratchpadTabContent(req.params.id, content, baseRev);
    if (result.protected) {
      return res.status(423).json({ error: "This note is protected", server_tab: result.tab });
    }
    if (!result.ok) {
      return res.status(409).json({
        error: "Tab was changed elsewhere since it was loaded",
        server_tab: result.tab,
      });
    }
    res.json({ tab: result.tab });
  });

  r.post("/scratchpad/tabs/:id/meta", (req, res) => {
    const title = req.body?.title === undefined ? undefined : String(req.body.title);
    if (title !== undefined) {
      try {
        const tab = store.renameScratchpadTab(req.params.id, title);
        if (!tab) return res.status(404).json({ error: "Tab not found" });
        return res.json({ tab });
      } catch (e: any) {
        if (e instanceof ProtectedTabError) {
          return res.status(423).json({ error: "This note is protected" });
        }
        throw e;
      }
    }
    res.status(400).json({ error: "Nothing to update" });
  });

  r.delete("/scratchpad/tabs/:id", (req, res) => {
    const ok = store.deleteScratchpadTab(req.params.id);
    if (ok === "protected") {
      return res.status(423).json({ error: "This note is protected and cannot be deleted" });
    }
    if (!ok) return res.status(404).json({ error: "Tab not found" });
    res.json({ success: true });
  });

  // --- Protect / Pin ---
  r.post("/scratchpad/tabs/:id/protect", async (req, res) => {
    const wantProtected = req.body?.protected !== false;
    if (!wantProtected) {
      // Unprotect requires ceremony: the fixed confirm word, or the master
      // password when the vault is encrypted. There is no other override path.
      const word = String(req.body?.confirm_word ?? "").trim();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const wordOk = word === "UNPROTECT";
      const pwOk = password ? await store.verifyMasterPassword(password) : false;
      if (!wordOk && !pwOk) {
        return res.status(403).json({ error: "Confirmation failed — type UNPROTECT or enter the master password" });
      }
    }
    const tab = store.setScratchpadTabProtected(req.params.id, wantProtected);
    if (!tab) return res.status(404).json({ error: "Tab not found" });
    addLog("SECURITY", wantProtected ? `Note protected: ${String(tab.title).slice(0, 40)}` : `Note unprotected: ${String(tab.title).slice(0, 40)}`);
    res.json({ tab });
  });

  r.post("/scratchpad/tabs/:id/pin", (req, res) => {
    const pinned = req.body?.pinned !== false;
    const tab = store.setScratchpadTabPinned(req.params.id, pinned);
    if (!tab) return res.status(404).json({ error: "Tab not found" });
    res.json({ tab });
  });

  r.put("/scratchpad/order", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x: unknown) => String(x)) : [];
    res.json({ tabs: store.reorderScratchpad(ids) });
  });

  r.post("/scratchpad", (req, res) => {
    const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs : [];
    const force = req.body?.force === true;
    const baseRevs = req.body?.base_revs;
    // Protection first: a whole-array save may never modify or drop a
    // protected note (this is the deprecated compat path — it cannot delete).
    const protectedViolations = store.findScratchpadProtectViolations(tabs);
    if (protectedViolations.length) {
      return res.status(423).json({
        error: "Protected notes cannot be changed or removed",
        protected_violations: protectedViolations,
      });
    }
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
    try {
      res.json({ tabs: store.saveScratchpad(tabs, { force }) });
    } catch (e: any) {
      if (e instanceof ProtectedTabError) {
        return res.status(423).json({ error: e.message, protected_violations: e.tabIds });
      }
      throw e;
    }
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
