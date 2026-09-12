import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { ensurePortableLayout, findAlternateVaultRoots } from "./server/paths.js";
import { VaultStore } from "./server/store.js";
import { AuditLog } from "./server/audit.js";
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
const audit = new AuditLog(paths);
audit.log("server.start", `root=${paths.root}`);
// Egress gate for the shared LanguageTool engine: public API is opt-in.
try {
  process.env.INDEXARC_LT_PUBLIC = store.getSettings().languagetool_enabled ? "1" : "";
} catch {
  process.env.INDEXARC_LT_PUBLIC = "";
}
// Settings secrets: with an OS-keychain key present (packaged builds), wrap
// any legacy plaintext API keys immediately. Without one (dev/standalone),
// say so once — plaintext keys on disk are a known dev-mode limitation.
try {
  if (store.settingsNeedsSecretMigration()) {
    store.saveSettings({});
    addLog("SECURITY", "Settings API keys migrated to OS-keychain-wrapped storage.");
  } else if (!process.env.INDEXARC_SETTINGS_KEY) {
    addLog("SECURITY", "No OS keychain key available — settings API keys remain plaintext at rest (dev/standalone mode).");
  }
} catch {
  /* best-effort */
}
// Electron's will-quit calls this (the server runs inside the main process)
// so a pending debounced emergency snapshot is flushed to the machine-level
// locations before the process dies — e.g. when the user quits to run a
// reinstall that would wipe the install folder.
(globalThis as any).__indexarcFlushEmergency = () => store.flushEmergencySnapshot();
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
const ctx: RouteContext = { store, watchers, paths, spellcheck: createSpellcheckEngines(), audit };

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
    // Clients send the pasted text as `content` (Scratchpad detect, Home and
    // Analyze tabs); `paste` is accepted as a legacy alias.
    const paste = String(req.body?.paste ?? req.body?.content ?? "");
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

// Startup census: which folder is actually serving, and how much is in it.
// When the app "comes back empty", this line (plus GET /api/health) tells us
// whether the server is pointed at a fresh/empty folder instead of the real
// vault (dev sandbox vs project folder vs packaged exe folder).
try {
  const locked = store.isLocked();
  const encrypted = store.isEncryptionEnabled();
  let vaultTotal: number | string = "?";
  try {
    vaultTotal = locked ? "locked" : store.stats().total;
  } catch {
    vaultTotal = "unreadable";
  }
  let tabs: number | string = "?";
  try {
    tabs = locked ? "locked" : store.getScratchpad().length;
  } catch {
    tabs = "unreadable";
  }
  addLog("SYSTEM", `Startup census: vault entries=${vaultTotal} scratchpad tabs=${tabs} encrypted=${encrypted} locked=${locked}`);
  if (!locked && vaultTotal === 0) {
    const alts = findAlternateVaultRoots(paths.root).filter((a) => (a.vaultEntries ?? 0) > 0);
    for (const a of alts) {
      addLog("DATA", `Empty vault here, but ${a.vaultEntries} entries exist at ${a.root} — relaunch from that folder/build or restore from Settings → Emergency Plan.`);
    }
    if (!alts.length) {
      // The classic post-reinstall wipe: the install folder was deleted (its
      // data/ went with it), but machine-level emergency snapshots survived.
      const snaps = store.listEmergencySnapshots().filter((s) => s.has_vault || s.has_notes);
      if (snaps.length) {
        addLog("DATA", `Empty vault here. ${snaps.length} emergency snapshot(s) survived (newest: ${snaps[0].created_at}) — restore from Settings → Emergency Plan to get your data back.`);
      }
    }
  }
} catch {
  /* best-effort */
}

// Startup sweep: atomicWrite stages `.<name>.<pid>.tmp` files that a crash
// between write and rename would leave behind — with full vault/note
// payloads. Anything older than 5 minutes is guaranteed stale (a live
// concurrent instance rewrites its staging file within milliseconds).
try {
  const staleCutoff = Date.now() - 5 * 60_000;
  let swept = 0;
  for (const dir of [paths.dataDir, paths.configDir, paths.backupsDir]) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!/^\..+\.\d+\.tmp$/.test(f)) continue;
      try {
        const full = path.join(dir, f);
        if (fs.statSync(full).mtimeMs < staleCutoff) {
          fs.unlinkSync(full);
          swept++;
        }
      } catch {}
    }
  }
  if (swept) addLog("DATA", `Swept ${swept} stale atomic-write temp file(s) holding pre-crash payloads.`);
} catch {
  /* best-effort */
}

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

  // Always JSON for unknown /api routes (dev + prod). No method/path echo —
  // a prober gets a bare 404 and nothing to fingerprint with.
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found" });
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

  // Bind with conflict recovery: another app squatting the preferred port
  // must neither crash us nor (worse) let the shell load the squatter's UI.
  // Walk up to +20 ports, then fall back to an OS-assigned ephemeral port.
  // The ACTUAL port is exported via env for the Electron shell, which also
  // verifies this server's identity before loading it (see /api/ping).
  const listenReady = (server: import("http").Server) => {
    const addr = server.address() as { port: number };
    process.env.INDEXARC_ACTUAL_PORT = String(addr.port);
    addLog("SYSTEM", `Vault server listening on http://${HOST}:${addr.port}`);
    console.log(`IndexArc Vault → http://${HOST}:${addr.port}`);
    console.log(`Portable root → ${paths.root}`);
    try {
      watchers.restoreFromStore();
    } catch (e: any) {
      addLog("WATCH", `Restore watchers failed: ${e.message}`);
    }
  };

  const listenWithRetry = (port: number, attempt: number): void => {
    const server = app.listen(port, HOST, () => listenReady(server));
    server.on("error", (err: any) => {
      if (err?.code === "EADDRINUSE" && attempt < 20) {
        addLog("SYSTEM", `Port ${port} is already in use — trying ${port + 1}`);
        listenWithRetry(port + 1, attempt + 1);
      } else if (err?.code === "EADDRINUSE") {
        addLog("SYSTEM", "All preferred ports busy — binding to an OS-assigned ephemeral port.");
        const ephemeral = app.listen(0, HOST, () => listenReady(ephemeral));
        ephemeral.on("error", (fatal: any) => {
          console.error("Vault server failed to bind:", fatal);
          process.exit(1);
        });
      } else {
        console.error("Vault server failed to start:", err);
        process.exit(1);
      }
    });
  };

  listenWithRetry(PORT, 0);
}

process.on("exit", () => watchers.stopAll());
process.on("SIGINT", () => {
  watchers.stopAll();
  process.exit(0);
});

startServer();
