import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { VaultStore, snapshotsToKeep } from "./store.js";
import { ensurePortableLayout } from "./paths.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const nameAt = (t: number) =>
  `indexarc-emergency-${new Date(t).toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "")}.iabak`;

// R1.3 — backups that actually reach back before a mistake.
describe("snapshot retention tiers", () => {
  const now = Date.UTC(2026, 10, 3, 12, 0, 0);

  it("a burst of edits no longer evicts every older snapshot", () => {
    const old = [nameAt(now - 3 * DAY), nameAt(now - 5 * HOUR)];
    const burst = Array.from({ length: 40 }, (_, i) => nameAt(now - i * 10_000));
    const keep = snapshotsToKeep([...old, ...burst], now, 15);
    for (const n of old) expect(keep.has(n)).toBe(true);
    expect(keep.size).toBeLessThan(old.length + burst.length);
  });

  it("thins to one per bucket and drops what is older than 8 weeks", () => {
    const sameDay = [nameAt(now - 3 * DAY), nameAt(now - 3 * DAY - HOUR)];
    const ancient = nameAt(now - 70 * DAY);
    const keep = snapshotsToKeep([...sameDay, ancient], now, 0);
    expect(keep.has(sameDay[0])).toBe(true); // newest of that day
    expect(keep.has(sameDay[1])).toBe(false);
    expect(keep.has(ancient)).toBe(false);
  });

  it("keeps names it cannot date", () => {
    expect(snapshotsToKeep(["hand-made.iabak"], now, 0).has("hand-made.iabak")).toBe(true);
  });
});

describe("scheduled backups and snapshot secrets", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;
  const prevKey = process.env.INDEXARC_SETTINGS_KEY;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-retention-"));
    paths = ensurePortableLayout(tmpDir);
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
    delete process.env.INDEXARC_SETTINGS_KEY;
  });

  afterEach(() => {
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    if (prevKey === undefined) delete process.env.INDEXARC_SETTINGS_KEY;
    else process.env.INDEXARC_SETTINGS_KEY = prevKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const entry = {
    value: "sk-x",
    type: "api key",
    name: "k",
    raw_fragment: "",
    labels: [] as string[],
    type_aliases: [] as string[],
    status: "saved" as const,
    family: "secret" as const,
  };

  it("takes a backup only when the newest one is over a day old", () => {
    const store = new VaultStore(paths);
    store.createEntry(entry);
    const first = store.maybeScheduledBackup();
    expect(first).toBeTruthy();
    expect(store.maybeScheduledBackup()).toBeNull();
    store.createEntry({ ...entry, value: "sk-y" }); // identical content is never re-backed-up
    expect(store.maybeScheduledBackup(Date.now() + DAY + HOUR)).toBeTruthy();
  });

  it("re-wraps plaintext API keys in snapshots taken before the key wrap", () => {
    const store = new VaultStore(paths);
    store.createEntry(entry);
    // Pre-migration: no wrap key, so settings.json (and its snapshot) is plaintext.
    store.saveSettings({ openai_api_key: "sk-plaintext-leak" });
    const snap = store.createEmergencySnapshot(50) as string;
    const dirs = (store as any).emergencyDirs() as string[];
    const files = dirs.map((d) => path.join(d, snap)).filter((f) => fs.existsSync(f));
    expect(files.length).toBeGreaterThan(0);
    const settingsIn = (f: string) =>
      JSON.parse(Buffer.from(JSON.parse(fs.readFileSync(f, "utf-8")).files.settings, "base64").toString("utf-8"));
    expect(settingsIn(files[0]).openai_api_key).toBe("sk-plaintext-leak");

    process.env.INDEXARC_SETTINGS_KEY = crypto.randomBytes(32).toString("base64");
    const migrated = new VaultStore(paths);
    expect(migrated.purgePlaintextSnapshotSecrets()).toBe(files.length);
    for (const f of files) {
      expect(settingsIn(f).openai_api_key.startsWith("enc:v1:")).toBe(true);
    }
    expect(migrated.purgePlaintextSnapshotSecrets()).toBe(0); // idempotent
  });
});
