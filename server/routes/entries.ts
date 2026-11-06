import { Router } from "express";
import { addLog } from "../logs.js";
import { saveCandidate, saveMany, clarifyEntry } from "../services/vault.js";
import { sendSSE } from "./sse.js";
import { wrapAsync } from "../asyncWrap.js";
import type { RouteContext } from "./types.js";
import path from "path";
import { findUsages, hygienePatch, hygieneSummary } from "../hygiene.js";
import { validateBody } from "../request-body.js";
import { BODIES } from "./bodies.js";
import { envType, parseEnv } from "../porting.js";
import { envKey, findAppKey, normalizeAppName, normalizeEnvName, sameName } from "../../shared/apps.js";

export function entriesRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;
  // Each candidate in a bulk save can trigger an embedding round-trip —
  // cap the batch so one 2 MB body can't enqueue thousands of them.
  const MAX_SAVE_ITEMS = 200;

  r.post("/save", validateBody(BODIES.entries["POST /save"]), async (req, res) => {
    const settings = store.getSettings();
    const paste_id = req.body?.paste_id as string | undefined;
    const items = req.body?.candidates || req.body?.items;
    try {
      if (Array.isArray(items) && items.length) {
        if (items.length > MAX_SAVE_ITEMS) {
          return res.status(413).json({ error: `Too many candidates in one save (max ${MAX_SAVE_ITEMS}) — split the batch` });
        }
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
            app: c.app,
            env: c.env,
            allow_incomplete: true,
          }))
        );
        // Bulk saves changed the vault too — other windows need the event
        // (only the single-candidate branch used to broadcast).
        sendSSE("entries-changed", { action: "save", count: saved.length });
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
        app: c.app,
        env: c.env,
        allow_incomplete: true,
      });
      sendSSE("entries-changed", { action: "save" });
      res.json({ entry });
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  r.post("/park", validateBody(BODIES.entries["POST /park"]), wrapAsync(async (req, res) => {
    const settings = store.getSettings();
    const items = Array.isArray(req.body?.candidates) ? req.body.candidates : [req.body];
    if (items.length > MAX_SAVE_ITEMS) {
      return res.status(413).json({ error: `Too many candidates in one park (max ${MAX_SAVE_ITEMS}) — split the batch` });
    }
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
    if (saved.length) sendSSE("entries-changed", { action: "park", count: saved.length });
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

  // Secret hygiene (R6.3). Registered before "/:id".
  r.get("/hygiene", (_req, res) => {
    res.json(hygieneSummary(store.listEntries()));
  });

  r.patch("/:id/hygiene", validateBody(BODIES.entries["PATCH /:id/hygiene"]), (req, res) => {
    let patch;
    try {
      patch = hygienePatch(req.body);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    const updated = store.updateEntry(req.params.id, patch);
    if (!updated) return res.status(404).json({ error: "Not found" });
    sendSSE("entries-changed", { action: "hygiene" });
    res.json(updated);
  });

  // "Where is this key used": search watched folders (and the entry's own
  // source file's folder) for the value. Local only; paths are returned,
  // never file contents.
  r.get("/:id/usages", (req, res) => {
    const e = store.getEntry(req.params.id);
    if (!e) return res.status(404).json({ error: "Not found" });
    if (!e.value || e.value.length < 6) return res.status(400).json({ error: "Value too short to search for reliably" });
    const roots = store.listWatchedFolders().map((f) => f.path);
    if (e.source_file) roots.push(path.dirname(e.source_file));
    if (!roots.length) return res.json({ usages: [], scanned_files: 0, truncated: false, roots: 0 });
    res.json({ ...findUsages(e.value, [...new Set(roots)]), roots: new Set(roots).size });
  });

  r.get("/:id", (req, res) => {
    const e = store.getEntry(req.params.id);
    if (!e) return res.status(404).json({ error: "Not found" });
    res.json(e);
  });

  r.patch("/:id", validateBody(BODIES.entries["PATCH /:id"]), wrapAsync(async (req, res) => {
    const updated = await clarifyEntry(store, store.getSettings(), req.params.id, {
      type: req.body?.type,
      name: req.body?.name,
      notes: req.body?.notes,
      labels: req.body?.labels,
      family: req.body?.family,
      value: req.body?.value,
      app: req.body?.app,
      env: req.body?.env,
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

  // ── Applications (shared/apps.ts) ──────────────────────────────────────
  // Save keys into one application and environment. A key whose .env name
  // already exists there is updated in place (the value change counts as a
  // rotation); otherwise it is created. `text` takes .env lines instead of
  // `items`. `dry_run` reports what would happen without writing.
  r.post("/apps/upsert", validateBody(BODIES.entries["POST /apps/upsert"]), wrapAsync(async (req, res) => {
    const app = normalizeAppName(req.body.app);
    if (!app) return res.status(400).json({ error: "Name the application." });
    const env = normalizeEnvName(req.body.env);
    let skipped: Record<string, number> = {};
    let items: Array<{ name: string; value: string; type?: string; notes?: string }> = [];
    if (typeof req.body.text === "string" && req.body.text.trim()) {
      const parsed = parseEnv(req.body.text);
      skipped = parsed.skipped;
      items = parsed.candidates.map((c) => ({ name: c.name, value: c.value, type: c.type }));
    } else if (Array.isArray(req.body.items)) {
      items = req.body.items.map((i: any) => ({
        name: String(i.name || "").trim(),
        value: String(i.value ?? ""),
        type: i.type ?? undefined,
        notes: i.notes ?? undefined,
      }));
    }
    items = items.filter((i) => i.name && i.value);
    const MAX_KEYS = 1000;
    if (items.length > MAX_KEYS) return res.status(413).json({ error: `Too many keys in one save (max ${MAX_KEYS})` });
    // Later lines win, as in a .env file.
    const byKey = new Map<string, (typeof items)[number]>();
    for (const i of items) byKey.set(envKey(i.name), i);
    const entries = store.listEntries();
    const plan = [...byKey.values()].map((i) => {
      const existing = findAppKey(entries, app, env, i.name);
      const status: "new" | "same" | "update" = !existing ? "new" : existing.value === i.value ? "same" : "update";
      return { item: i, existing, status };
    });
    const report = plan.map((p) => ({ name: p.item.name, key: envKey(p.item.name), status: p.status, id: p.existing?.id }));
    if (req.body.dry_run === true) return res.json({ app, env, items: report, skipped });
    const settings = store.getSettings();
    const now = new Date().toISOString();
    for (const [i, p] of plan.entries()) {
      if (p.status === "new") {
        const e = await saveCandidate(store, settings, {
          value: p.item.value,
          name: p.item.name,
          type: p.item.type || envType(p.item.name),
          family: "secret",
          notes: p.item.notes,
          app,
          env,
          allow_incomplete: true,
        });
        report[i].id = e.id;
      } else if (p.status === "update" && p.existing) {
        await clarifyEntry(store, settings, p.existing.id, { value: p.item.value });
        store.updateEntry(p.existing.id, { last_rotated_at: now });
      }
    }
    const count = (s: string) => plan.filter((p) => p.status === s).length;
    addLog("VAULT", `Application save: ${count("new")} new, ${count("update")} updated, ${count("same")} unchanged`);
    if (count("new") || count("update")) sendSSE("entries-changed", { action: "apps-upsert" });
    res.json({ app, env, items: report, skipped, created: count("new"), updated: count("update"), unchanged: count("same") });
  }));

  // Move entries into an application and environment, or out of any (no app).
  r.post("/apps/assign", validateBody(BODIES.entries["POST /apps/assign"]), (req, res) => {
    const app = normalizeAppName(req.body.app);
    const env = app ? normalizeEnvName(req.body.env) : undefined;
    let moved = 0;
    for (const id of new Set<string>(req.body.ids)) {
      if (store.updateEntry(id, { app, env })) moved++;
    }
    if (moved) sendSSE("entries-changed", { action: "apps-assign" });
    res.json({ moved });
  });

  // Rename an application; renaming onto an existing one merges them.
  r.post("/apps/rename", validateBody(BODIES.entries["POST /apps/rename"]), (req, res) => {
    const from = normalizeAppName(req.body.from);
    const to = normalizeAppName(req.body.to);
    if (!from || !to) return res.status(400).json({ error: "Name the application." });
    let renamed = 0;
    for (const e of store.listEntries()) {
      if (sameName(e.app, from) && e.app !== to) {
        store.updateEntry(e.id, { app: to });
        renamed++;
      }
    }
    // The application's notes move with it.
    const notes = store.renameScratchpadApp((a) => sameName(a as string | undefined, from), to);
    if (renamed) sendSSE("entries-changed", { action: "apps-rename" });
    res.json({ renamed, notes });
  });

  r.post("/bulk-delete", validateBody(BODIES.entries["POST /bulk-delete"]), (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.json({ success: true, removed: 0 });
    const removed = store.bulkDeleteEntries(ids);
    addLog("VAULT", `Bulk deleted ${removed} entries`);
    sendSSE("entries-changed", { action: "bulk-delete" });
    res.json({ success: true, removed });
  });

  r.post("/check-duplicate", validateBody(BODIES.entries["POST /check-duplicate"]), (req, res) => {
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
      // Hand-edited/legacy vault JSON can miss `name` — guard before the
      // toLowerCase (a throw here 500s the whole duplicate check).
      const similarName = entries.find(
        (e) => (e.name || "").toLowerCase() === name && e.family !== "note" && e.family !== "command"
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
