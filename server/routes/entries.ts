import { Router } from "express";
import { addLog } from "../logs.js";
import { saveCandidate, saveMany, clarifyEntry } from "../services/vault.js";
import { sendSSE } from "./sse.js";
import { wrapAsync } from "../asyncWrap.js";
import type { RouteContext } from "./types.js";

export function entriesRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;

  r.post("/save", async (req, res) => {
    const settings = store.getSettings();
    const paste_id = req.body?.paste_id as string | undefined;
    const items = req.body?.candidates || req.body?.items;
    try {
      if (Array.isArray(items) && items.length) {
        const saved = await saveMany(
          store,
          settings,
          paste_id || "manual",
          items.map((c: any) => ({
            value: String(c.value ?? ""),
            type: String(c.type ?? ""),
            name: String(c.name ?? ""),
            raw_fragment: c.raw_fragment,
            labels: c.labels,
            type_aliases: c.type_aliases,
            family: c.family,
            notes: c.notes,
            source_file: c.source_file,
            allow_incomplete: true,
          }))
        );
        return res.json({ entries: saved });
      }
      const c = req.body;
      if (!c?.value) return res.status(400).json({ error: "value is required" });
      const entry = await saveCandidate(store, settings, {
        value: String(c.value),
        type: String(c.type ?? ""),
        name: String(c.name ?? ""),
        raw_fragment: c.raw_fragment,
        labels: c.labels,
        type_aliases: c.type_aliases,
        family: c.family,
        notes: c.notes,
        paste_id,
        allow_incomplete: true,
      });
      sendSSE("entries-changed", { action: "save" });
      res.json({ entry });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  r.post("/park", wrapAsync(async (req, res) => {
    const settings = store.getSettings();
    const items = Array.isArray(req.body?.candidates) ? req.body.candidates : [req.body];
    const paste_id = req.body?.paste_id;
    const saved = [];
    for (const c of items) {
      if (!c?.value) continue;
      saved.push(
        await saveCandidate(store, settings, {
          value: String(c.value),
          type: String(c.type ?? ""),
          name: String(c.name ?? ""),
          raw_fragment: c.raw_fragment,
          labels: c.labels,
          type_aliases: c.type_aliases,
          family: c.family || "unknown",
          paste_id,
          allow_incomplete: true,
        })
      );
    }
    res.json({ entries: saved });
  }));

  r.get("/", (req, res) => {
    const status = req.query.status as string | undefined;
    const family = req.query.family as string | undefined;
    if (status === "attention") {
      return res.json(store.getNeedsAttention());
    }
    res.json(store.listEntries({ status: status as any, family }));
  });

  r.get("/:id", (req, res) => {
    const e = store.getEntry(req.params.id);
    if (!e) return res.status(404).json({ error: "Not found" });
    res.json(e);
  });

  r.patch("/:id", wrapAsync(async (req, res) => {
    const updated = await clarifyEntry(store, store.getSettings(), req.params.id, {
      type: req.body?.type,
      name: req.body?.name,
      notes: req.body?.notes,
      labels: req.body?.labels,
      family: req.body?.family,
      value: req.body?.value,
    });
    if (!updated) return res.status(404).json({ error: "Not found" });
    res.json(updated);
  }));

  r.delete("/:id", (req, res) => {
    const ok = store.deleteEntry(req.params.id);
    if (!ok) return res.status(404).json({ error: "Not found" });
    addLog("VAULT", `Deleted entry ${req.params.id.slice(0, 8)}`);
    sendSSE("entries-changed", { action: "delete" });
    res.json({ success: true });
  });

  r.post("/bulk-delete", (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.json({ success: true, removed: 0 });
    const removed = store.bulkDeleteEntries(ids);
    addLog("VAULT", `Bulk deleted ${removed} entries`);
    sendSSE("entries-changed", { action: "bulk-delete" });
    res.json({ success: true, removed });
  });

  r.post("/check-duplicate", (req, res) => {
    const value = String(req.body?.value ?? "").trim();
    if (!value) return res.status(400).json({ error: "Value is required" });

    const entries = store.listEntries();
    const exactMatch = entries.find((e) => e.value === value);
    if (exactMatch) {
      return res.json({
        is_duplicate: true,
        existing_entry: exactMatch,
        match_type: "exact_value",
      });
    }

    const name = String(req.body?.name ?? "").trim().toLowerCase();
    if (name) {
      const similarName = entries.find(
        (e) => e.name.toLowerCase() === name && e.family !== "note" && e.family !== "command"
      );
      if (similarName) {
        return res.json({
          is_duplicate: true,
          existing_entry: similarName,
          match_type: "similar_name",
        });
      }
    }

    res.json({ is_duplicate: false });
  });

  return r;
}
