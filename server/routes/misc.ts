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
    const ok = store.restoreEmergencySnapshot(name);
    if (ok) addLog("SYSTEM", `Restored from emergency snapshot → ${name}`);
    res.json({ ok, locked: store.isLocked() });
  });

  r.get("/scratchpad", (_req, res) => {
    res.json({ tabs: store.getScratchpad() });
  });

  r.post("/scratchpad", (req, res) => {
    const tabs = Array.isArray(req.body?.tabs) ? req.body.tabs : [];
    const force = req.body?.force === true;
    res.json({ tabs: store.saveScratchpad(tabs, { force }) });
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
