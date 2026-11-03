import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

// R1.1 — storage fails CLOSED. Transient file locks, a vanished vault.json or
// an undecryptable companion file must never turn into "empty, unencrypted".
describe("fail-closed storage", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;

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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-failclosed-"));
    paths = ensurePortableLayout(tmpDir);
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
    store = new VaultStore(paths);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a locked file (EBUSY) keeps the vault locked and is never quarantined", async () => {
    store.createEntry(entry("sk-one"));
    await store.setupPassword("master-password-1");
    store.lock();

    const fresh = new VaultStore(paths); // no cached lock state
    const real = fs.readFileSync;
    vi.spyOn(fs, "readFileSync").mockImplementation(((p: any, ...rest: any[]) => {
      if (String(p) === paths.vaultFile) {
        const e: any = new Error("busy");
        e.code = "EBUSY";
        throw e;
      }
      return (real as any)(p, ...rest);
    }) as any);

    expect(fresh.isLocked()).toBe(true);
    expect(await fresh.unlock("master-password-1")).toBe(false);
    expect(fs.existsSync(paths.vaultFile)).toBe(true);
    expect(fs.readdirSync(paths.dataDir).some((f) => f.includes(".corrupt-"))).toBe(false);

    vi.restoreAllMocks();
    expect(await fresh.unlock("master-password-1")).toBe(true);
    expect(fresh.listEntries()[0].value).toBe("sk-one");
  });

  it("refuses plaintext writes once encryption was seen and vault.json vanished", async () => {
    store.createEntry(entry("sk-two"));
    await store.setupPassword("master-password-2");
    expect(store.encryptionExpected()).toBe(true);

    fs.renameSync(paths.vaultFile, paths.vaultFile + ".moved");
    const fresh = new VaultStore(paths);
    expect(fresh.isLocked()).toBe(false); // nothing to unlock …
    expect(() => fresh.createEntry(entry("sk-new"))).toThrow(/unencrypted/i); // … but no plaintext vault either
    expect(fs.existsSync(paths.vaultFile)).toBe(false);
  });

  it("remove-password is the explicit way back to plaintext", async () => {
    store.createEntry(entry("sk-three"));
    await store.setupPassword("master-password-3");
    expect(await store.removePassword("master-password-3")).toBe(true);
    expect(store.encryptionExpected()).toBe(false);
    store.createEntry(entry("sk-four"));
    expect(JSON.parse(fs.readFileSync(paths.vaultFile, "utf-8")).encrypted).toBeUndefined();
  });

  it("remove-password on a LOCKED vault keeps every note", async () => {
    store.saveScratchpad([{ id: "t1", title: "N", content: "<p>keep me</p>" }]);
    await store.setupPassword("master-password-4");
    store.lock();
    expect(await store.removePassword("master-password-4")).toBe(true);
    const tabs = new VaultStore(paths).getScratchpad();
    expect(tabs.some((t: any) => String(t.content).includes("keep me"))).toBe(true);
  });

  it("an undecryptable note file throws and is preserved instead of reading as empty", async () => {
    store.saveScratchpad([{ id: "t1", title: "N", content: "<p>precious</p>" }]);
    await store.setupPassword("master-password-5");
    // Simulate an interrupted re-key: the notes file is under some other key.
    const env = JSON.parse(fs.readFileSync(paths.scratchpadFile, "utf-8"));
    env.ciphertext = env.ciphertext.replace(/^../, env.ciphertext.startsWith("00") ? "11" : "00");
    fs.writeFileSync(paths.scratchpadFile, JSON.stringify(env));
    store.clearCache();

    expect(() => store.getScratchpad()).toThrow(/cannot be decrypted/);
    expect(fs.readdirSync(paths.dataDir).some((f) => f.includes(".undecryptable-"))).toBe(true);
  });

  it("a restore that fails while staging changes nothing", async () => {
    store.createEntry(entry("sk-before"));
    store.saveScratchpad([{ id: "t1", title: "N", content: "<p>x</p>" }]);
    const snap = store.createEmergencySnapshot(50) as string;
    store.createEntry(entry("sk-after"));
    const before = fs.readFileSync(paths.vaultFile, "utf-8");

    const realOpen = fs.openSync;
    let opened = 0;
    vi.spyOn(fs, "openSync").mockImplementation(((p: any, ...rest: any[]) => {
      if (String(p).endsWith(".restore.tmp") && ++opened === 2) {
        const e: any = new Error("disk full");
        e.code = "ENOSPC";
        throw e;
      }
      return (realOpen as any)(p, ...rest);
    }) as any);

    expect(store.restoreEmergencySnapshot(snap)).toBe(false);
    expect(fs.readFileSync(paths.vaultFile, "utf-8")).toBe(before);
    expect(fs.readdirSync(paths.dataDir).some((f) => f.endsWith(".restore.tmp"))).toBe(false);
  });
});
