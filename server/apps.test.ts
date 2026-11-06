// Applications: secrets grouped by application and environment
// (shared/apps.ts, /api/entries/apps/*, CLI --app/--env).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import { ensurePortableLayout, type PortablePaths } from "./paths.js";
import { VaultStore } from "./store.js";
import { AuditLog } from "./audit.js";
import { FolderWatcherManager } from "./services/folderWatcher.js";
import { createApp } from "./app.js";
import { APP_NOTE_TYPE, appKeys, findAppKey, keyNameFromFragment, normalizeAppName, summarizeApps, toDotenv } from "../shared/apps.js";
import { buildEncryptedExport, parseEncryptedExport } from "./porting.js";

const PASSWORD = "apps-test-password-1";
const e = (id: string, extra: Record<string, unknown>) =>
  ({ id, name: id, value: "v", type: "api key", family: "secret", updated_at: "2026-01-01", ...extra }) as any;

describe("shared/apps helpers", () => {
  it("normalises names and compares them without case", () => {
    expect(normalizeAppName("  Shop   backend ")).toBe("Shop backend");
    expect(normalizeAppName("   ")).toBeUndefined();
    expect(normalizeAppName(42)).toBeUndefined();
    expect(normalizeAppName("x".repeat(500))).toHaveLength(200);
  });

  it("summarises applications with default environments first", () => {
    const list = [
      e("a", { app: "Shop", env: "Development" }),
      e("b", { app: "shop", env: "Production" }),
      e("c", { app: "Shop", env: "QA" }),
      e("d", { app: "Shop" }),
      e("n", { app: "Shop", family: "note", type: APP_NOTE_TYPE, notes: "hi" }),
      e("z", { app: "Admin", env: "Production", updated_at: "2026-05-01" }),
      e("free", {}),
      e("cmd", { app: "Shop", family: "command" }),
    ];
    const s = summarizeApps(list);
    expect(s.map((x) => x.name)).toEqual(["Admin", "Shop"]);
    const shop = s[1];
    expect(shop.count).toBe(4);
    expect(shop.note?.id).toBe("n");
    expect(shop.envs.map((x) => x.name)).toEqual(["Production", "Development", "", "QA"]);
    expect(appKeys(list, "SHOP", "production").map((x) => x.id)).toEqual(["b"]);
    expect(appKeys(list, "Shop", "").map((x) => x.id)).toEqual(["d"]);
  });

  it("matches keys by their .env name within one application and environment", () => {
    const list = [e("k", { name: "Stripe secret key", app: "Shop", env: "Production" })];
    expect(findAppKey(list, "shop", "PRODUCTION", "STRIPE_SECRET_KEY")?.id).toBe("k");
    expect(findAppKey(list, "Shop", "Staging", "STRIPE_SECRET_KEY")).toBeUndefined();
    expect(findAppKey(list, "Other", "Production", "STRIPE_SECRET_KEY")).toBeUndefined();
  });

  it("reads the variable name from a KEY=value line", () => {
    expect(keyNameFromFragment("STRIPE_SECRET_KEY=sk_live_1")).toBe("STRIPE_SECRET_KEY");
    expect(keyNameFromFragment("  export API_TOKEN = \"x\"")).toBe("API_TOKEN");
    expect(keyNameFromFragment("\"db.password\": hunter2")).toBe("db.password");
    expect(keyNameFromFragment("my key is sk_live_1")).toBeUndefined();
    expect(keyNameFromFragment(undefined)).toBeUndefined();
  });

  it("writes .env text, quoting where needed, later keys winning", () => {
    const out = toDotenv([
      { name: "A", value: "1" },
      { name: "b key", value: 'has space "q"' },
      { name: "A", value: "2" },
    ], "Shop / Production");
    expect(out).toBe('# Shop / Production\nA=2\nB_KEY="has space \\"q\\""\n');
  });
});

describe("applications API", () => {
  let tmpDir: string;
  let paths: PortablePaths;
  let store: VaultStore;
  let watchers: FolderWatcherManager;
  let server: http.Server;
  let port = 0;

  async function call(method: string, p: string, body?: unknown) {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method,
      headers: { "x-indexarc-token": String(process.env.INDEXARC_API_TOKEN || ""), ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
  }

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-apps-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    watchers = new FolderWatcherManager(store, () => store.getSettings());
    const { app } = createApp({ paths, store, audit: new AuditLog(paths), watchers });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
    store.saveSettings({ auto_lock_minutes: 0, ai_provider: "local", ollama_base_url: "http://127.0.0.1:9" });
    await store.setupPassword(PASSWORD);
  }, 120_000);

  afterAll(async () => {
    watchers?.stopAll();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a dry run reports new keys and writes nothing", async () => {
    const r = await call("POST", "/api/entries/apps/upsert", {
      app: " Shop ",
      env: "Production",
      items: [{ name: "STRIPE_SECRET_KEY", value: "sk_live_1" }, { name: "DATABASE_URL", value: "postgres://x" }],
      dry_run: true,
    });
    expect(r.status).toBe(200);
    expect(r.body.app).toBe("Shop");
    expect(r.body.items.map((i: any) => i.status)).toEqual(["new", "new"]);
    expect(store.listEntries()).toHaveLength(0);
  });

  it("saves new keys into the application, then updates changed ones in place", async () => {
    const first = await call("POST", "/api/entries/apps/upsert", {
      app: "Shop",
      env: "Production",
      items: [{ name: "STRIPE_SECRET_KEY", value: "sk_live_1" }, { name: "DATABASE_URL", value: "postgres://x" }],
    });
    expect(first.body).toMatchObject({ created: 2, updated: 0, unchanged: 0 });
    const stripe = store.listEntries().find((x) => x.name === "STRIPE_SECRET_KEY")!;
    expect(stripe).toMatchObject({ app: "Shop", env: "Production", family: "secret", status: "saved", type: "secret" });

    const plan = await call("POST", "/api/entries/apps/upsert", {
      app: "shop",
      env: "production",
      items: [{ name: "stripe secret key", value: "sk_live_2" }, { name: "DATABASE_URL", value: "postgres://x" }],
      dry_run: true,
    });
    expect(plan.body.items.map((i: any) => [i.status, i.id])).toEqual([["update", stripe.id], ["same", expect.any(String)]]);

    const second = await call("POST", "/api/entries/apps/upsert", {
      app: "shop",
      env: "production",
      items: [{ name: "stripe secret key", value: "sk_live_2" }, { name: "DATABASE_URL", value: "postgres://x" }],
    });
    expect(second.body).toMatchObject({ created: 0, updated: 1, unchanged: 1 });
    const after = store.getEntry(stripe.id)!;
    expect(after.value).toBe("sk_live_2");
    expect(after.last_rotated_at).toBeTruthy();
    expect(store.listEntries()).toHaveLength(2);
  });

  it("takes .env text, one environment at a time", async () => {
    const r = await call("POST", "/api/entries/apps/upsert", {
      app: "Shop",
      env: "Staging",
      text: "# staging\nSTRIPE_SECRET_KEY=sk_test_9\nexport API_TOKEN=\"a b\"\nnot a line\nEMPTY=\n",
    });
    expect(r.body).toMatchObject({ created: 2, updated: 0 });
    expect(r.body.skipped).toEqual({ "unparsed line": 1, "empty value": 1 });
    const staging = store.listEntries().filter((x) => x.env === "Staging");
    expect(staging.map((x) => [x.name, x.value]).sort()).toEqual([["API_TOKEN", "a b"], ["STRIPE_SECRET_KEY", "sk_test_9"]]);
    // Production is untouched.
    expect(store.listEntries().find((x) => x.env === "Production" && x.name === "STRIPE_SECRET_KEY")!.value).toBe("sk_live_2");
  });

  it("refuses a blank application and bad bodies", async () => {
    expect((await call("POST", "/api/entries/apps/upsert", { app: "  ", items: [] })).status).toBe(400);
    expect((await call("POST", "/api/entries/apps/upsert", { items: [] })).status).toBe(400);
    expect((await call("POST", "/api/entries/apps/assign", { ids: "x" })).status).toBe(400);
  });

  it("moves existing secrets into an application and back out", async () => {
    const loose = store.createEntry({ value: "ghp_x", type: "api token", name: "GITHUB_TOKEN", raw_fragment: "", labels: [], type_aliases: [], status: "saved", family: "secret" });
    const moved = await call("POST", "/api/entries/apps/assign", { ids: [loose.id, "missing-id"], app: "Tools", env: "Production" });
    expect(moved.body.moved).toBe(1);
    expect(store.getEntry(loose.id)).toMatchObject({ app: "Tools", env: "Production" });
    await call("POST", "/api/entries/apps/assign", { ids: [loose.id], app: null, env: "Production" });
    expect(store.getEntry(loose.id)!.app).toBeUndefined();
    expect(store.getEntry(loose.id)!.env).toBeUndefined();
  });

  it("an edit can change or clear the application", async () => {
    const id = store.listEntries().find((x) => x.name === "DATABASE_URL")!.id;
    const r = await call("PATCH", `/api/entries/${id}`, { env: "Staging" });
    expect(r.body).toMatchObject({ app: "Shop", env: "Staging", value: "postgres://x" });
    const cleared = await call("PATCH", `/api/entries/${id}`, { app: "" });
    expect(cleared.body.app).toBeUndefined();
    expect(cleared.body.env).toBeUndefined();
    await call("PATCH", `/api/entries/${id}`, { app: "Shop", env: "Production" });
  });

  it("renames an application, merging into an existing one", async () => {
    const r = await call("POST", "/api/entries/apps/rename", { from: "SHOP", to: "Shop backend" });
    expect(r.body.renamed).toBe(4);
    expect(summarizeApps(store.listEntries()).map((s) => s.name)).toEqual(["Shop backend"]);
  });

  it("the CLI env endpoint takes one application and environment", async () => {
    const prod = await call("POST", "/api/cli/env", { app: "shop backend", env: "Production" });
    expect(prod.body.env).toEqual({ STRIPE_SECRET_KEY: "sk_live_2", DATABASE_URL: "postgres://x" });
    const staging = await call("POST", "/api/cli/env", { app: "Shop backend", env: "Staging", names: ["STRIPE_SECRET_KEY"] });
    expect(staging.body.env).toEqual({ STRIPE_SECRET_KEY: "sk_test_9" });
    const all = await call("POST", "/api/cli/env", { app: "Shop backend" });
    expect(all.body.count).toBe(3); // two STRIPE_SECRET_KEY entries collapse to one key
  });

  it("encrypted exports keep the application and environment", async () => {
    const text = await buildEncryptedExport(store.listEntries(), "export-passphrase-123");
    const back = await parseEncryptedExport(text, "export-passphrase-123");
    expect(back.candidates.find((c) => c.name === "API_TOKEN")).toMatchObject({ app: "Shop backend", env: "Staging" });
  });
});
