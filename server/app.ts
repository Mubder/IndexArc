import express from "express";
import path from "path";
import type { PortablePaths } from "./paths.js";
import type { VaultStore } from "./store.js";
import type { AuditLog } from "./audit.js";
import type { FolderWatcherManager } from "./services/folderWatcher.js";
import { apiAuthMiddleware, setCliVerifier } from "./auth.js";
import { verifyCliToken } from "./cli.js";
import { cliRoutes } from "./routes/cli.js";
import { vaultRoutes, checkVaultUnlocked } from "./routes/vault.js";
import { entriesRoutes } from "./routes/entries.js";
import { portingRoutes } from "./routes/porting.js";
import { foldersRoutes, fsRoutes } from "./routes/folders.js";
import { aiRoutes } from "./routes/ai.js";
import { spellcheckRoutes, createSpellcheckEngines } from "./routes/spellcheck.js";
import { settingsRoutes } from "./routes/settings.js";
import { miscRoutes } from "./routes/misc.js";
import { sseRoutes } from "./routes/sse.js";
import { sendSSE } from "./routes/sse.js";
import type { RouteContext } from "./routes/types.js";

// Paths that ADDITIONALLY require the vault to be unlocked (see the gating
// matrix below). Exported so the route lock-matrix test can assert against
// the same list the app mounts.
// /api/proofread and /api/rewrite: while locked the server cannot tell
// whether the text comes from a protected note. /api/ollama/ensure: no
// multi-GB downloads before the user has unlocked (R1.5).
export const protectedPaths = [
  "/api/entries",
  "/api/analyze",
  "/api/folders",
  "/api/ask",
  "/api/snippets",
  "/api/scratchpad",
  "/api/fs",
  "/api/proofread",
  "/api/rewrite",
  "/api/ollama/ensure",
  // Recovery-key status / create / remove. NOT /api/vault/recover (the
  // locked-state "forgot password" entry point, a different path).
  "/api/vault/recovery",
  // Import preview + export (R6.2).
  "/api/porting",
  // CLI token management + CLI reads (R6.1).
  "/api/cli",
];

export interface CreateAppDeps {
  paths: PortablePaths;
  store: VaultStore;
  audit: AuditLog;
  watchers: FolderWatcherManager;
}

/**
 * Builds the Express app with every security middleware and API route
 * mounted — no listen, no timers, no startup side effects. server.ts adds the
 * dev/static frontend, the /api 404 + JSON error handlers and binds the port;
 * tests mount this directly on an ephemeral port.
 */
export function createApp({ paths, store, audit, watchers }: CreateAppDeps): { app: express.Express; ctx: RouteContext } {
  const app = express();

  // --- Security Headers ---
  // CSP header mirrors the <meta http-equiv="Content-Security-Policy"> in
  // index.html EXACTLY (both apply — the stricter intersection wins; keeping
  // them identical avoids drift) and adds frame-ancestors, which a meta tag
  // cannot express. SSE uses same-origin http (EventSource), so connect-src
  // needs no ws:.
  const CSP_DIRECTIVES = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'", // React inline style attributes
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("Content-Security-Policy", CSP_DIRECTIVES);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    next();
  });

  // API responses carry decrypted vault data: keep them out of Chromium's
  // HTTP disk cache (ASVS 8.2.1). Routes may still override (SSE: no-cache).
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
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
  const ctx: RouteContext = { store, watchers, paths, spellcheck: createSpellcheckEngines(paths), audit };

  // CLI tokens are verified against digests keyed from the vault key.
  setCliVerifier((presented) => {
    const digest = store.cliDigester();
    if (!digest) return "locked";
    return verifyCliToken(paths.cliTokensFile, presented, digest);
  });

  // --- Vault routes (lock/unlock/setup — no auth required) ---
  app.use("/api/vault", vaultRoutes(ctx));

  // --- Protected routes (require unlocked vault) ---
  for (const p of protectedPaths) {
    app.use(p, checkVaultUnlocked(ctx));
  }

  // GATING MATRIX (documented by design — audited; enforced by
  // server/route-matrix.test.ts):
  //   • EVERY /api route (incl. /api/vault) requires the pairing token
  //     (apiAuthMiddleware) except /api/ping, opt-in /api/auth/bootstrap, and
  //     /api/events with a one-time ticket.
  //   • The paths above ADDITIONALLY require the vault to be unlocked.
  //   • Deliberately token-gated but reachable while LOCKED (needed by the
  //     pre-unlock UI, and safe by construction):
  //       /api/status, /api/settings (GET returns *_configured booleans only —
  //       keys are masked; POST is sticky-write-only), /api/logs (entries are
  //       redacted by policy — ids, never values), /api/health (read-only
  //       diagnostics), /api/backups + /api/emergency* (metadata only; restore
  //       re-locks), /api/audit (hash-chained, ids only), spellcheck routes.
  //     A token holder while locked learns vault METADATA, never secret values.

  // --- Analyze (Paste & Analyze — standalone) ---
  app.post("/api/analyze", async (req, res) => {
    try {
      const settings = ctx.store.getSettings();
      // Clients send the pasted text as `content` (Scratchpad detect, Home and
      // Analyze tabs); `paste` is accepted as a legacy alias.
      const paste = String(req.body?.paste ?? req.body?.content ?? "");
      if (!paste.trim()) return res.status(400).json({ error: "paste is required" });
      const { runAnalyze } = await import("./services/vault.js");
      const result = await runAnalyze(ctx.store, settings, paste);
      sendSSE("entries-changed", { action: "analyze" });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // --- Entries (CRUD, save, park, check-duplicate) ---
  app.use("/api/entries", entriesRoutes(ctx));
  app.use("/api/porting", portingRoutes(ctx));
  app.use("/api/cli", cliRoutes(ctx));

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

  return { app, ctx };
}
