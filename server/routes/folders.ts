import { Router } from "express";
import { randomUUID } from "crypto";
import { addLog } from "../logs.js";
import { scanFolder } from "../services/folderScan.js";
import { saveCandidate } from "../services/vault.js";
import { listDirectory, listFsRoots } from "../services/fsBrowser.js";
import { sendSSE } from "./sse.js";
import type { AnalyzeCandidate, WatchedFolder } from "../types.js";
import type { RouteContext } from "./types.js";

async function registerAndMaybeWatch(
  ctx: RouteContext,
  session: Awaited<ReturnType<typeof scanFolder>>,
  keepWatching: boolean
) {
  const { store, watchers } = ctx;
  const existing = store.listWatchedFolders().find((f) => f.path === session.folder_path);
  const folder: WatchedFolder = existing
    ? {
        ...existing,
        watching: keepWatching,
        last_scan_id: session.id,
        last_scan_at: session.created_at,
      }
    : {
        id: randomUUID(),
        path: session.folder_path,
        watching: keepWatching,
        last_scan_id: session.id,
        last_scan_at: session.created_at,
        created_at: new Date().toISOString(),
      };
  store.upsertWatchedFolder(folder);
  if (keepWatching) watchers.start(folder, session.id);
  else watchers.stop(folder.id);
  return folder;
}

export function foldersRoutes(ctx: RouteContext) {
  const r = Router();
  const { store, watchers } = ctx;

  r.get("/", (_req, res) => {
    res.json({
      folders: store.listWatchedFolders().map((f) => ({
        ...f,
        live: watchers.isWatching(f.id),
      })),
      active_session_id: store.getActiveScanSession()?.id || null,
    });
  });

  r.get("/sessions", (_req, res) => {
    res.json(store.listScanSessions());
  });

  r.get("/sessions/active", (_req, res) => {
    const s = store.getActiveScanSession();
    res.json(s || null);
  });

  r.get("/sessions/:id", (req, res) => {
    const s = store.getScanSession(req.params.id);
    if (!s) return res.status(404).json({ error: "Session not found" });
    res.json(s);
  });

  r.post("/scan", async (req, res) => {
    const folderPath = String(req.body?.path ?? "").trim();
    if (!folderPath) return res.status(400).json({ error: "Folder path is required" });
    const useAi = !!req.body?.use_ai;
    const keepWatching = req.body?.watch !== false;

    try {
      const session = await scanFolder(store, store.getSettings(), {
        folderPath,
        useAi,
        watching: keepWatching,
      });
      await registerAndMaybeWatch(ctx, session, keepWatching);
      sendSSE("folders-changed", { action: "scan" });
      res.json(session);
    } catch (e: any) {
      addLog("FOLDER", `Scan error: ${e.message}`);
      res.status(400).json({ error: e.message });
    }
  });

  r.patch("/sessions/:id/candidates", (req, res) => {
    const session = store.getScanSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "review") {
      return res.status(400).json({ error: "Session is no longer in review" });
    }

    type CandPatch = Partial<AnalyzeCandidate> & { temp_id: string };
    const updates: CandPatch[] = Array.isArray(req.body?.candidates)
      ? req.body.candidates
      : [req.body];
    const byId = new Map<string, CandPatch>(updates.map((u) => [u.temp_id, u]));

    const candidates = session.candidates.map((c) => {
      const u = byId.get(c.temp_id);
      if (!u) return c;
      const next: AnalyzeCandidate = {
        ...c,
        type: u.type !== undefined ? String(u.type) : c.type,
        name: u.name !== undefined ? String(u.name) : c.name,
        family: u.family !== undefined ? u.family : c.family,
        decision: u.decision !== undefined ? u.decision : c.decision,
        labels: u.labels !== undefined ? u.labels : c.labels,
      };
      const secretLike = next.family === "secret" || next.family === "unknown";
      next.needs_type = secretLike && !String(next.type || "").trim();
      next.needs_name = secretLike && !String(next.name || "").trim();
      next.ready = !next.needs_type && !next.needs_name;
      return next;
    });

    const ready = candidates.filter((c) => c.ready && c.decision !== "discard").length;
    const needs = candidates.filter((c) => !c.ready && c.decision !== "discard").length;
    const discarded = candidates.filter((c) => c.decision === "discard").length;

    const updated = store.updateScanSession(req.params.id, {
      candidates,
      summary: {
        ...session.summary,
        candidates_ready: ready,
        candidates_needs_review: needs,
        candidates_discarded: discarded,
        candidates_total: candidates.length,
      },
    });
    res.json(updated);
  });

  r.post("/sessions/:id/commit", async (req, res) => {
    const session = store.getScanSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "review") {
      return res.status(400).json({ error: "Session already committed or discarded" });
    }

    const mode = String(req.body?.mode || "selected");
    const settings = store.getSettings();
    const saved = [];
    const parked = [];
    let discarded = 0;

    for (const c of session.candidates) {
      const decision = c.decision || "pending";
      if (decision === "discard") {
        discarded++;
        continue;
      }

      let action: "save" | "park" | "skip" = "skip";
      if (decision === "save") action = "save";
      else if (decision === "park") action = "park";
      else if (decision === "pending") {
        if (mode === "all_ready" && c.ready) action = "save";
        else if (mode === "all_pending") action = c.ready ? "save" : "park";
        else if (mode === "apply") action = c.ready ? "save" : "park";
      }

      if (action === "skip") continue;

      const entry = await saveCandidate(store, settings, {
        value: c.value,
        type: c.type,
        name: c.name,
        raw_fragment: c.raw_fragment,
        labels: c.labels,
        type_aliases: c.type_aliases,
        family: c.family,
        paste_id: session.id,
        source_file: c.source_file,
        allow_incomplete: true,
      });
      if (entry.status === "saved") saved.push(entry);
      else parked.push(entry);
    }

    store.updateScanSession(req.params.id, { status: "committed" });

    addLog(
      "FOLDER",
      `Committed session ${session.id.slice(0, 8)}: saved=${saved.length} parked=${parked.length} discarded=${discarded}`
    );
    sendSSE("folders-changed", { action: "commit", saved: saved.length, parked: parked.length });
    res.json({ saved, parked, discarded, session_id: session.id });
  });

  r.post("/sessions/:id/apply", async (req, res) => {
    const session = store.getScanSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.status !== "review") {
      return res.status(400).json({ error: "Session already closed" });
    }

    const settings = store.getSettings();
    const saved = [];
    const parked = [];
    let discarded = 0;

    for (const c of session.candidates) {
      const decision = c.decision || "pending";
      if (decision === "discard") {
        discarded++;
        continue;
      }

      let park = false;
      if (decision === "park") park = true;
      else if (decision === "save") park = false;
      else {
        park = !c.ready;
      }

      const entry = await saveCandidate(store, settings, {
        value: c.value,
        type: park && !c.type ? "" : c.type,
        name: park && !c.name ? "" : c.name,
        raw_fragment: c.raw_fragment,
        labels: c.labels,
        type_aliases: c.type_aliases,
        family: c.family,
        paste_id: session.id,
        source_file: c.source_file,
        allow_incomplete: true,
      });
      if (entry.status === "saved") saved.push(entry);
      else parked.push(entry);
    }

    store.updateScanSession(req.params.id, {
      status: "committed",
      summary: {
        ...session.summary,
        candidates_discarded: discarded,
      },
    });

    addLog(
      "FOLDER",
      `Applied session: ${saved.length} saved, ${parked.length} unidentified, ${discarded} discarded`
    );
    sendSSE("folders-changed", { action: "apply", saved: saved.length, parked: parked.length });
    res.json({
      saved_count: saved.length,
      parked_count: parked.length,
      discarded_count: discarded,
      saved,
      parked,
    });
  });

  r.post("/sessions/:id/discard", (req, res) => {
    const session = store.getScanSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    store.updateScanSession(req.params.id, { status: "discarded" });
    addLog("FOLDER", `Discarded scan session ${req.params.id.slice(0, 8)}`);
    res.json({ success: true });
  });

  r.post("/:id/unwatch", (req, res) => {
    watchers.stop(req.params.id);
    const folders = store.listWatchedFolders();
    const f = folders.find((x) => x.id === req.params.id);
    if (f) {
      f.watching = false;
      store.upsertWatchedFolder(f);
    }
    res.json({ success: true });
  });

  r.delete("/:id", (req, res) => {
    watchers.stop(req.params.id);
    const ok = store.removeWatchedFolder(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    res.json({ success: true });
  });

  return r;
}

export function fsRoutes(_ctx: RouteContext) {
  const r = Router();

  r.get("/roots", (_req, res) => {
    try {
      res.json({ roots: listFsRoots() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  r.get("/list", (req, res) => {
    try {
      const dirPath = String(req.query.path || "").trim();
      if (!dirPath) {
        return res.json({
          path: "",
          parent: null,
          entries: listFsRoots().map((r) => ({
            name: r.label,
            path: r.path,
            isDirectory: true,
          })),
        });
      }
      res.json(listDirectory(dirPath));
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  return r;
}
