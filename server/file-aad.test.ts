import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { deriveKeyAsync, envelopePayload, kdfFromEnvelope, openEnvelope, fileAad } from "./crypto.js";

// ASVS V6 / roadmap "AAD everywhere": every encrypted vault file is bound to
// its role, so one file of a vault cannot be copied over another (e.g. an old
// archive over the live notes) and still open.
describe("file envelopes bound to their role (AAD)", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;
  const PASSWORD = "plum-harbor-violet-9";

  const readJson = (f: string) => JSON.parse(fs.readFileSync(f, "utf8"));

  async function encryptedVault() {
    const store = new VaultStore(paths);
    store.createEntry({ value: "sk-aad", type: "api key", name: "k", raw_fragment: "", labels: [], type_aliases: [], status: "saved", family: "secret" });
    store.saveScratchpad([{ id: "t1", title: "Live", content: "<p>live-note</p>" }]);
    store.saveScratchpadArchive([{ id: "a1", title: "Old", content: "<p>archived-note</p>" }]);
    await store.setupPassword(PASSWORD);
    return store;
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-aad-"));
    paths = ensurePortableLayout(tmpDir);
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
  });

  afterEach(() => {
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the header and companion files bound to their roles", async () => {
    await encryptedVault();
    expect(readJson(paths.vaultFile).aad).toBe(fileAad("vault"));
    expect(readJson(paths.scratchpadFile).aad).toBe(fileAad(path.basename(paths.scratchpadFile, ".json")));
    expect(readJson(paths.scratchpadArchiveFile).aad).toBe(fileAad(path.basename(paths.scratchpadArchiveFile, ".json")));
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(JSON.stringify(fresh.getScratchpad())).toContain("live-note");
  });

  it("refuses a companion file copied over another one", async () => {
    const store = await encryptedVault();
    store.lock();
    fs.copyFileSync(paths.scratchpadArchiveFile, paths.scratchpadFile);
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(() => fresh.getScratchpad()).toThrow(/cannot be decrypted/);
  });

  it("refuses an edited or removed role label", async () => {
    const store = await encryptedVault();
    store.lock();
    const env = readJson(paths.scratchpadFile);
    for (const tampered of [{ ...env, aad: fileAad(path.basename(paths.scratchpadArchiveFile, ".json")) }, (({ aad: _a, ...rest }) => rest)(env)]) {
      fs.writeFileSync(paths.scratchpadFile, JSON.stringify(tampered));
      const fresh = new VaultStore(paths);
      expect(await fresh.unlock(PASSWORD)).toBe(true);
      expect(() => fresh.getScratchpad()).toThrow();
      fresh.lock();
      for (const f of fs.readdirSync(paths.dataDir)) if (f.includes(".undecryptable-")) fs.rmSync(path.join(paths.dataDir, f));
    }
  });

  it("upgrades a vault written before AAD on unlock, header last", async () => {
    const store = await encryptedVault();
    store.lock();
    // Rewrite every envelope unbound, as a pre-AAD build wrote them.
    const header = readJson(paths.vaultFile);
    const key = await deriveKeyAsync(PASSWORD, header.salt, kdfFromEnvelope(header));
    for (const [file, role] of [
      [paths.vaultFile, "vault"],
      [paths.scratchpadFile, path.basename(paths.scratchpadFile, ".json")],
      [paths.scratchpadArchiveFile, path.basename(paths.scratchpadArchiveFile, ".json")],
    ] as const) {
      const env = readJson(file);
      const text = openEnvelope(env, key, role);
      const { aad: _drop, ...legacy } = { ...env, ...envelopePayload(text, key, env.salt, env.version, kdfFromEnvelope(env)) };
      fs.writeFileSync(file, JSON.stringify(legacy));
      expect(readJson(file).aad).toBeUndefined();
    }

    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(readJson(paths.scratchpadFile).aad).toBe(fileAad(path.basename(paths.scratchpadFile, ".json")));
    expect(readJson(paths.scratchpadArchiveFile).aad).toBeDefined();
    expect(readJson(paths.vaultFile).aad).toBe(fileAad("vault"));
    expect(JSON.stringify(fresh.getScratchpad())).toContain("live-note");
    expect(fresh.listEntries()[0].value).toBe("sk-aad");
  });

  it("an unbound companion is accepted only while the header is unbound", async () => {
    const store = await encryptedVault();
    store.lock();
    const header = readJson(paths.vaultFile);
    const key = await deriveKeyAsync(PASSWORD, header.salt, kdfFromEnvelope(header));
    // Header stays bound; slip in an unbound (old-format) copy of the notes.
    const env = readJson(paths.scratchpadFile);
    const text = openEnvelope(env, key, path.basename(paths.scratchpadFile, ".json"));
    const { aad: _drop, ...unbound } = { ...env, ...envelopePayload(text, key, env.salt, env.version, kdfFromEnvelope(env)) };
    fs.writeFileSync(paths.scratchpadFile, JSON.stringify(unbound));
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(() => fresh.getScratchpad()).toThrow(/cannot be decrypted/);
  });
});
