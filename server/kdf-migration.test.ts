import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { kdfFromEnvelope, kdfNeedsUpgrade } from "./crypto.js";

// Regression tests for the Argon2id migration (audit finding C2):
// a legacy PBKDF2 envelope must still unlock, and the very same unlock must
// transparently re-key every envelope to the current Argon2id standard.
describe("KDF migration: legacy PBKDF2 → Argon2id", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;
  let snapshotsBefore: Set<string>;

  const PASSWORD = "correct horse battery staple";

  /** Hand-craft a vault.json exactly like a pre-2.1 build wrote it. */
  function writeLegacyEncryptedVault(entries: any[]) {
    const salt = crypto.randomBytes(16).toString("hex");
    const key = crypto.pbkdf2Sync(PASSWORD, Buffer.from(salt, "hex"), 100_000, 32, "sha256");
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify({ version: 1, entries }, null, 2), "utf8"),
      cipher.final(),
    ]);
    const payload = {
      version: 1,
      encrypted: true as const,
      salt,
      iv: iv.toString("hex"),
      authTag: cipher.getAuthTag().toString("hex"),
      ciphertext: ciphertext.toString("hex"),
    };
    fs.writeFileSync(paths.vaultFile, JSON.stringify(payload, null, 2), "utf8");
  }

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-kdf-test-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    snapshotsBefore = new Set(store.listEmergencySnapshots().map((s) => s.name));
  });

  afterEach(() => {
    try {
      const fresh = store
        .listEmergencySnapshots()
        .filter((s) => !snapshotsBefore.has(s.name));
      for (const s of fresh) {
        for (const dir of s.locations) {
          try {
            fs.unlinkSync(path.join(dir, s.name));
          } catch {}
        }
      }
    } catch {}
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("reads legacy envelopes as pbkdf2 and flags them for upgrade", () => {
    writeLegacyEncryptedVault([]);
    const raw = JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));
    const kdf = kdfFromEnvelope(raw);
    expect(kdf.algo).toBe("pbkdf2");
    expect(kdfNeedsUpgrade(kdf)).toBe(true);
  });

  it("fails closed on an unknown KDF algorithm", () => {
    writeLegacyEncryptedVault([]);
    const raw = JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));
    raw.kdf = { algo: "scrypt", n: 2 ** 15 };
    fs.writeFileSync(paths.vaultFile, JSON.stringify(raw));
    expect(() => kdfFromEnvelope(raw)).toThrow(/unsupported KDF/);
  });

  it("unlocks a legacy vault AND re-keys it to Argon2id in the same unlock", async () => {
    writeLegacyEncryptedVault([
      {
        id: "e1",
        value: "s3cret-value",
        type: "api key",
        name: "legacy-entry",
        raw_fragment: "",
        labels: [],
        type_aliases: [],
        status: "saved",
        family: "secret",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);

    expect(await store.unlock(PASSWORD)).toBe(true);
    expect(store.listEntries().length).toBe(1);

    // The on-disk envelope must now carry the current Argon2id descriptor.
    const raw = JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));
    expect(raw.encrypted).toBe(true);
    expect(raw.kdf?.algo).toBe("argon2id");
    expect(raw.kdf?.memorySize).toBe(65536);

    // And a FRESH instance (full re-derivation from the envelope, no
    // in-memory carry-over) unlocks with the same password.
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(fresh.listEntries().length).toBe(1);
    expect(fresh.listEntries()[0].value).toBe("s3cret-value");
  });

  it("wrong password never unlocks and never re-writes the envelope", async () => {
    writeLegacyEncryptedVault([]);
    expect(await store.unlock("wrong password")).toBe(false);
    const raw = JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));
    // Legacy envelope untouched — no kdf field, no rewrite on failure.
    expect(raw.kdf).toBeUndefined();
    expect(store.isLocked()).toBe(true);
  });
});
