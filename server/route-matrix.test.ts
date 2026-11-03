import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { ensurePortableLayout } from "./paths.js";
import { VaultStore } from "./store.js";
import { AuditLog } from "./audit.js";
import { FolderWatcherManager } from "./services/folderWatcher.js";
import { createApp, protectedPaths } from "./app.js";

// R4 route lock matrix. Builds the REAL app (server/app.ts — same middleware
// and mounts as production), enumerates every registered route from the
// Express router stack, and checks each against an explicit policy table:
//   public          — no token needed (Host / Sec-Fetch-Site still enforced)
//   token           — pairing token required; reachable while LOCKED, and
//                     must never return seeded secret values while locked
//   token+unlocked  — pairing token AND unlocked vault (423 while locked)
// A registered route missing from POLICY fails the suite, so a new route
// cannot ship without someone deciding its policy.

type Policy = "public" | "token" | "token+unlocked";

const POLICY: Record<string, Policy> = {
  // --- vault (lock/unlock/setup) ---
  "GET /api/vault/status": "token",
  "POST /api/vault/unlock": "token",
  "POST /api/vault/lock": "token",
  "POST /api/vault/setup-password": "token",
  "POST /api/vault/remove-password": "token",

  // --- analyze ---
  "POST /api/analyze": "token+unlocked",

  // --- entries ---
  "POST /api/entries/save": "token+unlocked",
  "POST /api/entries/park": "token+unlocked",
  "GET /api/entries": "token+unlocked",
  "GET /api/entries/:id": "token+unlocked",
  "PATCH /api/entries/:id": "token+unlocked",
  "DELETE /api/entries/:id": "token+unlocked",
  "POST /api/entries/bulk-delete": "token+unlocked",
  "POST /api/entries/check-duplicate": "token+unlocked",

  // --- folders / fs ---
  "GET /api/folders": "token+unlocked",
  "GET /api/folders/sessions": "token+unlocked",
  "GET /api/folders/sessions/active": "token+unlocked",
  "GET /api/folders/sessions/:id": "token+unlocked",
  "POST /api/folders/scan": "token+unlocked",
  "PATCH /api/folders/sessions/:id/candidates": "token+unlocked",
  "POST /api/folders/sessions/:id/apply": "token+unlocked",
  "POST /api/folders/sessions/:id/discard": "token+unlocked",
  "DELETE /api/folders/:id": "token+unlocked",
  "GET /api/fs/list": "token+unlocked",

  // --- spellcheck (no vault data) ---
  "POST /api/spellcheck-words": "token",
  "POST /api/spellcheck-suggest": "token",
  "POST /api/spellcheck-add-word": "token",
  "POST /api/spellcheck-ignore-word": "token",

  // --- settings & logs ---
  "GET /api/logs": "token",
  "GET /api/settings": "token",
  "POST /api/settings": "token",

  // --- misc ---
  "GET /api/ping": "public",
  "GET /api/health": "token",
  "GET /api/backups": "token",
  "GET /api/emergency": "token",
  "GET /api/integrity": "token",
  "GET /api/audit": "token",
  "POST /api/emergency/create": "token",
  "POST /api/emergency/restore": "token",
  "GET /api/scratchpad": "token+unlocked",
  "GET /api/scratchpad/tabs/:id/revisions": "token+unlocked",
  "POST /api/scratchpad/tabs/:id/revisions": "token+unlocked",
  "GET /api/scratchpad/revisions/orphaned": "token+unlocked",
  "POST /api/scratchpad/tabs/:id/content": "token+unlocked",
  "POST /api/scratchpad/tabs/:id/meta": "token+unlocked",
  "DELETE /api/scratchpad/tabs/:id": "token+unlocked",
  "POST /api/scratchpad/tabs/:id/protect": "token+unlocked",
  "POST /api/scratchpad/tabs/:id/pin": "token+unlocked",
  "PUT /api/scratchpad/order": "token+unlocked",
  "POST /api/scratchpad": "token+unlocked",
  "GET /api/scratchpad/archive": "token+unlocked",
  "GET /api/scratchpad/archive/count": "token+unlocked",
  "GET /api/scratchpad/archive/verify": "token+unlocked",
  "POST /api/scratchpad/archive-tab": "token+unlocked",
  "POST /api/scratchpad/restore-tab": "token+unlocked",
  "POST /api/scratchpad/delete-archived": "token+unlocked",
  "GET /api/snippets": "token+unlocked",

  // --- AI (caller-supplied text only, or vault-wide via /ask) ---
  "GET /api/status": "token",
  "POST /api/proofread": "token+unlocked",
  "POST /api/autocomplete": "token",
  "POST /api/ollama/ensure": "token+unlocked",
  "POST /api/ollama/warm": "token",
  "POST /api/ask": "token+unlocked",
  "POST /api/rewrite": "token+unlocked",

  // --- SSE ---
  "POST /api/sse/ticket": "token",
  // Token OR a one-time ticket (EventSource cannot send headers).
  "GET /api/events": "token",
};

// Non-/api routes registered on the app (not behind apiAuthMiddleware).
const NON_API_ROUTES = ["GET /favicon.ico"];

// Distinctive secret values seeded BEFORE locking. None may ever appear in a
// response while the vault is locked.
const SECRET_VALUE = "R4SECRETVALUE-7f3a9c1e5b";
const SECRET_NOTE = "R4SECRETNOTE-2d8e4f6a0c";
const SECRET_TAB = "R4SECRETTAB-9b1c3e5d7f";
const SECRET_REV = "R4SECRETREV-4a6c8e0b2d";
const SECRET_API_KEY = "R4SECRETAPIKEY-1e3g5i7k9m";
const SECRETS = [SECRET_VALUE, SECRET_NOTE, SECRET_TAB, SECRET_REV, SECRET_API_KEY];

const PASSWORD = "r4-matrix-correct-horse";

interface RouteKey {
  method: string;
  path: string;
}

/** Recover the mount path of an Express 4 router layer from its regexp. */
function mountPathOf(layer: any): string {
  if (layer.regexp?.fast_slash) return "";
  const src: string = layer.regexp.source;
  const m = src.match(/^\^(.*?)\\\/\?\(\?=\\\/\|\$\)$/);
  if (!m) throw new Error(`Unrecognised router mount regexp: ${src}`);
  return m[1].replace(/\\\//g, "/").replace(/\\(.)/g, "$1");
}

/** Walk app._router.stack (incl. mounted routers) into METHOD + path pairs. */
function enumerateRoutes(app: any): RouteKey[] {
  const out: RouteKey[] = [];
  const walk = (stack: any[], prefix: string) => {
    for (const layer of stack) {
      if (layer.route) {
        const p = layer.route.path;
        if (typeof p !== "string") throw new Error(`Non-string route path under ${prefix}: ${String(p)}`);
        let full = prefix + p;
        if (full.length > 1 && full.endsWith("/")) full = full.slice(0, -1);
        for (const method of Object.keys(layer.route.methods)) {
          if (method === "_all") continue;
          out.push({ method: method.toUpperCase(), path: full });
        }
      } else if (layer.name === "router" && Array.isArray(layer.handle?.stack)) {
        walk(layer.handle.stack, prefix + mountPathOf(layer));
      }
    }
  };
  walk(app._router.stack, "");
  return out;
}

const key = (r: RouteKey) => `${r.method} ${r.path}`;
const concrete = (p: string) => p.replace(/:(\w+)/g, "r4-$1");

interface Resp {
  status: number;
  body: string;
  contentType: string;
}

let port = 0;

function send(
  method: string,
  urlPath: string,
  opts: { host?: string; headers?: Record<string, string>; body?: unknown } = {}
): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const payload = method === "GET" || method === "HEAD" ? undefined : JSON.stringify(opts.body ?? {});
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        method,
        path: urlPath,
        headers: {
          Host: opts.host ?? `127.0.0.1:${port}`,
          ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
          ...(opts.headers || {}),
        },
      },
      (res) => {
        const contentType = String(res.headers["content-type"] || "");
        const chunks: Buffer[] = [];
        // SSE never ends: take the first chunk and hang up.
        if (contentType.startsWith("text/event-stream")) {
          res.once("data", (c: Buffer) => {
            resolve({ status: res.statusCode || 0, body: c.toString("utf8"), contentType });
            req.destroy();
          });
          return;
        }
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8"), contentType })
        );
      }
    );
    req.on("error", (e: any) => {
      if (e?.code === "ECONNRESET") return; // our own destroy() after SSE
      reject(e);
    });
    if (payload) req.write(payload);
    req.end();
  });
}

describe("R4 route lock matrix", () => {
  let tmpDir: string;
  let store: VaultStore;
  let watchers: FolderWatcherManager;
  let server: http.Server;
  let routes: RouteKey[];
  let token: string;
  const outbound: string[] = [];

  beforeAll(async () => {
    // No route may reach the network during the matrix run (/api/health,
    // /api/status and /api/ollama/* probe Ollama; /ensure could PULL models).
    vi.stubGlobal("fetch", async (input: any) => {
      outbound.push(String(input?.url ?? input));
      throw new TypeError("fetch disabled in route-matrix test");
    });

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-route-matrix-"));
    const paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    const audit = new AuditLog(paths);
    watchers = new FolderWatcherManager(store, () => store.getSettings());
    const { app } = createApp({ paths, store, audit, watchers });
    routes = enumerateRoutes(app);

    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
    token = String(process.env.INDEXARC_API_TOKEN || "");

    // Seed secrets everywhere a locked route could plausibly leak them from.
    store.createEntry({
      value: SECRET_VALUE,
      type: "api key",
      name: "r4 matrix key",
      raw_fragment: `KEY=${SECRET_VALUE}`,
      labels: [],
      type_aliases: [],
      status: "saved",
      family: "secret",
      notes: SECRET_NOTE,
    } as any);
    const tab = store.updateScratchpadTabContent("r4-tab", SECRET_TAB, undefined, false, "r4 tab");
    expect(tab.ok).toBe(true);
    store.addNoteRevision({
      id: "r4-rev",
      tabId: "r4-tab",
      timestamp: Date.now(),
      title: "r4 tab",
      content: SECRET_REV,
      charCount: SECRET_REV.length,
      wordCount: 1,
    });
    store.saveSettings({ gemini_api_key: SECRET_API_KEY, auto_lock_minutes: 0 });

    await store.setupPassword(PASSWORD);
    store.lock();
    expect(store.isLocked()).toBe(true);
  }, 120_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    watchers?.stopAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const apiRoutes = () => routes.filter((r) => r.path.startsWith("/api"));

  it("enumerates the router stack (sanity)", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.map(key)).toContain("GET /api/ping");
    expect(routes.map(key)).toContain("POST /api/vault/unlock");
    expect(routes.map(key)).toContain("GET /api/scratchpad/tabs/:id/revisions");
  });

  it("every registered route has an explicit policy (and the table has no stale rows)", () => {
    const registered = new Set(apiRoutes().map(key));
    const missing = [...registered].filter((k) => !(k in POLICY));
    expect(missing, `Routes without a policy in route-matrix.test.ts POLICY: ${missing.join(", ")}`).toEqual([]);
    const stale = Object.keys(POLICY).filter((k) => !registered.has(k));
    expect(stale, `POLICY rows for routes that no longer exist: ${stale.join(", ")}`).toEqual([]);
    const nonApi = routes.filter((r) => !r.path.startsWith("/api")).map(key);
    expect(nonApi.sort()).toEqual([...NON_API_ROUTES].sort());
  });

  it("no duplicate METHOD+path registrations (first one silently wins)", () => {
    const seen = new Map<string, number>();
    for (const r of apiRoutes()) seen.set(key(r), (seen.get(key(r)) ?? 0) + 1);
    const dups = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    expect(dups).toEqual([]);
  });

  it("policy table agrees with the lock-gated mount list in app.ts", () => {
    for (const r of apiRoutes()) {
      const gated = protectedPaths.some((p) => r.path === p || r.path.startsWith(p + "/"));
      expect(POLICY[key(r)] === "token+unlocked", `${key(r)} gated=${gated}`).toBe(gated);
    }
  });

  it("no token → 401 for every non-public route; public routes answer", async () => {
    for (const r of apiRoutes()) {
      const res = await send(r.method, concrete(r.path));
      if (POLICY[key(r)] === "public") {
        expect(res.status, key(r)).toBe(200);
      } else {
        expect(res.status, key(r)).toBe(401);
      }
    }
  });

  it("wrong Host → 403 for every /api route (DNS-rebinding guard), even with a valid token", async () => {
    for (const r of apiRoutes()) {
      const variants: Record<string, string>[] = [{}, { "X-IndexArc-Token": token }];
      for (const headers of variants) {
        const res = await send(r.method, concrete(r.path), { host: `evil.example:${port}`, headers });
        expect(res.status, key(r)).toBe(403);
      }
    }
  });

  it("Sec-Fetch-Site: cross-site → 403 for every /api route, even with a valid token", async () => {
    for (const r of apiRoutes()) {
      const res = await send(r.method, concrete(r.path), {
        headers: { "Sec-Fetch-Site": "cross-site", "X-IndexArc-Token": token },
      });
      expect(res.status, key(r)).toBe(403);
    }
  });

  it("/api/events accepts a one-time ticket instead of the token — once", async () => {
    const t = await send("POST", "/api/sse/ticket", { headers: { "X-IndexArc-Token": token } });
    expect(t.status).toBe(200);
    const ticket = JSON.parse(t.body).ticket as string;
    const first = await send("GET", `/api/events?ticket=${ticket}`);
    expect(first.status).toBe(200);
    expect(first.contentType).toMatch(/text\/event-stream/);
    const replay = await send("GET", `/api/events?ticket=${ticket}`);
    expect(replay.status).toBe(401);
    const bogus = await send("GET", "/api/events?ticket=not-a-ticket");
    expect(bogus.status).toBe(401);
  });

  it("/api/auth/bootstrap (middleware-only exemption) is dev-only and same-origin-only", async () => {
    const prev = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "development";
      const ok = await send("GET", "/api/auth/bootstrap");
      expect(ok.status).toBe(200);
      const xs = await send("GET", "/api/auth/bootstrap", { headers: { "Sec-Fetch-Site": "cross-site" } });
      expect(xs.status).toBe(403);
      const host = await send("GET", "/api/auth/bootstrap", { host: "evil.example" });
      expect(host.status).toBe(403);
      process.env.NODE_ENV = "production";
      const prod = await send("GET", "/api/auth/bootstrap");
      expect(prod.status).toBe(404);
      expect(prod.body).not.toContain(token);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it("vault LOCKED + valid token: gated routes → 423; locked-reachable routes answer without secret values", async () => {
    expect(store.isLocked()).toBe(true);
    const problems: string[] = [];
    for (const r of apiRoutes()) {
      const policy = POLICY[key(r)];
      const res = await send(r.method, concrete(r.path), { headers: { "X-IndexArc-Token": token } });
      if (policy === "token+unlocked") {
        if (res.status !== 423) problems.push(`${key(r)} → ${res.status} (expected 423)`);
        else expect(JSON.parse(res.body).is_locked, key(r)).toBe(true);
      } else {
        // 503 = upstream (Ollama) unavailable — fetch is stubbed off here.
        if ([401, 403, 423].includes(res.status) || (res.status >= 500 && res.status !== 503)) {
          problems.push(`${key(r)} → ${res.status} while locked (expected reachable)`);
        }
      }
      for (const s of SECRETS) {
        if (res.body.includes(s)) problems.push(`${key(r)} leaked seeded secret ${s} while locked`);
      }
      // Every probe must leave the vault locked.
      if (!store.isLocked()) problems.push(`${key(r)} UNLOCKED the vault`);
    }
    expect(problems).toEqual([]);
  });

  it("no route reached a non-loopback host during the matrix", () => {
    const external = outbound.filter((u) => {
      try {
        const h = new URL(u).hostname;
        return !["127.0.0.1", "localhost", "::1", "[::1]"].includes(h);
      } catch {
        return true;
      }
    });
    expect(external).toEqual([]);
  });
});
