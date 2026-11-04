import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { RecordDb, closeAllRecordDbs } from "./db/recordDb.js";

// R3.2 — SQLite record storage with per-record AES-GCM (ADR 0001).
describe("storage v2 (SQLite + per-record AES-GCM)", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;
  const PASSWORD = "correct horse battery staple";
  const SECRET = "sk-live-SUPERSECRET-0123456789";

  const entry = (value: string, name = "k") => ({
    value,
    type: "api key",
    name,
    raw_fragment: "",
    labels: [] as string[],
    type_aliases: [] as string[],
    status: "saved" as const,
    family: "secret" as const,
  });

  const chunk = (entryId: string, i = 0) => ({
    id: `${entryId}-c${i}`,
    entry_id: entryId,
    text: `chunk ${i} ${SECRET}`,
    embedding: [0.1, -0.25, 1 / 3, 1e-9],
    metadata: { name: "k", type: "api key", family: "secret", value_preview: "sk-l…" },
  });

  /** Every byte under the root that could hold the secret, as latin1 + utf16. */
  function filesContaining(needle: string): string[] {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) walk(p);
        else {
          const b = fs.readFileSync(p);
          if (b.includes(Buffer.from(needle, "utf8")) || b.includes(Buffer.from(needle, "utf16le"))) hits.push(p);
        }
      }
    };
    walk(tmpDir);
    return hits;
  }

  function writeV1(entries: any[], chunks: any[], encrypted: boolean) {
    if (!encrypted) {
      fs.writeFileSync(paths.vaultFile, JSON.stringify({ version: 1, entries }));
      fs.writeFileSync(paths.vectorsFile, JSON.stringify({ version: 2, chunks }));
      return;
    }
    const salt = crypto.randomBytes(16).toString("hex");
    const key = crypto.pbkdf2Sync(PASSWORD, Buffer.from(salt, "hex"), 100_000, 32, "sha256");
    const seal = (text: string) => {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([c.update(text, "utf8"), c.final()]);
      return { version: 1, encrypted: true, salt, iv: iv.toString("hex"), authTag: c.getAuthTag().toString("hex"), ciphertext: ct.toString("hex") };
    };
    fs.writeFileSync(paths.vaultFile, JSON.stringify(seal(JSON.stringify({ version: 1, entries }))));
    fs.writeFileSync(paths.vectorsFile, JSON.stringify(seal(JSON.stringify({ version: 2, chunks }))));
  }

  const v1Entry = (id: string, value: string) => ({ ...entry(value), id, created_at: "2025-01-01T00:00:00.000Z", updated_at: "2025-01-01T00:00:00.000Z" });

  const header = () => JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-v2-"));
    paths = ensurePortableLayout(tmpDir);
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
  });

  afterEach(() => {
    closeAllRecordDbs();
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("a new encrypted vault writes a small header plus vault.db, and no plaintext secret anywhere", async () => {
    const store = new VaultStore(paths);
    await store.setupPassword(PASSWORD);
    const e = store.createEntry(entry(SECRET));
    store.upsertVector(chunk(e.id));
    store.flushEmergencySnapshot();
    store.lock();
    closeAllRecordDbs();

    const h = header();
    expect(h.storage).toBe("sqlite");
    expect(h.encrypted).toBe(true);
    expect(fs.statSync(paths.vaultFile).size).toBeLessThan(2000);
    expect(fs.existsSync(paths.vaultDbFile)).toBe(true);
    expect(fs.existsSync(paths.vectorsFile)).toBe(false);
    expect(filesContaining(SECRET)).toEqual([]);

    const revBefore = new RecordDb(paths.vaultDbFile).open().rev();
    closeAllRecordDbs();
    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    // A clean unlock must not re-seal (rewrite) any row.
    expect((fresh as any).db().rev()).toBe(revBefore);
    expect(fresh.listEntries()[0].value).toBe(SECRET);
    const v = fresh.allVectors();
    expect(v).toHaveLength(1);
    expect(v[0].embedding).toEqual([0.1, -0.25, 1 / 3, 1e-9]);
  });

  it("migrates an encrypted v1 vault on unlock, keeping vectors and removing vectors.json", async () => {
    writeV1([v1Entry("a", SECRET), v1Entry("b", "second")], [chunk("a")], true);
    const store = new VaultStore(paths);
    expect(await store.unlock(PASSWORD)).toBe(true);
    expect(header().storage).toBe("sqlite");
    expect(fs.existsSync(paths.vectorsFile)).toBe(false);
    expect(store.listEntries().map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(store.allVectors()[0].text).toContain(SECRET);
    // A pre-migration snapshot exists for rollback.
    expect(store.listEmergencySnapshots().length).toBeGreaterThan(0);
    store.lock();
    closeAllRecordDbs();
    expect(filesContaining(SECRET).filter((f) => !f.includes("emergency"))).toEqual([]);

    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(fresh.getEntry("a")?.value).toBe(SECRET);
  });

  it("migrates a plaintext v1 vault on first read", () => {
    writeV1([v1Entry("a", "plain-value")], [chunk("a")], false);
    const store = new VaultStore(paths);
    expect(store.listEntries()[0].value).toBe("plain-value");
    expect(header().storage).toBe("sqlite");
    expect(header().encrypted).toBeFalsy();
    expect(store.allVectors()).toHaveLength(1);
    expect(fs.existsSync(paths.vectorsFile)).toBe(false);
  });

  it("detects a row body swapped between records (AAD binds table and id)", async () => {
    const store = new VaultStore(paths);
    await store.setupPassword(PASSWORD);
    const a = store.createEntry(entry("value-a", "a"));
    const b = store.createEntry(entry("value-b", "b"));
    store.lock();
    closeAllRecordDbs();

    const db = new RecordDb(paths.vaultDbFile).open();
    const rows = db.all("entries");
    const ra = rows.find((r) => r.id === a.id)!;
    const rb = rows.find((r) => r.id === b.id)!;
    db.tx(() => {
      db.put("entries", { ...ra, iv: rb.iv, tag: rb.tag, body: rb.body });
    });
    db.close();

    const fresh = new VaultStore(paths);
    await fresh.unlock(PASSWORD).catch(() => false);
    expect(() => fresh.listEntries()).toThrow(/decrypt/i);
  });

  it("re-seals plaintext rows left under an encrypted header (crash while encrypting)", async () => {
    const store = new VaultStore(paths);
    store.createEntry(entry(SECRET));
    expect(header().encrypted).toBeFalsy();
    // Simulate: header written encrypted, crash before rows were re-sealed.
    closeAllRecordDbs(); // fold the WAL into the main file before copying it
    const plainDb = fs.readFileSync(paths.vaultDbFile);
    await store.setupPassword(PASSWORD);
    store.lock();
    closeAllRecordDbs();
    for (const f of [paths.vaultDbFile + "-wal", paths.vaultDbFile + "-shm"]) fs.rmSync(f, { force: true });
    fs.writeFileSync(paths.vaultDbFile, plainDb);
    expect(new RecordDb(paths.vaultDbFile).open().getMeta("enc")).toBe("0");
    closeAllRecordDbs();

    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(fresh.listEntries()[0].value).toBe(SECRET);
    fresh.lock();
    closeAllRecordDbs();
    const db = new RecordDb(paths.vaultDbFile).open();
    expect(db.getMeta("enc")).toBe("1");
    expect(db.all("entries").every((r) => r.iv && r.tag)).toBe(true);
    db.close();
    expect(filesContaining(SECRET).filter((f) => !f.includes("emergency") && !f.includes("backup"))).toEqual([]);
  });

  it("re-seals rows still under the old salt after an interrupted re-key (KDF upgrade)", async () => {
    const store = new VaultStore(paths);
    await store.setupPassword(PASSWORD);
    store.createEntry(entry(SECRET));
    store.lock();
    closeAllRecordDbs();
    const oldDb = fs.readFileSync(paths.vaultDbFile);
    const oldSalt = header().salt;

    // Re-key under the same password (new salt), then put the old rows back:
    // header = new salt, rows + meta = old salt — what a crash mid-upgrade leaves.
    const s2 = new VaultStore(paths);
    expect(await s2.removePassword(PASSWORD)).toBe(true);
    await s2.setupPassword(PASSWORD);
    s2.lock();
    closeAllRecordDbs();
    expect(header().salt).not.toBe(oldSalt);
    for (const f of [paths.vaultDbFile + "-wal", paths.vaultDbFile + "-shm"]) fs.rmSync(f, { force: true });
    fs.writeFileSync(paths.vaultDbFile, oldDb);

    const s3 = new VaultStore(paths);
    expect(await s3.unlock(PASSWORD)).toBe(true);
    expect(s3.listEntries()[0].value).toBe(SECRET);
    s3.lock();
    closeAllRecordDbs();
    const db = new RecordDb(paths.vaultDbFile).open();
    expect(db.getMeta("salt")).toBe(header().salt);
    db.close();
  });

  it("emergency snapshots carry vault.db and restore it", async () => {
    const store = new VaultStore(paths);
    await store.setupPassword(PASSWORD);
    const e = store.createEntry(entry("before"));
    store.flushEmergencySnapshot();
    const snaps = store.listEmergencySnapshots();
    expect(snaps.length).toBeGreaterThan(0);
    const name = snaps[0].name;
    expect(store.emergencySnapshotIsEncrypted(name)).toBe(true);

    store.updateEntry(e.id, { value: "after" });
    expect(store.getEntry(e.id)?.value).toBe("after");
    expect(store.restoreEmergencySnapshot(name)).toBe(true);
    store.lock();
    closeAllRecordDbs();

    const fresh = new VaultStore(paths);
    expect(await fresh.unlock(PASSWORD)).toBe(true);
    expect(fresh.getEntry(e.id)?.value).toBe("before");
  });

  it("a snapshot with plaintext rows does not count as encrypted", () => {
    const store = new VaultStore(paths);
    store.createEntry(entry("plain"));
    store.flushEmergencySnapshot();
    const name = store.listEmergencySnapshots()[0].name;
    expect(store.emergencySnapshotIsEncrypted(name)).toBe(false);
  });

  it("10k entries: unlock, list and row writes stay fast", async () => {
    const store = new VaultStore(paths);
    await store.setupPassword(PASSWORD);
    const now = new Date().toISOString();
    const entries = Array.from({ length: 10_000 }, (_, i) => ({ ...entry(`value-${i}`, `n${i}`), id: `e${i}`, created_at: now, updated_at: now }));
    const chunks = entries.map((e) => ({ ...chunk(e.id), embedding: Array.from({ length: 384 }, (_, j) => Math.sin(i0(e.id) + j)) }));
    (store as any).writeDbTables(entries, chunks);
    store.lock();
    closeAllRecordDbs();

    const t: Record<string, number> = {};
    const time = async <T>(k: string, fn: () => T | Promise<T>) => {
      const s = performance.now();
      const out = await fn();
      t[k] = Math.round(performance.now() - s);
      return out;
    };
    const fresh = new VaultStore(paths);
    await time("unlock", () => fresh.unlock(PASSWORD));
    const list = await time("list", () => fresh.listEntries());
    expect(list).toHaveLength(10_000);
    const created = await time("create", () => fresh.createEntry(entry("new")));
    await time("update", () => fresh.updateEntry("e5000", { value: "changed" }));
    await time("upsertVector", () => fresh.upsertVector(chunk(created.id)));
    await time("delete", () => fresh.deleteEntry("e42"));
    expect(fresh.listEntries()).toHaveLength(10_000);
    console.log("[storage-v2 bench, 10k entries + 10k×384-d vectors] ms:", JSON.stringify(t));
    // Row writes no longer rewrite the whole vault.
    for (const k of ["create", "update", "upsertVector", "delete"]) expect(t[k]).toBeLessThan(1500);
  }, 120_000);
});

function i0(id: string): number {
  return Number(id.slice(1)) || 0;
}
