import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { VaultStore } from "./store.js";
import { ensurePortableLayout } from "./paths.js";
import { DatabaseSync } from "node:sqlite";
import { RecordDb, closeAllRecordDbs } from "./db/recordDb.js";
import { deriveKeyAsync, envelopePayload, kdfFromEnvelope, openEnvelope } from "./crypto.js";

// ASVS V6 / roadmap "row rollback detection": each vault.db row is sealed on
// its own, so a single row could be swapped for an older sealed copy (or
// removed) and still decrypt. A keyed checksum over all rows catches that.
describe("vault.db row rollback detection", () => {
  let tmpDir: string;
  let paths: ReturnType<typeof ensurePortableLayout>;
  const prevEmergency = process.env.INDEXARC_EMERGENCY_DIR;
  const PASSWORD = "plum-harbor-violet-9";
  const NEW_PASSWORD = "lantern-orchid-maple-42";

  const entry = (value: string, name: string) => ({
    value,
    type: "api key",
    name,
    raw_fragment: "",
    labels: [] as string[],
    type_aliases: [] as string[],
    status: "saved" as const,
    family: "secret" as const,
  });

  const rawRows = () => {
    const db = new RecordDb(paths.vaultDbFile).open();
    const rows = db.all("entries");
    closeAllRecordDbs();
    return rows;
  };

  /** Raw SQL on vault.db, as someone with disk access (and no key) would. */
  const tamper = (sql: string, ...params: any[]) => {
    const db = new DatabaseSync(paths.vaultDbFile);
    db.prepare(sql).run(...params);
    db.close();
  };

  async function vaultWithTwoEntries() {
    const store = new VaultStore(paths);
    await store.setupPassword(PASSWORD);
    const a = store.createEntry(entry("old-value", "a"));
    const b = store.createEntry(entry("value-b", "b"));
    return { store, a, b };
  }

  const reopen = async (pw = PASSWORD) => {
    const s = new VaultStore(paths);
    expect(await s.unlock(pw)).toBe(true);
    return s;
  };

  const rowsumWarnings = (s: VaultStore) => s.getIntegrityWarnings().filter((w) => w.startsWith("vault.db records changed"));

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "indexarc-rowsum-"));
    paths = ensurePortableLayout(tmpDir);
    process.env.INDEXARC_EMERGENCY_DIR = path.join(tmpDir, "emergency-shared");
  });

  afterEach(() => {
    closeAllRecordDbs();
    if (prevEmergency === undefined) delete process.env.INDEXARC_EMERGENCY_DIR;
    else process.env.INDEXARC_EMERGENCY_DIR = prevEmergency;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("an untouched vault passes, through edits, deletes and a reopen", async () => {
    const { store, a, b } = await vaultWithTwoEntries();
    store.updateEntry(a.id, { value: "new-value" });
    store.deleteEntry(b.id);
    store.createEntry(entry("value-c", "c"));
    expect(rowsumWarnings(store)).toEqual([]);
    store.lock();
    closeAllRecordDbs();
    const fresh = await reopen();
    expect(rowsumWarnings(fresh)).toEqual([]);
    expect(fresh.verifyIntegrity().filter((w) => w.startsWith("vault.db"))).toEqual([]);
  });

  it("flags a row rolled back to an older sealed copy", async () => {
    const { store, a } = await vaultWithTwoEntries();
    store.lock();
    closeAllRecordDbs();
    const oldRow = rawRows().find((r) => r.id === a.id)!;

    const s2 = await reopen();
    s2.updateEntry(a.id, { value: "new-value" });
    s2.lock();
    closeAllRecordDbs();

    tamper("UPDATE entries SET iv = ?, tag = ?, body = ? WHERE id = ?", oldRow.iv, oldRow.tag, oldRow.body, a.id);
    const fresh = await reopen();
    // The old copy still decrypts (same key, same row AAD) — that is the gap.
    expect(fresh.getEntry(a.id)?.value).toBe("old-value");
    expect(rowsumWarnings(fresh)).toHaveLength(1);
  });

  it("flags a removed row", async () => {
    const { store, b } = await vaultWithTwoEntries();
    store.lock();
    closeAllRecordDbs();
    tamper("DELETE FROM entries WHERE id = ?", b.id);
    const fresh = await reopen();
    expect(rowsumWarnings(fresh)).toHaveLength(1);
  });

  it("stays clean across a password change", async () => {
    const { store } = await vaultWithTwoEntries();
    expect(await store.changePassword(PASSWORD, NEW_PASSWORD)).toBe(true);
    expect(rowsumWarnings(store)).toEqual([]);
    store.lock();
    closeAllRecordDbs();
    const fresh = await reopen(NEW_PASSWORD);
    expect(rowsumWarnings(fresh)).toEqual([]);
  });

  it("flags a deleted checksum", async () => {
    const { store } = await vaultWithTwoEntries();
    store.lock();
    closeAllRecordDbs();
    tamper("DELETE FROM meta WHERE k = 'rowsum'");
    const fresh = await reopen();
    expect(rowsumWarnings(fresh)).toHaveLength(1);
  });

  it("a vault from before the checksum gets one on unlock, without a warning", async () => {
    const { store } = await vaultWithTwoEntries();
    store.lock();
    closeAllRecordDbs();
    tamper("DELETE FROM meta WHERE k = 'rowsum'");
    // Rewrite the header as an older build did: no rowsum flag.
    const header = JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));
    const key = await deriveKeyAsync(PASSWORD, header.salt, kdfFromEnvelope(header));
    const body = JSON.parse(openEnvelope(header, key, "vault"));
    expect(body.rowsum).toBe(1);
    delete body.rowsum;
    fs.writeFileSync(paths.vaultFile, JSON.stringify({ ...header, ...envelopePayload(JSON.stringify(body), key, header.salt, header.version, kdfFromEnvelope(header), "vault") }));
    const fresh = await reopen();
    expect(rowsumWarnings(fresh)).toEqual([]);
    fresh.lock();
    closeAllRecordDbs();
    const db = new RecordDb(paths.vaultDbFile).open();
    expect(db.getMeta("rowsum")).toMatch(/^[0-9a-f]{64}$/);
    closeAllRecordDbs();
    const h = JSON.parse(fs.readFileSync(paths.vaultFile, "utf8"));
    const k = await deriveKeyAsync(PASSWORD, h.salt, kdfFromEnvelope(h));
    expect(JSON.parse(openEnvelope(h, k, "vault")).rowsum).toBe(1);
  });
});
