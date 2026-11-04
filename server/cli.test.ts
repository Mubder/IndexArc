import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import crypto from "crypto";
import { execFile } from "child_process";
import { ensurePortableLayout, type PortablePaths } from "./paths.js";
import { VaultStore } from "./store.js";
import { AuditLog } from "./audit.js";
import { FolderWatcherManager } from "./services/folderWatcher.js";
import { createApp } from "./app.js";
import { getLastActivity } from "./auth.js";
import { findSecret } from "./routes/cli.js";
import type { VaultEntry } from "./types.js";

// R6.1 CLI access: scoped tokens, keyed digests, lock behaviour, and the
// bin/indexarc.mjs client end to end against the real app.

const PASSWORD = "cli-test-password-1";
const NEW_PASSWORD = "cli-test-password-2";
const OPENAI = "sk-cli-test-openai-0123456789abcdef";
const STRIPE = "sk_test_cli_stripe_ABCDEF987654";
const BIN = path.resolve(__dirname, "..", "bin", "indexarc.mjs");

let port = 0;
const pairing = () => String(process.env.INDEXARC_API_TOKEN || "");

async function call(method: string, p: string, opts: { bearer?: string; pairing?: boolean; body?: unknown } = {}) {
  const res = await fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: {
      ...(opts.bearer ? { Authorization: `Bearer ${opts.bearer}` } : {}),
      ...(opts.pairing ? { "x-indexarc-token": pairing() } : {}),
      ...(opts.body ? { "Content-Type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as any };
}

function runCli(args: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], { env: { ...process.env, ...env }, timeout: 20_000 }, (err: any, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    );
  });
}

describe("R6.1 CLI access", () => {
  let tmpDir: string;
  let paths: PortablePaths;
  let store: VaultStore;
  let watchers: FolderWatcherManager;
  let server: http.Server;
  let token = "";
  let tokenId = "";

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-cli-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    watchers = new FolderWatcherManager(store, () => store.getSettings());
    const { app } = createApp({ paths, store, audit: new AuditLog(paths), watchers });
    server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as { port: number }).port;
    const base = { raw_fragment: "", type_aliases: [], status: "saved", family: "secret" } as const;
    store.createEntry({ ...base, value: OPENAI, type: "api key", name: "OpenAI API key", labels: ["proj-a"] } as any);
    store.createEntry({ ...base, value: STRIPE, type: "secret", name: "STRIPE_SECRET", labels: ["proj-a"] } as any);
    store.createEntry({ ...base, value: "dup-1-value", type: "token", name: "dup", labels: [] } as any);
    store.createEntry({ ...base, value: "dup-2-value", type: "token", name: "DUP", labels: [] } as any);
    store.saveSettings({ auto_lock_minutes: 0 });
    await store.setupPassword(PASSWORD);
  }, 120_000);

  afterAll(async () => {
    watchers?.stopAll();
    await new Promise<void>((r) => server.close(() => r()));
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creating a token needs the master password and returns it once", async () => {
    expect((await call("POST", "/api/cli/tokens", { pairing: true, body: { name: "laptop", password: "wrong" } })).status).toBe(401);
    const ok = await call("POST", "/api/cli/tokens", { pairing: true, body: { name: "laptop", password: PASSWORD } });
    expect(ok.status).toBe(200);
    token = ok.body.token;
    tokenId = ok.body.record.id;
    expect(token).toMatch(/^iax_[A-Za-z0-9_-]{43}$/);
    const list = await call("GET", "/api/cli/tokens", { pairing: true });
    expect(list.body.tokens).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain("digest");
    expect(fs.readFileSync(paths.cliTokensFile, "utf8")).not.toContain(token);
  });

  it("a CLI token reads secrets by name, env key or label", async () => {
    const before = getLastActivity();
    const a = await call("GET", `/api/cli/secret?name=${encodeURIComponent("openai api key")}`, { bearer: token });
    expect(a.status).toBe(200);
    expect(a.body.value).toBe(OPENAI);
    const b = await call("GET", "/api/cli/secret?name=OPENAI_API_KEY", { bearer: token });
    expect(b.body.value).toBe(OPENAI);
    const env = await call("POST", "/api/cli/env", { bearer: token, body: { label: "proj-a" } });
    expect(env.body.env).toEqual({ OPENAI_API_KEY: OPENAI, STRIPE_SECRET: STRIPE });
    const miss = await call("POST", "/api/cli/env", { bearer: token, body: { names: ["STRIPE_SECRET", "NOPE"] } });
    expect(miss.body.missing).toEqual(["NOPE"]);
    // A script polling secrets must not keep the vault from auto-locking.
    expect(getLastActivity()).toBe(before);
  });

  it("an ambiguous name is refused with candidates", async () => {
    const r = await call("GET", "/api/cli/secret?name=Dup", { bearer: token });
    expect(r.status).toBe(409);
    expect(r.body.candidates).toHaveLength(2);
    expect(JSON.stringify(r.body)).not.toContain("dup-1-value");
  });

  it("a CLI token reaches nothing but the CLI reads", async () => {
    for (const [m, p] of [
      ["GET", "/api/entries"],
      ["GET", "/api/cli/tokens"],
      ["POST", "/api/cli/tokens"],
      ["GET", "/api/settings"],
      ["POST", "/api/porting/export"],
      ["POST", "/api/vault/lock"],
    ] as const) {
      expect((await call(m, p, { bearer: token, body: m === "POST" ? { name: "x", password: PASSWORD, format: "env" } : undefined })).status, `${m} ${p}`).toBe(401);
    }
    expect((await call("GET", "/api/cli/secret?name=STRIPE_SECRET", { bearer: "iax_" + "A".repeat(43) })).status).toBe(401);
  });

  it("a digest planted in the token file does not authorise", async () => {
    const evil = "iax_" + crypto.randomBytes(32).toString("base64url");
    const j = JSON.parse(fs.readFileSync(paths.cliTokensFile, "utf8"));
    j.tokens.push({ id: "evil", name: "evil", created_at: new Date().toISOString(), digest: crypto.createHash("sha256").update(evil).digest("hex") });
    fs.writeFileSync(paths.cliTokensFile, JSON.stringify(j));
    expect((await call("GET", "/api/cli/secret?name=STRIPE_SECRET", { bearer: evil })).status).toBe(401);
  });

  it("locked vault → 423; unlock → works again", async () => {
    store.lock();
    expect((await call("GET", "/api/cli/secret?name=STRIPE_SECRET", { bearer: token })).status).toBe(423);
    expect(await store.unlock(PASSWORD)).toBe(true);
    expect((await call("GET", "/api/cli/secret?name=STRIPE_SECRET", { bearer: token })).body.value).toBe(STRIPE);
  }, 60_000);

  it("the indexarc CLI: get, env, run, status", async () => {
    const env = { INDEXARC_URL: `http://127.0.0.1:${port}`, INDEXARC_TOKEN: token };
    const get = await runCli(["get", "STRIPE_SECRET"], env);
    expect(get.code).toBe(0);
    expect(get.stdout).toBe(STRIPE);
    const dot = await runCli(["env", "--label", "proj-a"], env);
    expect(dot.stdout).toContain(`OPENAI_API_KEY=${OPENAI}`);
    const run = await runCli(["run", "STRIPE_SECRET", "--", process.execPath, "-e", "process.stdout.write(process.env.STRIPE_SECRET)"], env);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(STRIPE);
    const status = await runCli(["status"], env);
    expect(status.code).toBe(0);
    const bad = await runCli(["get", "STRIPE_SECRET"], { ...env, INDEXARC_TOKEN: "iax_" + "B".repeat(43) });
    expect(bad.code).toBe(4);
    expect(bad.stdout).toBe("");
    const usage = await runCli(["env"], env);
    expect(usage.code).toBe(2);
    // No token anywhere → "no token" (4), not "cannot reach the app".
    const none = await runCli(["get", "STRIPE_SECRET"], { ...env, INDEXARC_TOKEN: "", INDEXARC_TOKEN_FILE: path.join(tmpDir, "missing-token") });
    expect(none.code).toBe(4);
  }, 60_000);

  it("revoking, or changing the master password, kills tokens", async () => {
    const second = await call("POST", "/api/cli/tokens", { pairing: true, body: { name: "ci", password: PASSWORD } });
    expect((await call("POST", `/api/cli/tokens/${tokenId}/revoke`, { pairing: true })).status).toBe(200);
    expect((await call("GET", "/api/cli/secret?name=STRIPE_SECRET", { bearer: token })).status).toBe(401);
    expect((await call("GET", "/api/cli/secret?name=STRIPE_SECRET", { bearer: second.body.token })).status).toBe(200);
    expect(await store.changePassword(PASSWORD, NEW_PASSWORD)).toBe(true);
    expect((await call("GET", "/api/cli/secret?name=STRIPE_SECRET", { bearer: second.body.token })).status).toBe(401);
    expect((await call("GET", "/api/cli/tokens", { pairing: true })).body.tokens).toEqual([]);
  }, 120_000);
});

describe("findSecret", () => {
  const e = (id: string, name: string, family: VaultEntry["family"] = "secret") => ({ id, name, family }) as VaultEntry;
  it("prefers an exact name over looser matches", () => {
    const list = [e("1", "github token"), e("2", "GITHUB_TOKEN"), e("3", "GitHub Token", "note")];
    expect((findSecret(list, "GITHUB_TOKEN") as any).entry.id).toBe("2");
    expect((findSecret(list, "github token") as any).entry.id).toBe("1");
    expect((findSecret(list, "Github-Token") as any).status).toBe(409);
    expect((findSecret(list, "nothing") as any).status).toBe(404);
  });
});
