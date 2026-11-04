import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import http from "http";
import express from "express";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { AuditLog } from "./audit.js";
import { vaultRoutes } from "./routes/vault.js";
import type { RouteContext } from "./routes/types.js";

// AUD-014 regression: POST /api/vault/setup-password used to need only the
// process token — one call encrypted the vault under an attacker-chosen
// password AND purged every plaintext recovery copy (one-call "ransom").
// It now requires the interactive ceremony word, like unprotect's UNPROTECT.
describe("setup-password ceremony (AUD-014)", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;
  let server: http.Server;
  let baseUrl: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-vault-route-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    // A pre-existing plaintext vault with one entry + a plaintext backup
    // (exactly what the ransom call used to destroy).
    store.createEntry({
      value: "s3cret",
      type: "api key",
      name: "k",
      raw_fragment: "",
      labels: [],
      type_aliases: [],
      status: "saved",
      family: "secret",
    });
    fs.writeFileSync(path.join(paths.backupsDir, "vault-plain.json"), fs.readFileSync(paths.vaultFile));

    const ctx = { store, paths, audit: new AuditLog(paths) } as unknown as RouteContext;
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/vault", vaultRoutes(ctx));
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  const post = (body: unknown) =>
    fetch(`${baseUrl}/api/vault/setup-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("rejects a password-only call (403) and encrypts NOTHING", async () => {
    const res = await post({ password: "attacker-password" });
    expect(res.status).toBe(403);
    expect(store.isEncryptionEnabled()).toBe(false);
    // The plaintext backup still exists — nothing was purged.
    expect(fs.existsSync(path.join(paths.backupsDir, "vault-plain.json"))).toBe(true);
  });

  it("accepts the confirmed call and encrypts the vault", async () => {
    const res = await post({ password: "legit-password-123", confirm_word: "ENCRYPT" });
    expect(res.status).toBe(200);
    expect(store.isEncryptionEnabled()).toBe(true);
    expect(await store.unlock("legit-password-123")).toBe(true);
  });

  it.each([
    ["short", "Sh0rt-pw!", "password_too_short"],
    ["common", "Password1234", "password_common"],
    ["l33t common", "P@ssw0rd1234", "password_common"],
    ["guessable", "aaaaaaaaaaaa", "password_weak"],
  ])("rejects a %s master password (ASVS 2.1.1/2.1.7) and encrypts nothing", async (_label, pw, code) => {
    const res = await post({ password: pw, confirm_word: "ENCRYPT" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe(code);
    expect(store.isEncryptionEnabled()).toBe(false);
  });

  it("applies the same policy to change-password, and still accepts an existing short password as current", async () => {
    // A vault set up before the 12-character rule keeps unlocking with its
    // old password; only the new one has to meet the policy.
    await store.setupPassword("old-pw-8");
    const change = (new_password: string) =>
      fetch(`${baseUrl}/api/vault/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: "old-pw-8", new_password }),
      });
    expect((await change("password1234")).status).toBe(400);
    expect(await store.unlock("old-pw-8")).toBe(true);
    expect((await change("plum-harbor-violet-9")).status).toBe(200);
    store.lock();
    expect(await store.unlock("plum-harbor-violet-9")).toBe(true);
  });

  it("unlock on an unencrypted vault reports skipped, not verified success", async () => {
    const res = await fetch(`${baseUrl}/api/vault/unlock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "anything" }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.encryption_enabled).toBe(false);
  });
});
