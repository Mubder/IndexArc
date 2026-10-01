import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  deriveKeyAsync,
  currentKdf,
  kdfWithinBounds,
  envelopePayload,
  MIN_SALT_BYTES,
  KDF_BOUNDS,
} from "./crypto.js";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { decryptString } from "./crypto.js";

// RESIDUAL-3 regressions: envelope-controlled KDF parameters used to be
// trusted at derivation time — a tampered vault.json could downgrade to a
// 1-iteration PBKDF2 / tiny Argon2id, or hang the process with absurd
// values. Derivation now enforces salt + parameter bounds and fails closed.
describe("KDF envelope bounds (RESIDUAL-3)", () => {
  const salt16 = "a".repeat(32); // 16 bytes hex
  const pw = "correct horse battery staple";

  it("accepts the current standard and the legacy PBKDF2-100k envelope", async () => {
    const k1 = await deriveKeyAsync(pw, salt16, currentKdf());
    expect(k1.length).toBe(32);
    const k2 = await deriveKeyAsync(pw, salt16, { algo: "pbkdf2", iterations: 100_000, digest: "sha256" });
    expect(k2.length).toBe(32);
    expect(kdfWithinBounds(currentKdf())).toBe(true);
    expect(kdfWithinBounds({ algo: "pbkdf2", iterations: 100_000, digest: "sha256" })).toBe(true);
  });

  it("refuses a salt shorter than the minimum", async () => {
    await expect(deriveKeyAsync(pw, "abcd", currentKdf())).rejects.toThrow(/salt too short/);
    expect(MIN_SALT_BYTES).toBeGreaterThanOrEqual(16);
  });

  it("refuses a downgraded PBKDF2 iteration count", async () => {
    await expect(
      deriveKeyAsync(pw, salt16, { algo: "pbkdf2", iterations: 1_000, digest: "sha256" })
    ).rejects.toThrow(/outside enforced bounds/);
  });

  it("refuses a non-sha256 PBKDF2 digest", async () => {
    await expect(
      deriveKeyAsync(pw, salt16, { algo: "pbkdf2", iterations: 100_000, digest: "sha1" } as any)
    ).rejects.toThrow(/outside enforced bounds/);
  });

  it("refuses a weakened Argon2id memory size", async () => {
    await expect(
      deriveKeyAsync(pw, salt16, { algo: "argon2id", memorySize: 1024, iterations: 3, parallelism: 4 })
    ).rejects.toThrow(/outside enforced bounds/);
  });

  it("refuses absurd ceilings (DoS guard)", async () => {
    await expect(
      deriveKeyAsync(pw, salt16, { algo: "pbkdf2", iterations: KDF_BOUNDS.pbkdf2.maxIterations + 1, digest: "sha256" })
    ).rejects.toThrow(/outside enforced bounds/);
    await expect(
      deriveKeyAsync(pw, salt16, { algo: "argon2id", memorySize: KDF_BOUNDS.argon2id.maxMemoryKiB + 1, iterations: 3, parallelism: 4 })
    ).rejects.toThrow(/outside enforced bounds/);
  });
});

// RESIDUAL-2 regression: an unparseable vault used to "unlock" successfully
// as if it were an empty plaintext vault — the next write would then replace
// the user's data. unlock must fail closed (with the original quarantined).
describe("unlock fails closed on corrupt/weakened envelopes (RESIDUAL-2/3)", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-crypto-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("refuses to unlock a corrupt vault.json (quarantines it, returns false)", async () => {
    fs.writeFileSync(paths.vaultFile, "{ this is not json at all");
    await expect(store.unlock("whatever")).resolves.toBe(false);
    // The original is preserved for manual recovery, never deleted.
    const quarantined = fs.readdirSync(paths.dataDir).find((f) => f.includes(".corrupt-"));
    expect(quarantined).toBeTruthy();
  });

  it("refuses to unlock a vault whose envelope was weakened below the KDF floor", async () => {
    // Build a REAL envelope, then tamper the stored KDF descriptor down.
    await store.setupPassword("legit-password-123");
    const raw = JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));
    expect(await store.unlock("legit-password-123")).toBe(true); // sanity: untampered works

    raw.kdf = { algo: "pbkdf2", iterations: 1_000, digest: "sha256" };
    fs.writeFileSync(paths.vaultFile, JSON.stringify(raw));
    await expect(store.unlock("legit-password-123")).resolves.toBe(false);

    // Untampered envelopes of the same vintage still unlock: restore shape
    // and re-derive with the current standard.
    const clean = envelopePayload(JSON.stringify({ version: 1, entries: [] }), await deriveKeyAsync("legit-password-123", raw.salt), raw.salt, 1);
    fs.writeFileSync(paths.vaultFile, JSON.stringify(clean));
    await expect(store.unlock("legit-password-123")).resolves.toBe(true);
    expect(JSON.parse(decryptString(clean.ciphertext, await deriveKeyAsync("legit-password-123", clean.salt), clean.iv, clean.authTag))).toEqual({ version: 1, entries: [] });
  });

  it("still unlocks a fresh vault with no file at all (first-run flow)", async () => {
    await expect(store.unlock("anything")).resolves.toBe(true);
  });
});
