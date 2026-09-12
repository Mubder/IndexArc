import { Router } from "express";
import fs from "fs";
import path from "path";
import { ProtectedTabError } from "../store.js";
import { addLog } from "../logs.js";
import { findAlternateVaultRoots } from "../paths.js";
import { checkOllama } from "../ai/providers.js";
import { throttle, recordFailure, recordSuccess } from "./throttle.js";
import { serverIdentity } from "../auth.js";
import type { RouteContext } from "./types.js";

function fileSizeOrNull(file: string): number | null {
  try {
    if (!fs.existsSync(file)) return null;
    return fs.statSync(file).size;
  } catch {
    return null;
  }
}

export function miscRoutes(ctx: RouteContext) {
  const r = Router();
  const { store, audit } = ctx;

  r.get("/ping", (_req, res) => {
    // server_id lets the Electron shell verify it is talking to THIS server
    // (and not whatever squatted the port) before loading window content.
    res.json({ status: "ok", server_id: serverIdentity() });
  });

  // App health diagnostics (reachable even when the vault is locked — it is
  // read-only and never decrypts anything). Powers the "Check app health"
  // button: server reachability, which data folder is active, vault/notes
  // counts, disk writability, integrity warnings, backups, Ollama, and —
  // critically — whether the user's real data lives in a DIFFERENT folder
  // than the one currently served (the #1 cause of "empty after relaunch").
  r.get("/health", async (_req, res) => {
    try {
      const settings = store.getSettings();
      const vaultFile = ctx.paths.vaultFile;
      const scratchFile = ctx.paths.scratchpadFile;
      const vectorsFile = ctx.paths.vectorsFile;
      const settingsFile = ctx.paths.settingsFile;

      let encrypted = false;
      let locked = false;
      try {
        encrypted = store.isEncryptionEnabled();
      } catch {
        encrypted = false;
      }
      try {
        locked = store.isLocked();
      } catch {
        locked = false;
      }

      let stats: {
        total_saved: number;
        needs_attention: number;
        total_commands: number;
        total_notes: number;
        total_secrets: number;
        total_unknown: number;
        total: number;
      } | null = null;
      let statsError: string | null = null;
      if (!locked) {
        try {
          stats = store.stats();
        } catch (e: any) {
          statsError = e?.message || "stats failed";
        }
      }

      let scratchTabs: number | null = null;
      try {
        if (!locked) scratchTabs = store.getScratchpad().length;
      } catch {
        scratchTabs = null;
      }
      let archivedCount: number | null = null;
      try {
        if (!locked) archivedCount = store.getScratchpadArchive().length;
      } catch {
        archivedCount = null;
      }

      let ollama: { online: boolean; models: string[] } = { online: false, models: [] };
      try {
        ollama = await checkOllama(settings.ollama_base_url);
      } catch {
        ollama = { online: false, models: [] };
      }

      let writable = false;
      try {
        const probe = path.join(ctx.paths.dataDir, ".indexarc-write-test");
        fs.writeFileSync(probe, "");
        fs.unlinkSync(probe);
        writable = true;
      } catch {
        writable = false;
      }

      let alternates: ReturnType<typeof findAlternateVaultRoots> = [];
      try {
        alternates = findAlternateVaultRoots(ctx.paths.root);
      } catch {
        alternates = [];
      }

      let backupsCount = 0;
      try {
        backupsCount = store.listBackups().length;
      } catch {
        backupsCount = 0;
      }
      let emergencyCount = 0;
      try {
        emergencyCount = store.listEmergencySnapshots().length;
      } catch {
        emergencyCount = 0;
      }
      let integrityWarnings: string[] = [];
      try {
        integrityWarnings = store.getIntegrityWarnings() || [];
      } catch {
        integrityWarnings = [];
      }

      const vaultExists = fs.existsSync(vaultFile);
      const vaultSize = fileSizeOrNull(vaultFile);
      const total = stats ? stats.total : null;
      // Missing vault.json is the same "fresh folder" signal as an empty one —
      // both mean this root holds no entries (a quarantined *.corrupt-* copy
      // is reported by its own check below).
      const vaultEmpty = !vaultExists || total === 0 || total === null;
      const wrongFolderSuspect =
        !locked &&
        vaultEmpty &&
        alternates.some((a) => (a.vaultEntries ?? 0) > 0);

      let quarantined: string[] = [];
      try {
        quarantined = fs.readdirSync(ctx.paths.dataDir).filter((f) => f.includes(".corrupt-"));
      } catch {
        quarantined = [];
      }

      type Check = { id: string; label: string; severity: "critical" | "info"; ok: boolean; detail: string };
      const checks: Check[] = [
        {
          id: "server",
          label: "Vault server responding",
          severity: "critical",
          ok: true,
          detail: `Serving ${ctx.paths.root}`,
        },
        {
          id: "data-writable",
          label: "Data folder writable",
          severity: "critical",
          ok: writable,
          detail: writable ? ctx.paths.dataDir : `Cannot write to ${ctx.paths.dataDir}`,
        },
        {
          id: "vault-unlocked",
          label: "Vault unlocked",
          severity: "critical",
          ok: !locked,
          detail: locked
            ? "Vault is locked — entries, search and AI over vault data stay empty until you unlock."
            : encrypted
              ? "Encrypted vault is unlocked."
              : "Vault is not encrypted (plain JSON on disk).",
        },
        {
          id: "vault-entries",
          label: "Vault entries present",
          severity: "critical",
          ok: locked ? true : (total ?? 0) > 0,
          detail: locked
            ? "Locked — entry count hidden until unlock."
            : statsError
              ? `Could not read vault: ${statsError}`
              : `${total ?? 0} entr${(total ?? 0) === 1 ? "y" : "ies"} in this data folder.`,
        },
        {
          id: "wrong-folder",
          label: "Correct data folder",
          severity: "critical",
          ok: !wrongFolderSuspect,
          detail: wrongFolderSuspect
            ? `This folder looks empty but ${alternates
                .filter((a) => (a.vaultEntries ?? 0) > 0)
                .map((a) => `${a.vaultEntries} entries at ${a.root}`)
                .join("; ")}. You relaunched from a different folder/build (e.g. dev sandbox vs packaged app).`
            : alternates.length
              ? `Active: ${ctx.paths.root}. ${alternates.length} other folder(s) with data exist on this machine.`
              : `Active: ${ctx.paths.root}. No other data folders found.`,
        },
        {
          id: "scratchpad",
          label: "Notes (scratchpad) readable",
          severity: "critical",
          ok: locked ? true : scratchTabs !== null,
          detail: locked
            ? "Locked — notes hidden until unlock."
            : `${scratchTabs ?? 0} active note(s)${archivedCount ? `, ${archivedCount} archived` : ""}.`,
        },
        {
          id: "integrity",
          label: "Data integrity",
          severity: "critical",
          ok: integrityWarnings.length === 0,
          detail: integrityWarnings.length
            ? integrityWarnings.join(" | ")
            : "No corruption detected since last write.",
        },
        {
          id: "quarantined",
          label: "Quarantined (unreadable) files",
          severity: "critical",
          ok: quarantined.length === 0,
          detail: quarantined.length
            ? `${quarantined.join(", ")} — the originals were preserved (never deleted). Restore by hand or from Settings → Emergency Plan.`
            : "None — every data file parses.",
        },
        {
          id: "backups",
          label: "Backups & snapshots",
          severity: "info",
          ok: backupsCount > 0 || emergencyCount > 0,
          detail: `${backupsCount} backup(s), ${emergencyCount} emergency snapshot(s). Restore from Settings → Emergency Plan.`,
        },
        {
          id: "ollama",
          label: "Local AI (Ollama)",
          severity: "info",
          ok: ollama.online,
          detail: ollama.online
            ? `Online — ${ollama.models.length} model(s).`
            : "Offline — AI features fall back to heuristics; vault data is unaffected.",
        },
      ];

      const criticalBad = checks.some((c) => c.severity === "critical" && !c.ok);
      const infoBad = checks.some((c) => c.severity === "info" && !c.ok);
      const overall = criticalBad ? "attention" : infoBad ? "degraded" : "healthy";

      res.json({
        ok: true,
        now: new Date().toISOString(),
        overall,
        server: {
          portable_root: ctx.paths.root,
          data_dir: ctx.paths.dataDir,
          config_dir: ctx.paths.configDir,
          node_env: process.env.NODE_ENV || "development",
        },
        vault: {
          path: vaultFile,
          exists: vaultExists,
          size: vaultSize,
          encrypted,
          locked,
          total,
          saved: stats ? stats.total_saved : null,
          needs_attention: stats ? stats.needs_attention : null,
          error: statsError,
        },
        scratchpad: {
          path: scratchFile,
          exists: fs.existsSync(scratchFile),
          size: fileSizeOrNull(scratchFile),
          tabs: scratchTabs,
          archived: archivedCount,
        },
        vectors: { path: vectorsFile, exists: fs.existsSync(vectorsFile), size: fileSizeOrNull(vectorsFile) },
        settings: { path: settingsFile, exists: fs.existsSync(settingsFile) },
        storage: { writable, dir: ctx.paths.dataDir },
        integrity: { warnings: integrityWarnings },
        backups: { count: backupsCount, dir: ctx.paths.backupsDir },
        emergency: { count: emergencyCount },
        ollama,
        alternates,
        checks,
      });
    } catch (e: any) {
      // Health must never 500 — a failing probe is itself a diagnosis.
      res.json({ ok: false, overall: "attention", error: e?.message || "health check failed", checks: [] });
    }
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

  // Tamper-evident security trail (hash-chained). Token required; records
  // carry event names and object ids only — never secret values — and the
  // chain status is verified on every read.
  r.get("/audit", (_req, res) => {
    res.json({
      records: audit ? audit.tail(200) : [],
      chain: audit ? audit.verify() : { ok: true, checked: 0, brokenAtSeq: null },
    });
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
    if (ok) {
      addLog("SYSTEM", `Restored from emergency snapshot → ${name}`);
      audit?.log("vault.restore", `emergency snapshot ${name}`);
    }
    const locked = store.isLocked();
    let vault_total: number | null = null;
    let scratchpad_tabs: number | null = null;
    if (ok && !locked) {
      try {
        vault_total = store.stats().total;
      } catch {
        vault_total = null;
      }
      try {
        scratchpad_tabs = store.getScratchpad().length;
      } catch {
        scratchpad_tabs = null;
      }
    }
    res.json({ ok, locked, vault_total, scratchpad_tabs });
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
      // password when the vault is encrypted. There is no other override
      // path. Throttled with the SAME policy as unlock — the master-password
      // branch is a password-verification oracle and previously accepted
      // unlimited attempts (audit finding H5).
      const gate = throttle(req, res, { max: 10 });
      if (!gate) return;
      const word = String(req.body?.confirm_word ?? "").trim();
      const password = typeof req.body?.password === "string" ? req.body.password : "";
      const wordOk = word === "UNPROTECT";
      const pwOk = password ? await store.verifyMasterPassword(password) : false;
      if (!wordOk && !pwOk) {
        recordFailure(req);
        return setTimeout(
          () => res.status(403).json({ error: "Confirmation failed — type UNPROTECT or enter the master password" }),
          gate.delayMs || 500
        );
      }
      recordSuccess(req);
    }
    const tab = store.setScratchpadTabProtected(req.params.id, wantProtected);
    if (!tab) return res.status(404).json({ error: "Tab not found" });
    addLog("SECURITY", wantProtected ? `Note protected: ${String(tab.title).slice(0, 40)}` : `Note unprotected: ${String(tab.title).slice(0, 40)}`);
    audit?.log(wantProtected ? "note.protect" : "note.unprotect", `tab=${req.params.id}`);
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
