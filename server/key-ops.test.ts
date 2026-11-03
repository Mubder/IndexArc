import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

// A real await inside key derivation (Argon2id in WASM can complete without
// yielding), so a lock() can deterministically land mid-unlock.
vi.mock("./crypto.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./crypto.js")>();
  return {
    ...orig,
    deriveKeyAsync: async (...args: Parameters<typeof orig.deriveKeyAsync>) => {
      await new Promise((r) => setTimeout(r, 30));
      return orig.deriveKeyAsync(...args);
    },
  };
});

// R1.2 — key-state operations under concurrency and crashes.
describe("key operations", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;
  const PASSWORD = "correct horse battery staple";

  const entry = (value: string) => ({
    value,
    type: "api key",
    name: "k",
    raw_fragment: "",
    labels: [] as string[],
    type_aliases: [] as string[],
    status: "saved" as const,
    family: "secret" as const,
  });

  /** A pre-2.1 vault: PBKDF2 key, envelopes without kdf params. */
  function writeLegacyVault(entries: any[], notes: any[]) {
    const salt = crypto.randomBytes(16).toString("hex");
    const key = crypto.pbkdf2Sync(PASSWORD, Buffer.from(salt, "hex"), 100_000, 32, "sha256");
    const seal = (text: string, version: number) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return { version, encrypted: true, salt, iv: iv.toString("hex"), authTag: c.getAuthTag().toString("hex"), ciphertext: ct.toString("hex") };
    };
    fs.writeFileSync(paths.vaultFile, JSON.stringify(seal(JSON.stringify({ version: 1, entries }), 1)));
    fs.writeFileSync(paths.scratchpadFile, JSON.stringify(seal(JSON.stringify({ version: 2, tabs: notes }), 2)));
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-keyops-"));
    paths = ensurePortableLayout(tmpDir);
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two concurrent setups: exactly one wins and its password opens everything", async () => {
    const store = new VaultStore(paths);
    store.createEntry(entry("sk-c"));
    store.saveScratchpad([{ id: "t1", title: "N", content: "<p>note-c</p>" }]);
    const results = await Promise.allSettled([store.setupPassword("password-AAAA"), store.setupPassword("password-BBBB")]);
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const winner = results[0].status === "fulfilled" ? "password-AAAA" : "password-BBBB";

    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(winner)).toBe(true);
    expect(fresh.listEntries()[0].value).toBe("sk-c");
    expect(fresh.getScratchpad().some((t: any) => String(t.content).includes("note-c"))).toBe(true);
  });

  it("a lock that lands while unlock is deriving the key wins", async () => {
    const store = new VaultStore(paths);
    store.createEntry(entry("sk-l"));
    await store.setupPassword("password-LLLL");
    store.lock();
    const pending = store.unlock("password-LLLL");
    // e.g. auto-lock fires while Argon2id (~hundreds of ms) is still running
    await new Promise((r) => setTimeout(r, 15));
    store.lock();
    expect(await pending).toBe(false);
    expect(store.isLocked()).toBe(true);
  });

  it("a legacy-key session labels its writes with the legacy KDF", async () => {
    writeLegacyVault([{ ...entry("sk-legacy"), id: "e1", created_at: "", updated_at: "" }], []);
    const store = new VaultStore(paths);
    // Force the best-effort upgrade to fail before its commit point.
    const realOpen = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation(((p: any, ...rest: any[]) => {
      if (String(p).endsWith(".commit.tmp")) {
        const e: any = new Error("disk full");
        e.code = "ENOSPC";
        throw e;
      }
      return (realOpen as any)(p, ...rest);
    }) as any);
    expect(await store.unlock(PASSWORD)).toBe(true);
    store.createEntry(entry("sk-written-on-legacy-key"));
    vi.restoreAllMocks();

    const env = JSON.parse(fs.readFileSync(paths.vaultFile, "utf-8"));
    expect(env.kdf?.algo ?? env.kdf?.name ?? "pbkdf2").not.toMatch(/argon/i);
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true); // also completes the upgrade now
    expect(fresh.listEntries().map((e) => e.value)).toContain("sk-written-on-legacy-key");
  });

  it("an upgrade interrupted after its commit point is rolled forward on next unlock", async () => {
    writeLegacyVault(
      [{ ...entry("sk-rf"), id: "e1", created_at: "", updated_at: "" }],
      [{ id: "t1", title: "N", content: "<p>note-rf</p>" }]
    );
    const store = new VaultStore(paths);
    const realRename = fs.renameSync;
    let commitRenames = 0;
    vi.spyOn(fs, "renameSync").mockImplementation(((from: any, to: any) => {
      if (String(from).endsWith(".commit.tmp") && ++commitRenames >= 2) {
        const e: any = new Error("power cut");
        e.code = "EIO";
        throw e;
      }
      return (realRename as any)(from, to);
    }) as any);
    // The disk keeps failing, so the in-process roll-forward fails too → the
    // store locks itself rather than keep writing under a mismatched key.
    expect(await store.unlock(PASSWORD)).toBe(false);
    expect(fs.existsSync(path.join(paths.dataDir, "commit-in-progress.json"))).toBe(true);
    vi.restoreAllMocks();

    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(fs.existsSync(path.join(paths.dataDir, "commit-in-progress.json"))).toBe(false);
    expect(fresh.listEntries()[0].value).toBe("sk-rf");
    expect(fresh.getScratchpad().some((t: any) => String(t.content).includes("note-rf"))).toBe(true);
    const env = JSON.parse(fs.readFileSync(paths.scratchpadFile, "utf-8"));
    expect(JSON.stringify(env.kdf || {})).toMatch(/argon/i);
  });
});
