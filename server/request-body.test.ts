import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { ensurePortableLayout } from "./paths.js";
import { VaultStore } from "./store.js";
import { AuditLog } from "./audit.js";
import { FolderWatcherManager } from "./services/folderWatcher.js";
import { createApp } from "./app.js";
import { closeAllRecordDbs } from "./db/recordDb.js";

// ASVS 13.2.2: every route that takes a body checks it against a schema
// (server/routes/bodies.ts) before the handler runs.
describe("request-body schemas", () => {
  let tmpDir: string;
  let app: any;
  let server: http.Server;
  let port = 0;
  let token = "";
  let watchers: FolderWatcherManager;

  function send(method: string, urlPath: string, raw: string): Promise<{ status: number; body: any }> {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          method,
          path: urlPath,
          headers: { Host: `127.0.0.1:${port}`, "X-IndexArc-Token": token, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(raw) },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8");
            let body: any = text;
            try {
              body = JSON.parse(text);
            } catch {}
            resolve({ status: res.statusCode || 0, body });
          });
        }
      );
      req.on("error", reject);
      req.end(raw);
    });
  }
  const post = (p: string, body: unknown, method = "POST") => send(method, p, JSON.stringify(body));

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-bodies-"));
    const paths = ensurePortableLayout(tmpDir);
    const store = new VaultStore(paths);
    watchers = new FolderWatcherManager(store, () => store.getSettings());
    ({ app } = createApp({ paths, store, audit: new AuditLog(paths), watchers }));
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
    token = String(process.env.INDEXARC_API_TOKEN || "");
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    watchers?.stopAll?.();
    closeAllRecordDbs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("every POST/PUT/PATCH route runs the body check before its handler", () => {
    const missing: string[] = [];
    let checked = 0;
    const walk = (stack: any[], prefix: string) => {
      for (const layer of stack) {
        if (layer.route) {
          for (const m of Object.keys(layer.route.methods)) {
            if (!["post", "put", "patch"].includes(m)) continue;
            checked++;
            const names = layer.route.stack.map((l: any) => l.name);
            if (names[0] !== "checkRequestBody") missing.push(`${m.toUpperCase()} ${prefix}${layer.route.path}`);
          }
        } else if (layer.name === "router" && Array.isArray(layer.handle?.stack)) {
          walk(layer.handle.stack, prefix + "…");
        }
      }
    };
    walk(app._router.stack, "");
    expect(checked).toBeGreaterThan(40);
    expect(missing).toEqual([]);
  });

  it("rejects a body that is not an object", async () => {
    for (const raw of ["[1,2,3]", '"text"', "42"]) {
      const r = await send("POST", "/api/entries/check-duplicate", raw);
      expect(r.status).toBe(400);
    }
  });

  it.each([
    ["POST", "/api/vault/unlock", { password: 12345 }, "password"],
    ["POST", "/api/entries/bulk-delete", { ids: "not-a-list" }, "ids"],
    ["POST", "/api/entries/save", { candidates: [{ value: "v", labels: "one" }] }, "candidates.0.labels"],
    ["PATCH", "/api/entries/some-id", { family: "malware" }, "family"],
    ["POST", "/api/settings", { ui_language: "fr" }, "ui_language"],
    ["POST", "/api/settings", { ai_cloud_consent: "yes" }, "ai_cloud_consent"],
    ["POST", "/api/scratchpad", { tabs: [], base_revs: { a: "1" } }, "base_revs.a"],
    ["POST", "/api/spellcheck-words", { words: ["x".repeat(300)] }, "words.0"],
  ])("%s %s with a wrong field type → 400", async (method, p, body, issuePath) => {
    const r = await post(p, body, method);
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("invalid_body");
    expect(r.body.issues.map((i: any) => i.path)).toContain(issuePath);
  });

  it("never echoes the submitted value back", async () => {
    const marker = "do-not-echo-" + "z".repeat(2000);
    const r = await post("/api/vault/unlock", { password: marker });
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain("do-not-echo");
  });

  it("valid bodies (and unknown extra keys) still reach the handler", async () => {
    const r = await post("/api/entries/check-duplicate", { value: "abc", name: "n", extra_key: true });
    expect(r.status).toBe(200);
    const s = await post("/api/settings", { ui_language: "ar", font_size_en: 15, bind_host: "127.0.0.1" });
    expect(s.status).toBe(200);
  });
});
