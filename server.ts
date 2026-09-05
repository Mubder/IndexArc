import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { ensurePortableLayout } from "./server/paths.js";
import { VaultStore } from "./server/store.js";
import { addLog } from "./server/logs.js";
import { FolderWatcherManager } from "./server/services/folderWatcher.js";
import { apiAuthMiddleware, getLastActivity } from "./server/auth.js";
import { vaultRoutes, checkVaultUnlocked } from "./server/routes/vault.js";
import { entriesRoutes } from "./server/routes/entries.js";
import { foldersRoutes, fsRoutes } from "./server/routes/folders.js";
import { aiRoutes } from "./server/routes/ai.js";
import { spellcheckRoutes, createSpellcheckEngines } from "./server/routes/spellcheck.js";
import { settingsRoutes } from "./server/routes/settings.js";
import { miscRoutes } from "./server/routes/misc.js";
import { sseRoutes } from "./server/routes/sse.js";
import { sendSSE } from "./server/routes/sse.js";
import type { RouteContext } from "./server/routes/types.js";

const paths = ensurePortableLayout();
const store = new VaultStore(paths);
const watchers = new FolderWatcherManager(store, () => store.getSettings());
const app = express();

// --- Security Headers ---
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

app.use(express.json({ limit: "2mb" }));

// --- API authentication (pairing token + Host allowlist) ---
// Blocks DNS-rebinding and cross-site/CSRF access to every /api route.
// See server/auth.ts. Exemptions: /api/ping, /api/auth/bootstrap,
// /api/events with a one-time ticket.
app.use("/api", apiAuthMiddleware);

// Serve the app logo as the favicon to avoid 404s on /favicon.ico
app.get("/favicon.ico", (_req, res) => {
  res.sendFile(path.resolve("public", "Logo1.png"));
});

// Shared context for all route modules
const ctx: RouteContext = { store, watchers, paths, spellcheck: createSpellcheckEngines() };

// --- Vault routes (lock/unlock/setup — no auth required) ---
app.use("/api/vault", vaultRoutes(ctx));

// --- Protected routes (require unlocked vault) ---
const protectedPaths = ["/api/entries", "/api/analyze", "/api/folders", "/api/ask", "/api/snippets", "/api/scratchpad", "/api/fs"];
for (const p of protectedPaths) {
  app.use(p, checkVaultUnlocked(ctx));
}

// --- Analyze (Paste & Analyze — standalone) ---
app.post("/api/analyze", async (req, res) => {
  try {
    const settings = ctx.store.getSettings();
    const paste = String(req.body?.paste ?? "");
    if (!paste.trim()) return res.status(400).json({ error: "paste is required" });
    const { runAnalyze } = await import("./server/services/vault.js");
    const result = await runAnalyze(ctx.store, settings, paste);
    sendSSE("entries-changed", { action: "analyze" });
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// --- Entries (CRUD, save, park, check-duplicate) ---
app.use("/api/entries", entriesRoutes(ctx));

// --- Folder scan, watch, sessions, filesystem browser ---
app.use("/api/folders", foldersRoutes(ctx));
app.use("/api/fs", fsRoutes(ctx));

// --- Spellcheck ---
app.use("/api", spellcheckRoutes(ctx));

// --- Settings & Logs ---
app.use("/api", settingsRoutes(ctx));

// --- Misc (ping, backups, emergency, scratchpad, snippets) ---
app.use("/api", miscRoutes(ctx));

// --- AI routes (status, proofread, autocomplete, ollama, ask, rewrite) ---
app.use("/api", aiRoutes(ctx));

// --- SSE (Server-Sent Events for real-time updates) ---
app.use("/api", sseRoutes(ctx));

addLog("SYSTEM", `IndexArc Vault portable root: ${paths.root}`);
addLog("SYSTEM", `Data → ${paths.dataDir} | Config → ${paths.configDir}`);

// Automatic timestamped backup on every startup (keeps the last 10 copies).
try {
  const backup = store.backupVault(10);
  if (backup) {
    addLog("SYSTEM", `Vault backed up → ${backup}`);
  }
} catch {
  /* backups are best-effort; never block startup */
}

// Emergency snapshot on startup: a self-contained copy of everything, written
// to redundant machine locations that survive uninstall / moved folder.
try {
  const snap = store.createEmergencySnapshot();
  if (snap) {
    addLog("SYSTEM", `Emergency snapshot created → ${snap}`);
  }
} catch {
  /* best-effort */
}

// Integrity check: compare data files against the HMAC manifest. Detects
// accidental corruption/overwrites (bit-rot, crashed editors) — the manifest
// key lives on the same disk, so this is recovery aid, not a security boundary.
try {
  for (const w of store.verifyIntegrity()) {
    addLog("DATA", `Integrity warning: ${w}`);
  }
} catch {
  /* best-effort */
}

// Auto-lock: lock the vault after configured minutes without any API activity.
// Only applies when a master password is set (otherwise there is nothing to
// lock). 0 disables.
const AUTO_LOCK_CHECK_MS = 15_000;
setInterval(() => {
  try {
    const settings = store.getSettings();
    const minutes = Number(settings.auto_lock_minutes) || 0;
    if (minutes <= 0) return;
    if (!store.isEncryptionEnabled()) return; // no password set — nothing to lock
    if (store.isLocked()) return; // already locked
    if (Date.now() - getLastActivity() < minutes * 60_000) return;
    store.lock();
    addLog("SECURITY", `Vault auto-locked after ${minutes} minute(s) of inactivity`);
    sendSSE("vault-changed", { locked: true });
  } catch {
    /* best-effort */
  }
}, AUTO_LOCK_CHECK_MS);

async function startServer() {
  const settings = store.getSettings();
  const PORT = Number(process.env.PORT) || settings.port || 3000;
  const HOST = process.env.HOST || settings.bind_host || "127.0.0.1";

  if (process.env.NODE_ENV !== "production") {
    try {
      const vitePkg = "vite";
      const { createServer: createViteServer } = await import(/* @vite-ignore */ vitePkg);
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } catch {
      console.log("[server] Running in production static mode.");
    }
  } else {
    const distPath = (process.env.INDEXARC_DIST_DIR && fs.existsSync(path.join(process.env.INDEXARC_DIST_DIR, "index.html")))
      ? process.env.INDEXARC_DIST_DIR
      : fs.existsSync(path.join(__dirname, "index.html"))
      ? __dirname
      : path.join(__dirname, "..", "dist");

    addLog("SYSTEM", `Serving static web assets from ${distPath}`);
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
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

  // JSON error handler: Express 4 rejections wrapped with wrapAsync land here.
  // Returns JSON (never an HTML stack trace with absolute paths).
  app.use(
    (err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      const status = Number(err?.status || err?.statusCode) || 500;
      if (status >= 500) addLog("ERROR", `${req.method} ${req.path} → ${err?.message || err}`);
      res.status(status).json({ error: err?.message || "Internal server error" });
    }
  );

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
