import "dotenv/config";
import express from "express";
import path from "path";
import { ensurePortableLayout } from "./server/paths.js";
import { VaultStore } from "./server/store.js";
import { addLog, getLogs } from "./server/logs.js";
import {
  checkOllama,
  pullOllamaModel,
  resolveActiveProvider,
  warmOllamaLlm,
} from "./server/ai/providers.js";
import { askVault } from "./server/services/ask.js";
import {
  clarifyEntry,
  runAnalyze,
  saveCandidate,
  saveMany,
} from "./server/services/vault.js";
import { scanFolder } from "./server/services/folderScan.js";
import { FolderWatcherManager } from "./server/services/folderWatcher.js";
import { listDirectory, listFsRoots } from "./server/services/fsBrowser.js";
import { randomUUID } from "crypto";
import type { AnalyzeCandidate, WatchedFolder } from "./server/types.js";

const paths = ensurePortableLayout();
const store = new VaultStore(paths);
const watchers = new FolderWatcherManager(store, () => store.getSettings());
const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// --- Vault Lock Middleware & Routes ---
function checkVaultUnlocked(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (store.isLocked()) {
    return res.status(423).json({ error: "Vault is locked", is_locked: true });
  }
  next();
}

app.use("/api/entries", checkVaultUnlocked);
app.use("/api/analyze", checkVaultUnlocked);
app.use("/api/folders", checkVaultUnlocked);
app.use("/api/ask", checkVaultUnlocked);
app.use("/api/snippets", checkVaultUnlocked);

app.get("/api/vault/status", (_req, res) => {
  res.json({
    is_locked: store.isLocked(),
    encryption_enabled: store.isEncryptionEnabled(),
  });
});

app.post("/api/vault/unlock", (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }
  const ok = store.unlock(password);
  if (ok) {
    addLog("SECURITY", "Vault successfully unlocked");
    res.json({ success: true });
  } else {
    addLog("SECURITY", "Failed unlock attempt");
    setTimeout(() => {
      res.status(401).json({ error: "Incorrect master password" });
    }, 500);
  }
});

app.post("/api/vault/lock", (_req, res) => {
  store.lock();
  addLog("SECURITY", "Vault locked");
  res.json({ success: true });
});

app.post("/api/vault/setup-password", (req, res) => {
  const { password } = req.body;
  if (!password || String(password).length < 4) {
    return res.status(400).json({ error: "Password must be at least 4 characters long" });
  }
  try {
    store.setupPassword(password);
    addLog("SECURITY", "Vault password configured & storage encrypted");
    res.json({ success: true });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/vault/remove-password", (req, res) => {
  const { password } = req.body;
  if (!password) {
    return res.status(400).json({ error: "Password is required" });
  }
  const ok = store.removePassword(password);
  if (ok) {
    addLog("SECURITY", "Vault password removed & storage decrypted");
    res.json({ success: true });
  } else {
    setTimeout(() => {
      res.status(401).json({ error: "Incorrect master password" });
    }, 500);
  }
});

addLog("SYSTEM", `IndexArc Vault portable root: ${paths.root}`);
addLog("SYSTEM", `Data → ${paths.dataDir} | Config → ${paths.configDir}`);

// --- Status ---
app.get("/api/ping", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/status", async (_req, res) => {
  const settings = store.getSettings();
  const ollama = await checkOllama(settings.ollama_base_url);
  const active = await resolveActiveProvider(settings);
  const stats = store.stats();
  res.json({
    portable_root: paths.root,
    ai_provider: settings.ai_provider,
    active_provider: active === "heuristic" ? "heuristic" : active,
    is_ollama_online: ollama.online,
    ollama_models: ollama.models,
    is_gemini_configured: !!settings.gemini_api_key,
    stats: {
      total_saved: stats.total_saved,
      needs_attention: stats.needs_attention,
      total_commands: stats.total_commands,
      total_notes: stats.total_notes,
      total_secrets: stats.total_secrets,
    },
  });
});

app.get("/api/logs", (_req, res) => res.json(getLogs()));

app.get("/api/settings", (_req, res) => {
  const s = store.getSettings();
  res.json({
    ...s,
    // never echo full key to client if long — still needed for form; mask in UI
    gemini_api_key: s.gemini_api_key,
  });
});

app.post("/api/settings", (req, res) => {
  const body = req.body || {};
  const allowed: (keyof ReturnType<typeof store.getSettings>)[] = [
    "ai_provider",
    "ollama_base_url",
    "ollama_llm_model",
    "ollama_embed_model",
    "gemini_api_key",
    "gemini_llm_model",
    "gemini_embed_model",
    "openai_api_key",
    "openai_llm_model",
    "groq_api_key",
    "groq_llm_model",
    "openrouter_api_key",
    "openrouter_llm_model",
    "anthropic_api_key",
    "anthropic_llm_model",
    "local_openai_base_url",
    "local_openai_api_key",
    "local_openai_llm_model",
    "ui_language",
  ];
  const patch: Record<string, unknown> = {};
  for (const k of allowed) {
    if (body[k] !== undefined) patch[k] = body[k];
  }
  if (
    patch.ai_provider &&
    ![
      "local",
      "api",
      "auto",
      "openai",
      "groq",
      "openrouter",
      "anthropic",
      "local_openai",
    ].includes(patch.ai_provider as string)
  ) {
    return res.status(400).json({ error: "Invalid ai_provider" });
  }
  const next = store.saveSettings(patch as Partial<ReturnType<typeof store.getSettings>>);
  addLog("SETTINGS", `Updated AI provider mode: ${next.ai_provider}`);
  res.json(next);
});

// --- Ollama helpers ---
app.get("/api/ollama/models", async (_req, res) => {
  const s = store.getSettings();
  const ollama = await checkOllama(s.ollama_base_url);
  res.json(ollama);
});

app.post("/api/ollama/ensure", async (_req, res) => {
  const s = store.getSettings();
  const ollama = await checkOllama(s.ollama_base_url);
  if (!ollama.online) return res.status(503).json({ error: "Ollama is not running" });
  const required = [s.ollama_llm_model, s.ollama_embed_model];
  for (const model of required) {
    const has = ollama.models.some(
      (m) => m === model || m.startsWith(model.split(":")[0])
    );
    if (!has) {
      addLog("OLLAMA", `Pulling model ${model}…`);
      await pullOllamaModel(s, model, (p) => addLog("OLLAMA", p));
    }
  }
  // Actually load the LLM into VRAM (not just the embedder)
  const warmed = await warmOllamaLlm(s);
  const updated = await checkOllama(s.ollama_base_url);
  res.json({ status: "success", models: updated.models, llm_loaded: warmed });
});

app.post("/api/ollama/warm", async (_req, res) => {
  const s = store.getSettings();
  const ollama = await checkOllama(s.ollama_base_url);
  if (!ollama.online) return res.status(503).json({ error: "Ollama is not running" });
  const ok = await warmOllamaLlm(s);
  res.json({ status: ok ? "success" : "failed", model: s.ollama_llm_model });
});

// --- Analyze (multi-extract, no save yet) ---
app.post("/api/analyze", async (req, res) => {
  const paste = String(req.body?.content ?? req.body?.paste ?? "").trim();
  if (!paste) return res.status(400).json({ error: "Paste content is required" });
  try {
    const result = await runAnalyze(store, store.getSettings(), paste);
    res.json(result);
  } catch (e: any) {
    addLog("ANALYZE", `Failed: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

// --- Save candidates (batch or single) ---
app.post("/api/entries/save", async (req, res) => {
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
    // single
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
    res.json({ entry });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Park incomplete (save as needs_*)
app.post("/api/entries/park", async (req, res) => {
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
});

app.get("/api/entries", (req, res) => {
  const status = req.query.status as string | undefined;
  const family = req.query.family as string | undefined;
  if (status === "attention") {
    return res.json(store.getNeedsAttention());
  }
  res.json(
    store.listEntries({
      status: status as any,
      family,
    })
  );
});

app.get("/api/entries/:id", (req, res) => {
  const e = store.getEntry(req.params.id);
  if (!e) return res.status(404).json({ error: "Not found" });
  res.json(e);
});

app.patch("/api/entries/:id", async (req, res) => {
  const updated = await clarifyEntry(store, store.getSettings(), req.params.id, {
    type: req.body?.type,
    name: req.body?.name,
    notes: req.body?.notes,
    labels: req.body?.labels,
  });
  if (!updated) return res.status(404).json({ error: "Not found" });
  res.json(updated);
});

app.delete("/api/entries/:id", (req, res) => {
  const ok = store.deleteEntry(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  addLog("VAULT", `Deleted entry ${req.params.id.slice(0, 8)}`);
  res.json({ success: true });
});

// --- Folder scan & watch ---
app.get("/api/folders", (_req, res) => {
  res.json({
    folders: store.listWatchedFolders().map((f) => ({
      ...f,
      live: watchers.isWatching(f.id),
    })),
    active_session_id: store.getActiveScanSession()?.id || null,
  });
});

app.get("/api/folders/sessions", (_req, res) => {
  res.json(store.listScanSessions());
});

app.get("/api/folders/sessions/active", (_req, res) => {
  const s = store.getActiveScanSession();
  if (!s) return res.status(404).json({ error: "No active review session" });
  res.json(s);
});

app.get("/api/folders/sessions/:id", (req, res) => {
  const s = store.getScanSession(req.params.id);
  if (!s) return res.status(404).json({ error: "Session not found" });
  res.json(s);
});

async function registerAndMaybeWatch(
  session: Awaited<ReturnType<typeof scanFolder>>,
  keepWatching: boolean
) {
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

/**
 * Server-side filesystem browser — reads folders in place on this machine.
 * Used by the web UI Browse dialog (no file upload).
 */
app.get("/api/fs/roots", (_req, res) => {
  try {
    res.json({ roots: listFsRoots() });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/fs/list", (req, res) => {
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

/** Full folder scan in place (absolute path on the machine running the server) */
app.post("/api/folders/scan", async (req, res) => {
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
    await registerAndMaybeWatch(session, keepWatching);
    res.json(session);
  } catch (e: any) {
    addLog("FOLDER", `Scan error: ${e.message}`);
    res.status(400).json({ error: e.message });
  }
});

/** Update candidate decisions / fields in a review session */
app.patch("/api/folders/sessions/:id/candidates", (req, res) => {
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

/**
 * Commit review session:
 * - decision=save or ready pending → vault save
 * - decision=park or incomplete pending → park as unidentified
 * - decision=discard → skip
 */
app.post("/api/folders/sessions/:id/commit", async (req, res) => {
  const session = store.getScanSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  if (session.status !== "review") {
    return res.status(400).json({ error: "Session already committed or discarded" });
  }

  const mode = String(req.body?.mode || "selected"); // selected | all_ready | all_pending
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
  res.json({ saved, parked, discarded, session_id: session.id });
});

/** Clearer commit: apply decisions */
app.post("/api/folders/sessions/:id/apply", async (req, res) => {
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

    // pending + ready → save; pending + not ready → park; explicit save/park honored
    let park = false;
    if (decision === "park") park = true;
    else if (decision === "save") park = false;
    else {
      // pending
      park = !c.ready;
    }

    // If user only wants ready and discard rest — handled via decisions in UI

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
  res.json({
    saved_count: saved.length,
    parked_count: parked.length,
    discarded_count: discarded,
    saved,
    parked,
  });
});

/** Discard entire session without saving */
app.post("/api/folders/sessions/:id/discard", (req, res) => {
  const session = store.getScanSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  store.updateScanSession(req.params.id, { status: "discarded" });
  addLog("FOLDER", `Discarded scan session ${req.params.id.slice(0, 8)}`);
  res.json({ success: true });
});

app.post("/api/folders/:id/unwatch", (req, res) => {
  watchers.stop(req.params.id);
  const folders = store.listWatchedFolders();
  const f = folders.find((x) => x.id === req.params.id);
  if (f) {
    f.watching = false;
    store.upsertWatchedFolder(f);
  }
  res.json({ success: true });
});

app.delete("/api/folders/:id", (req, res) => {
  watchers.stop(req.params.id);
  const ok = store.removeWatchedFolder(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// --- Ask (AR + EN) ---
app.post("/api/ask", async (req, res) => {
  const query = String(req.body?.query ?? "").trim();
  if (!query) return res.status(400).json({ error: "Query is required" });
  try {
    const result = await askVault(
      store,
      store.getSettings(),
      query,
      Number(req.body?.limit) || 12
    );
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Legacy aliases for older UI bits
app.get("/api/snippets", (_req, res) => {
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

async function startServer() {
  const settings = store.getSettings();
  const PORT = Number(process.env.PORT) || settings.port || 3000;
  const HOST = process.env.HOST || settings.bind_host || "127.0.0.1";

  if (process.env.NODE_ENV !== "production") {
    // Vite is dev-only — dynamic import so production desktop bundle stays lean
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = process.env.INDEXARC_DIST_DIR
      ? process.env.INDEXARC_DIST_DIR
      : path.join(paths.root, "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: `API route not found: ${req.path}` });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  // Always JSON for unknown /api routes (dev + prod)
  app.use("/api", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
  });

  app.listen(PORT, HOST, () => {
    addLog("SYSTEM", `Vault server listening on http://${HOST}:${PORT}`);
    console.log(`IndexArc Vault → http://${HOST}:${PORT}`);
    console.log(`Portable root → ${paths.root}`);
    try {
      watchers.restoreFromStore();
    } catch (e: any) {
      addLog("WATCH", `Restore watchers failed: ${e.message}`);
    }
  });
}

process.on("exit", () => watchers.stopAll());
process.on("SIGINT", () => {
  watchers.stopAll();
  process.exit(0);
});

startServer();
