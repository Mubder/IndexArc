import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

// AUD-014 decision (grace-period recoverability): the old purge deleted
// every plaintext recovery copy in the same operation that enabled
// encryption — a hostile or fumbled setup was unrecoverable. Now those
// copies are staged into backups/plaintext-grace/ and deleted only after
// the vault is successfully unlocked ≥24h after encryption.
describe("encryption grace period (ransom recoverability)", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  let store: VaultStore;
  let snapshotsBefore: Set<string>;

  const entry = (id: string, name: string) => ({
    id,
    value: `secret-${id}`,
    type: "api key",
    name,
    raw_fragment: "",
    labels: [] as string[],
    type_aliases: [] as string[],
    status: "saved" as const,
    family: "secret" as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  const graceDir = () => path.join(paths.backupsDir, "plaintext-grace");
  const marker = () => path.join(paths.configDir, "encrypt-grace.json");

  const plantPlaintextEra = () => {
    store.createEntry(entry("e1", "k1"));
    fs.writeFileSync(
      path.join(paths.backupsDir, "vault-2026-01-01.json"),
      JSON.stringify({ version: 1, entries: [entry("plain", "pre-encryption")] })
    );
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-grace-"));
    paths = ensurePortableLayout(tmpDir);
    store = new VaultStore(paths);
    snapshotsBefore = new Set(store.listEmergencySnapshots().map((s) => s.name));
  });

  afterEach(() => {
    try {
      const fresh = store.listEmergencySnapshots().filter((s) => !snapshotsBefore.has(s.name));
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

  it("stages plaintext copies (moved, not deleted) and writes the marker", async () => {
    plantPlaintextEra();
    await store.setupPassword("hunter2 hunter2");
    expect(fs.existsSync(path.join(graceDir(), "vault-2026-01-01.json"))).toBe(true);
    expect(fs.existsSync(path.join(paths.backupsDir, "vault-2026-01-01.json"))).toBe(false);
    const m = JSON.parse(fs.readFileSync(marker(), "utf8"));
    expect(typeof m.created_at).toBe("string");
    expect(m.staged.backups).toBeGreaterThanOrEqual(1);
  });

  it("a WRONG-password unlock leaves the grace area intact", async () => {
    plantPlaintextEra();
    await store.setupPassword("hunter2 hunter2");
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock("attacker-wrong-password")).toBe(false);
    expect(fs.existsSync(path.join(graceDir(), "vault-2026-01-01.json"))).toBe(true);
    expect(fs.existsSync(marker())).toBe(true);
  });

  it("a CORRECT unlock before the 24h window does NOT clear grace yet", async () => {
    plantPlaintextEra();
    await store.setupPassword("hunter2 hunter2");
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock("hunter2 hunter2")).toBe(true);
    // Same-day unlock (legit user back in): recovery copies stay available.
    expect(fs.existsSync(path.join(graceDir(), "vault-2026-01-01.json"))).toBe(true);
    expect(fs.existsSync(marker())).toBe(true);
  });

  it("a correct unlock AFTER the 24h window clears grace (verified new state)", async () => {
    plantPlaintextEra();
    await store.setupPassword("hunter2 hunter2");
    // Backdate the marker past the window.
    const m = JSON.parse(fs.readFileSync(marker(), "utf8"));
    m.created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(marker(), JSON.stringify(m));
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock("hunter2 hunter2")).toBe(true);
    expect(fs.existsSync(graceDir())).toBe(false);
    expect(fs.existsSync(marker())).toBe(false);
  });

  it("a grace snapshot is the hostile-encryption recovery path (restore by name)", async () => {
    plantPlaintextEra();
    // Plaintext-era snapshot that exists BEFORE encryption.
    const snapName = store.createEmergencySnapshot(50);
    expect(snapName).toBeTruthy();
    await store.setupPassword("attacker-password"); // hostile one-call encrypt

    // The pre-encryption snapshot was staged into grace and is still listed.
    const staged = store.listEmergencySnapshots().find((s) => s.name === snapName);
    expect(staged).toBeTruthy();
    expect(staged?.grace).toBe(true);
    expect(staged?.encrypted).toBe(false);

    // Simulate the reinstall/wipe + restore flow: vault file gone, restore
    // from the grace copy by name — the user gets their plaintext vault back.
    fs.rmSync(paths.vaultFile);
    expect(store.restoreEmergencySnapshot(snapName as string)).toBe(true);
    expect(store.isEncryptionEnabled()).toBe(false);
    const recovered = store.listEntries();
    expect(recovered.some((e) => e.value === "secret-e1")).toBe(true);
    // The staged BACKUP file (with its pre-encryption entry) also survived
    // in the grace area for manual recovery.
    expect(fs.readFileSync(path.join(graceDir(), "vault-2026-01-01.json"), "utf8")).toContain("pre-encryption");
  });
});
