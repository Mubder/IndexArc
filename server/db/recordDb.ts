import fs from "fs";
import path from "path";
import { createRequire } from "module";
import type { DatabaseSync as DatabaseSyncT, StatementSync } from "node:sqlite";

// SQLite record store (R3.2, ADR docs/adr/0001-storage-engine.md).
//
// One row per record. The store above this layer seals every body with
// AES-256-GCM and AAD = (table, id, schema); this file only moves opaque
// bytes and never sees a key. Built on Node's own `node:sqlite` (present in
// Electron 44's Node 24), so there is no native module to rebuild.
//
// Durability: WAL journal + synchronous=FULL, so a committed transaction
// survives a crash or power loss. secure_delete=ON overwrites freed pages,
// so replaced plaintext/ciphertext does not linger in the file.

// Loaded lazily so bundling for Node versions without node:sqlite fails only
// when the database is actually used (esbuild keeps `node:` builtins external).
const nodeRequire = createRequire(typeof __filename !== "undefined" ? __filename : import.meta.url);
function sqlite(): typeof import("node:sqlite") {
  return nodeRequire("node:sqlite");
}

export type RecordTable = "entries" | "vectors";
export const RECORD_TABLES: readonly RecordTable[] = ["entries", "vectors"];

export interface RecordRow {
  id: string;
  /** Owning entry (vectors only; equals id for entries). */
  entry_id: string;
  /** null when the vault is unencrypted (body is plain JSON then). */
  iv: Buffer | null;
  tag: Buffer | null;
  body: Buffer;
}

export const DB_SCHEMA = 1;

/** Every open database, so shutdown (and tests) can close them all. */
const openDbs = new Set<RecordDb>();

export function closeAllRecordDbs(): void {
  for (const db of [...openDbs]) db.close();
}

export class RecordDb {
  private db: DatabaseSyncT | null = null;
  private stmts = new Map<string, StatementSync>();

  constructor(readonly file: string) {}

  get isOpen(): boolean {
    return !!this.db;
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  open(): this {
    if (this.db) return this;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const db = new (sqlite().DatabaseSync)(this.file);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA secure_delete = ON");
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA busy_timeout = 5000");
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entries (
        id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, iv BLOB, tag BLOB, body BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS vectors (
        id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, iv BLOB, tag BLOB, body BLOB NOT NULL
      );
      CREATE INDEX IF NOT EXISTS vectors_entry ON vectors(entry_id);
    `);
    this.db = db;
    openDbs.add(this);
    if (this.getMeta("schema") === null) this.setMeta("schema", String(DB_SCHEMA));
    return this;
  }

  close(): void {
    if (!this.db) return;
    try {
      this.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
    this.stmts.clear();
    this.db.close();
    this.db = null;
    openDbs.delete(this);
  }

  conn(): DatabaseSyncT {
    return this.open().db as DatabaseSyncT;
  }

  private stmt(sql: string): StatementSync {
    let s = this.stmts.get(sql);
    if (!s) {
      s = this.conn().prepare(sql);
      this.stmts.set(sql, s);
    }
    return s;
  }

  /** Run `fn` in one IMMEDIATE transaction; rolls back on throw. */
  tx<T>(fn: () => T): T {
    const db = this.conn();
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      try {
        db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }

  getMeta(k: string): string | null {
    const r = this.stmt("SELECT v FROM meta WHERE k = ?").get(k) as { v: string } | undefined;
    return r ? r.v : null;
  }

  setMeta(k: string, v: string): void {
    this.stmt("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
  }

  deleteMeta(k: string): void {
    this.stmt("DELETE FROM meta WHERE k = ?").run(k);
  }

  /**
   * Keyed checksum over the sealed rows, for rollback/removal detection:
   * meta "rowsum" = XOR over every encrypted row of rowMac(table, id, tag).
   * The GCM tag is unique per sealing, so replacing a row with an older
   * sealed copy, deleting one, or copying one in from another copy of the
   * database changes the sum, and without the vault key the sum cannot be
   * fixed up. Kept in the same transaction as the row change.
   *
   * The store provides the MAC; it returns null when there is no key
   * (plaintext vault), and then no checksum is kept.
   */
  rowMacProvider: (() => ((table: RecordTable, id: string, tag: Buffer) => Buffer) | null) | null = null;
  private bulk = false;

  private macs() {
    return this.rowMacProvider?.() ?? null;
  }

  private static xorInto(acc: Buffer, b: Buffer): void {
    for (let i = 0; i < acc.length && i < b.length; i++) acc[i] ^= b[i];
  }

  /** Full recomputation (null when there is no key). */
  computeRowSum(): Buffer | null {
    const mac = this.macs();
    if (!mac) return null;
    const acc = Buffer.alloc(32);
    for (const table of RECORD_TABLES) {
      const rows = this.stmt(`SELECT id, tag FROM ${table}`).all() as unknown as Array<{ id: string; tag: Uint8Array | null }>;
      for (const r of rows) if (r.tag) RecordDb.xorInto(acc, mac(table, r.id, Buffer.from(r.tag)));
    }
    return acc;
  }

  recomputeRowSum(): void {
    const s = this.computeRowSum();
    if (s) this.setMeta("rowsum", s.toString("hex"));
    else this.deleteMeta("rowsum");
  }

  /** Apply a row change to the checksum: XOR out removed tags, XOR in added ones. */
  private adjustRowSum(table: RecordTable, removed: Array<{ id: string; tag: Uint8Array | null }>, added: Array<{ id: string; tag: Buffer | null }>): void {
    if (this.bulk) return;
    const mac = this.macs();
    const cur = this.getMeta("rowsum");
    if (!mac || cur === null) {
      // No key, or a database from before the checksum: (re)build it whole.
      this.recomputeRowSum();
      return;
    }
    const acc = Buffer.from(cur, "hex");
    for (const r of removed) if (r.tag) RecordDb.xorInto(acc, mac(table, r.id, Buffer.from(r.tag)));
    for (const r of added) if (r.tag) RecordDb.xorInto(acc, mac(table, r.id, r.tag));
    this.setMeta("rowsum", acc.toString("hex"));
  }

  /** Monotonic change counter, bumped by every write (backups dedupe on it). */
  rev(): number {
    return Number(this.getMeta("rev") || 0);
  }

  private bump(): void {
    this.setMeta("rev", String(this.rev() + 1));
  }

  all(table: RecordTable): RecordRow[] {
    const rows = this.stmt(`SELECT id, entry_id, iv, tag, body FROM ${table}`).all() as unknown as Array<{
      id: string;
      entry_id: string;
      iv: Uint8Array | null;
      tag: Uint8Array | null;
      body: Uint8Array;
    }>;
    return rows.map((r) => ({
      id: r.id,
      entry_id: r.entry_id,
      iv: r.iv ? Buffer.from(r.iv) : null,
      tag: r.tag ? Buffer.from(r.tag) : null,
      body: Buffer.from(r.body),
    }));
  }

  count(table: RecordTable): number {
    return Number((this.stmt(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  }

  put(table: RecordTable, row: RecordRow): void {
    const old = this.bulk ? undefined : (this.stmt(`SELECT id, tag FROM ${table} WHERE id = ?`).get(row.id) as { id: string; tag: Uint8Array | null } | undefined);
    this.stmt(
      `INSERT INTO ${table} (id, entry_id, iv, tag, body) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET entry_id = excluded.entry_id, iv = excluded.iv, tag = excluded.tag, body = excluded.body`
    ).run(row.id, row.entry_id, row.iv, row.tag, row.body);
    this.adjustRowSum(table, old ? [old] : [], [{ id: row.id, tag: row.tag }]);
    this.bump();
  }

  delete(table: RecordTable, id: string): number {
    const gone = this.stmt(`SELECT id, tag FROM ${table} WHERE id = ?`).all(id) as unknown as Array<{ id: string; tag: Uint8Array | null }>;
    const r = this.stmt(`DELETE FROM ${table} WHERE id = ?`).run(id);
    this.adjustRowSum(table, gone, []);
    this.bump();
    return Number(r.changes);
  }

  deleteByEntry(table: RecordTable, entryId: string): number {
    const gone = this.stmt(`SELECT id, tag FROM ${table} WHERE entry_id = ?`).all(entryId) as unknown as Array<{ id: string; tag: Uint8Array | null }>;
    const r = this.stmt(`DELETE FROM ${table} WHERE entry_id = ?`).run(entryId);
    this.adjustRowSum(table, gone, []);
    this.bump();
    return Number(r.changes);
  }

  /** Replace a whole table in the CURRENT transaction (caller wraps in tx). */
  replaceAll(table: RecordTable, rows: RecordRow[]): void {
    this.stmt(`DELETE FROM ${table}`).run();
    this.bulk = true;
    try {
      for (const row of rows) this.put(table, row);
    } finally {
      this.bulk = false;
    }
    this.recomputeRowSum();
    this.bump();
  }

  /** Rewrite the file so freed pages (old plaintext/keys) are gone. */
  compact(): void {
    const db = this.conn();
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.exec("VACUUM");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  /** Consistent copy of the live database (safe while open). */
  copyTo(dest: string): void {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    try {
      fs.unlinkSync(dest);
    } catch {}
    this.stmt("VACUUM INTO ?").run(dest);
  }

  /** Bytes of a consistent copy, or null when there is no database. */
  snapshotBytes(tmpDir: string): Buffer | null {
    if (!this.exists()) return null;
    const tmp = path.join(tmpDir, `.vault-db-${process.pid}-${Date.now()}.tmp`);
    try {
      this.copyTo(tmp);
      return fs.readFileSync(tmp);
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }

  /**
   * True when every row in a database image is sealed (no plaintext row).
   * Used to vet snapshots before a restore while the vault is locked.
   */
  static imageIsFullyEncrypted(bytes: Buffer, tmpDir: string): boolean {
    const tmp = path.join(tmpDir, `.vault-db-check-${process.pid}-${Date.now()}.tmp`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(tmp, bytes);
    const db = new RecordDb(tmp);
    try {
      db.open();
      if (db.getMeta("enc") !== "1") return db.count("entries") + db.count("vectors") === 0;
      for (const t of RECORD_TABLES) {
        const n = Number((db.conn().prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE iv IS NULL OR tag IS NULL`).get() as { n: number }).n);
        if (n > 0) return false;
      }
      return true;
    } catch {
      return false;
    } finally {
      db.removeFiles();
    }
  }

  /** Delete the database files (after close). Used by restore. */
  removeFiles(): void {
    this.close();
    for (const f of [this.file, `${this.file}-wal`, `${this.file}-shm`]) {
      try {
        fs.unlinkSync(f);
      } catch {}
    }
  }
}
