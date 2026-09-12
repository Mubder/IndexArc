import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

// Audit finding C1: scan sessions (extracted secret values + raw fragments)
// must live inside the encryption envelope, and enabling encryption must
// scrub every pre-existing plaintext artifact (backups, snapshots, .prev).
describe("encryption envelope coverage + plaintext scrub", () => {
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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-envelope-test-"));
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

  it("scan sessions are encrypted when the vault is encrypted", async () => {
    store.createEntry(entry("e1", "k1"));
    // Plant a legacy plaintext session with a secret value.
    fs.writeFileSync(
      paths.scanSessionsFile,
      JSON.stringify({
        version: 1,
        sessions: [
          {
            id: "s1",
            status: "review",
            folder: "C:\\somewhere",
            candidates: [{ path: "C:\\somewhere\\.env", value: "AKIA_PLAINTEXT_LEAK", raw_fragment: "KEY=..." }],
          },
        ],
      }),
      "utf8"
    );

    await store.setupPassword("hunter2 hunter2");
    const raw = JSON.parse(fs.readFileSync(paths.scanSessionsFile, "utf8"));
    expect(raw.encrypted).toBe(true);
    expect(JSON.stringify(raw)).not.toContain("AKIA_PLAINTEXT_LEAK");

    // Round-trip: same store instance reads it back decrypted.
    const sessions = store.listScanSessions();
    expect(sessions.length).toBe(1);
    expect(sessions[0].candidates[0].value).toBe("AKIA_PLAINTEXT_LEAK");

    // Fresh instance after unlock too.
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock("hunter2 hunter2")).toBe(true);
    expect(fresh.listScanSessions().length).toBe(1);
  });

  it("setting a password scrubs pre-existing plaintext backups and snapshots", async () => {
    store.createEntry(entry("e1", "k1"));

    // Plaintext artifacts from the unencrypted era.
    fs.writeFileSync(path.join(paths.backupsDir, "vault-2026-01-01.json"), JSON.stringify({ version: 1, entries: [entry("x", "plain")] }));
    fs.writeFileSync(path.join(paths.backupsDir, "settings-2026-01-01.json"), JSON.stringify({ gemini_api_key: "AIzaPLAINTEXT" }));
    const snapDir = path.join(paths.backupsDir, "emergency");
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(
      path.join(snapDir, "indexarc-emergency-2026-01-01T00-00-00.000.iabak"),
      JSON.stringify({ format: "indexarc-emergency", version: 1, created_at: "2026-01-01", encrypted: false, files: { vault: Buffer.from("plaintext").toString("base64") } })
    );
    fs.writeFileSync(paths.scratchpadFile + ".prev", JSON.stringify({ version: 2, tabs: [{ title: "plain note" }] }));

    await store.setupPassword("hunter2 hunter2");

    expect(fs.existsSync(path.join(paths.backupsDir, "vault-2026-01-01.json"))).toBe(false);
    expect(fs.existsSync(path.join(paths.backupsDir, "settings-2026-01-01.json"))).toBe(false);
    expect(fs.existsSync(path.join(snapDir, "indexarc-emergency-2026-01-01T00-00-00.000.iabak"))).toBe(false);
    expect(fs.existsSync(paths.scratchpadFile + ".prev")).toBe(false);

    // An ENCRYPTED snapshot (written after setup) survives.
    const remaining = fs.readdirSync(snapDir).filter((f) => f.endsWith(".iabak"));
    expect(remaining.length).toBeGreaterThan(0);
    for (const f of remaining) {
      const parsed = JSON.parse(fs.readFileSync(path.join(snapDir, f), "utf8"));
      expect(parsed.encrypted).toBe(true);
    }
  });
});
