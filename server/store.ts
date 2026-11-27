import fs from "fs";
import os from "os";
import path from "path";
import crypto, { randomUUID } from "crypto";
import type { PortablePaths } from "./paths.js";
import type {
  AppSettings,
  VaultEntry,
  VectorChunk,
  EntryStatus,
  FolderScanSession,
  WatchedFolder,
} from "./types.js";
import { DEFAULT_SETTINGS } from "./types.js";
import { deriveKeyAsync, generateSalt, decryptString, encryptString, envelopePayload, kdfFromEnvelope, kdfNeedsUpgrade, currentKdf, openEnvelope } from "./crypto.js";
import { RecordDb, RECORD_TABLES, type RecordRow, type RecordTable } from "./db/recordDb.js";
import type { KdfParams } from "./crypto.js";
import { addLog } from "./logs.js";
import { RECOVERY_ALG, generateRecoveryKey, openWithRecoveryCode, sealToRecoveryKey } from "./recovery.js";
import { cliDigester, revokeAllCliTokens, type Digester } from "./cli.js";

/** AAD for the previous vault key kept in vault.db meta during a re-key. */
const PREV_KEY_AAD = "indexarc:v2:prevkey";

/** Thrown when a save would mutate/remove a protected tab (map to HTTP 423). */
export class ProtectedTabError extends Error {
  constructor(public tabIds: string[]) {
    super(`Protected notes cannot be changed: ${tabIds.join(", ")}`);
    this.name = "ProtectedTabError";
  }
}

interface VaultFile {
  version: 1;
  entries: VaultEntry[];
}

// Schema 2 (audit H2): pre-2.1 vectors were built from embeddings whose
// INPUT included raw secret values. Reading a legacy (or unknown-schema)
// vectors file yields an EMPTY index — the stale secret-derived embeddings
// are dropped, never re-served, and entries are re-embedded on their next
// save under the redacted indexText rules.
const VECTOR_SCHEMA = 2;

// Storage v2 (R3.2): vault.json is a small header (KDF, salt, key check);
// entries and vectors live one-record-per-row in data/vault.db, each row
// sealed with AES-256-GCM and AAD = (table, id, schema).
export const STORAGE_V2 = "sqlite";

/** Key order-independent KDF fingerprint. */
/** Comparable form of KDF params (normalised first: drops derived fields). */
function kdfKey(k: KdfParams): string {
  k = kdfFromEnvelope({ kdf: k });
  const o = k as unknown as Record<string, unknown>;
  return JSON.stringify(Object.keys(o).sort().map((x) => [x, o[x]]));
}

/** Embeddings are stored as packed float64 (exact, ~2x smaller than JSON). */
function packChunk(c: VectorChunk): Record<string, unknown> {
  const { embedding, ...rest } = c;
  if (!Array.isArray(embedding)) return { ...rest, embedding: null };
  return { ...rest, embedding: null, emb_f64: Buffer.from(new Float64Array(embedding).buffer).toString("base64") };
}

function unpackChunk(o: any): VectorChunk {
  if (typeof o?.emb_f64 === "string") {
    const b = Buffer.from(o.emb_f64, "base64");
    const copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.length);
    o.embedding = Array.from(new Float64Array(copy));
    delete o.emb_f64;
  }
  return o as VectorChunk;
}

interface VectorsFile {
  version: typeof VECTOR_SCHEMA;
  chunks: VectorChunk[];
}

// ── Durable file I/O ──────────────────────────────────────────────────────
// Antivirus scanners and sync clients (OneDrive, Dropbox) briefly lock files
// on Windows. Those errors are TRANSIENT: retried, and if they persist they
// surface as an error — they never read as "file missing/corrupt", which used
// to quarantine a healthy vault, lift the lock gate and let the next write
// put plaintext where ciphertext had been (audit M-2).
const TRANSIENT_IO_CODES = new Set(["EBUSY", "EPERM", "EACCES", "EAGAIN", "EMFILE", "ENFILE"]);
const IO_RETRIES = 5;

/** Persistent I/O failure on a store file (as opposed to bad content). */
export class StoreIOError extends Error {
  constructor(public filePath: string, public code: string | undefined, message: string) {
    super(message);
    this.name = "StoreIOError";
  }
}

function sleepSync(ms: number) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withIoRetry<T>(filePath: string, op: () => T): T {
  for (let attempt = 0; ; attempt++) {
    try {
      return op();
    } catch (e: any) {
      if (!TRANSIENT_IO_CODES.has(e?.code)) throw e;
      if (attempt >= IO_RETRIES) {
        throw new StoreIOError(filePath, e.code, `${path.basename(filePath)} is locked by another process (${e.code}) — try again`);
      }
      sleepSync(40 * (attempt + 1));
    }
  }
}

/** File content, or null when it doesn't exist. Transient locks are retried. */
function readFileStrict(filePath: string): string | null {
  return withIoRetry(filePath, () => {
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch (e: any) {
      if (e?.code === "ENOENT") return null;
      throw e;
    }
  });
}

// Write-temp → fsync → rename → fsync(dir): after a crash or power loss the
// target holds either the complete old or the complete new content, never a
// torn mix (a bare rename can reach disk before the data it points to).
function atomicWrite(filePath: string, data: string | Buffer) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    withIoRetry(filePath, () => fs.renameSync(tmp, filePath));
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    throw e;
  }
  fsyncDir(dir);
}

function fsyncDir(dir: string) {
  // Directory fsync persists the rename itself. Windows can't open a
  // directory for fsync (EPERM/EISDIR) — NTFS journals the rename instead.
  try {
    const fd = fs.openSync(dir, "r");
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
}

function parseJsonText<T>(text: string): T {
  // Tolerate a UTF-8 BOM (Windows editors like Notepad add one) — without
  // this, a hand-edited file parses as "corrupt" and gets quarantined even
  // though its content is perfectly valid.
  return JSON.parse(text.replace(/^\uFEFF/, "")) as T;
}

/**
 * For files whose misreading could downgrade encryption or lose data
 * (vault, vectors, notes): missing → fallback; unreadable (I/O) or
 * unparseable → THROWS. Never silently becomes the fallback.
 */
function readJsonStrict<T>(filePath: string, fallback: T): T {
  const text = readFileStrict(filePath);
  if (text === null) return fallback;
  return parseJsonText<T>(text);
}

// Like readJsonStrict, but an UNPARSEABLE file is renamed to
// *.corrupt-<stamp> (quarantined, never deleted or overwritten) so the user
// can recover it manually instead of the store silently wiping it. A locked
// file is NOT corruption: StoreIOError is thrown and the file left alone.
function readJsonOrQuarantine<T>(filePath: string, fallback: T, label: string): T {
  const text = readFileStrict(filePath);
  if (text === null) return fallback;
  try {
    return parseJsonText<T>(text);
  } catch (e: any) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const quarantined = `${filePath}.corrupt-${stamp}`;
      fs.renameSync(filePath, quarantined);
      addLog("DATA", `${label} was unreadable — quarantined as ${path.basename(quarantined)} (NOT deleted)`);
    } catch {
      addLog("DATA", `${label} was unreadable and could not be quarantined: ${e?.message || e}`);
    }
    return fallback;
  }
}

// True when every vault-key-protected file carried by an emergency snapshot
// is an encrypted envelope (settings.json is not vault-key protected). Absent
// files don't count against it — restoring them is a no-op.
/** Parsed header fields of emergency snapshot files, keyed by full path. */
const snapshotMetaCache = new Map<
  string,
  { size: number; mtimeMs: number; created_at: string; encrypted: boolean; has_vault: boolean; has_notes: boolean }
>();

/**
 * Header fields of a snapshot file without JSON.parse-ing tens of MB. The
 * writer (buildSnapshot) emits created_at/encrypted first and every file as a
 * base64 string or null — base64 never contains a quote, so `"key":"` marks a
 * present file. Anything unexpected falls back to a full parse.
 */
function peekSnapshotMeta(buf: Buffer): { created_at: string | null; encrypted: boolean; has_vault: boolean; has_notes: boolean } {
  const head = buf.subarray(0, 512).toString("utf8");
  const m = /^\{"format":"indexarc-emergency","version":1,"created_at":"([^"]+)","encrypted":(true|false),"files":\{/.exec(head);
  if (!m) {
    const parsed = JSON.parse(buf.toString("utf8"));
    return {
      created_at: parsed?.created_at || null,
      encrypted: !!parsed?.encrypted,
      has_vault: !!(parsed?.files?.vault || parsed?.files?.vault_db),
      has_notes: !!(parsed?.files?.scratchpad || parsed?.files?.scratchpad_archive),
    };
  }
  const has = (k: string) => buf.includes(`"${k}":"`);
  return {
    created_at: m[1],
    encrypted: m[2] === "true",
    has_vault: has("vault") || has("vault_db"),
    has_notes: has("scratchpad") || has("scratchpad_archive"),
  };
}

function snapshotIsFullyEncrypted(snapshot: any, tmpDir = os.tmpdir()): boolean {
  const files = snapshot?.files || {};
  if (files.vault_db != null) {
    try {
      if (!RecordDb.imageIsFullyEncrypted(Buffer.from(files.vault_db, "base64"), tmpDir)) return false;
    } catch {
      return false;
    }
  }
  for (const key of ["vault", "vectors", "scratchpad", "scratchpad_archive", "note_revisions"]) {
    const b64 = files[key];
    if (b64 == null) continue;
    try {
      const parsed = JSON.parse(Buffer.from(b64, "base64").toString("utf-8").replace(/^﻿/, ""));
      if (!parsed?.encrypted) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Parse the UTC time out of indexarc-emergency-YYYY-MM-DD_HH-mm-ss-mmm.iabak. */
function snapshotTime(name: string): number | null {
  const m = /^indexarc-emergency-(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})-(\d{3})/.exec(name);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]);
}

/**
 * Which snapshots to keep: the newest `recent`, plus the newest of each hour
 * for the last 24 h, each day for the last 14 days and each week for the
 * last 8 weeks. Count-only retention ("newest 15") meant ~2.5 minutes of
 * edits — the 10 s debounce re-arms on every write — evicted every snapshot
 * from before a mistake (audit M-6). Unparseable names are kept.
 */
export function snapshotsToKeep(names: string[], now: number, recent = 15): Set<string> {
  const keep = new Set<string>();
  const timed: Array<{ name: string; t: number }> = [];
  for (const name of names) {
    const t = snapshotTime(name);
    if (t === null) keep.add(name);
    else timed.push({ name, t });
  }
  timed.sort((a, b) => b.t - a.t); // newest first
  timed.slice(0, recent).forEach((s) => keep.add(s.name));
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  const tiers: Array<{ span: number; bucket: number }> = [
    { span: DAY, bucket: HOUR },
    { span: 14 * DAY, bucket: DAY },
    { span: 56 * DAY, bucket: 7 * DAY },
  ];
  for (const { span, bucket } of tiers) {
    const seen = new Set<number>();
    for (const s of timed) {
      if (now - s.t > span) continue;
      const b = Math.floor(s.t / bucket);
      if (seen.has(b)) continue; // newest in this bucket already kept
      seen.add(b);
      keep.add(s.name);
    }
  }
  return keep;
}

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8").replace(/^\uFEFF/, "")) as T;
  } catch {
    return fallback;
  }
}

export class VaultStore {
  private encryptionKey: Buffer | null = null;
  // The salt the CURRENT key was actually derived from. Must always be the
  // salt written into encrypted envelopes — a mismatch means the file can
  // never be decrypted again (this exact bug previously broke unlock after
  // setupPassword: writeVault stored a freshly generated salt instead).
  private encryptionSaltHex: string | null = null;
  // The KDF that produced encryptionKey — written into every envelope so a
  // session still on a legacy (PBKDF2) key never labels its writes Argon2id.
  private encryptionKdf: KdfParams | null = null;
  /** Cache for headerAadBound(): vault.json's mtime+size → bound? */
  private _headerBoundCache: { stamp: string; bound: boolean } | null = null;

  private keyKdf(): KdfParams {
    return this.encryptionKdf ?? currentKdf();
  }
  private _settingsCache: AppSettings | null = null;
  private _entriesCache: VaultEntry[] | null = null;
  private _vectorsCache: VectorChunk[] | null = null;
  private _db: RecordDb | null = null;
  private _foldersCache: WatchedFolder[] | null = null;
  private _scratchpadCache: any[] | null = null;
  private _scratchpadArchiveCache: any[] | null = null;
  private emergencyTimer: NodeJS.Timeout | null = null;

  constructor(private paths: PortablePaths) {}

  /**
   * Keep the machine-level emergency snapshots fresh. Snapshots fan out to
   * %APPDATA%/IndexArc and ~/.IndexArc, which survive install-folder deletion
   * — but they used to be written only at startup, so a tray-resident app
   * (sessions lasting days) restored a stale vault after a reinstall wiped
   * the install folder. Any user-data write re-arms a short debounce instead;
   * flushEmergencySnapshot() fires it immediately (quit time).
   */
  private touchEmergencySnapshot() {
    if (this.emergencyTimer) return;
    this.emergencyTimer = setTimeout(() => {
      this.emergencyTimer = null;
      try {
        this.createEmergencySnapshot();
      } catch {}
      this.maybeScheduledBackup();
    }, 10_000);
    this.emergencyTimer.unref?.();
  }

  /**
   * backups/ used to be written only at server start — a tray-resident app
   * running for weeks had no backup newer than its launch. Called from the
   * write-debounce: takes a backup when the newest one is over a day old.
   */
  maybeScheduledBackup(now = Date.now()): string | null {
    try {
      const dir = this.paths.backupsDir;
      const newest = fs.existsSync(dir)
        ? Math.max(0, ...fs.readdirSync(dir).filter((f) => /^vault-.*\.json$/.test(f)).map((f) => fs.statSync(path.join(dir, f)).mtimeMs))
        : 0;
      if (now - newest < 24 * 3_600_000) return null;
      return this.backupVault(10);
    } catch {
      return null;
    }
  }

  /** Write an emergency snapshot now, discarding any pending debounce. */
  flushEmergencySnapshot() {
    if (this.emergencyTimer) {
      clearTimeout(this.emergencyTimer);
      this.emergencyTimer = null;
    }
    try {
      this.createEmergencySnapshot();
    } catch {}
  }

  /** Invalidate all in-memory caches (call after any write) */
  clearCache() {
    this._settingsCache = null;
    this._entriesCache = null;
    this._vectorsCache = null;
    this._foldersCache = null;
    this._scratchpadCache = null;
    this._scratchpadArchiveCache = null;
  }

  // --- Encryption Support ---
  // Cached by the vault file's (mtime, size): isLocked() runs on every
  // protected request and used to re-read and parse all of vault.json.
  private _encEnabledCache: { mtimeMs: number; size: number; value: boolean } | null = null;

  isEncryptionEnabled(): boolean {
    let st: fs.Stats | null = null;
    try {
      st = fs.statSync(this.paths.vaultFile);
    } catch (e: any) {
      if (e?.code !== "ENOENT") return true; // can't tell → fail CLOSED (locked)
    }
    if (!st) {
      this._encEnabledCache = null;
      return false;
    }
    const c = this._encEnabledCache;
    if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.value;
    try {
      const raw = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
      const value = !!(raw && raw.encrypted);
      this._encEnabledCache = raw ? { mtimeMs: st.mtimeMs, size: st.size, value } : null;
      if (value) this.setEncryptionExpected(true);
      return value;
    } catch {
      // Locked by another process (StoreIOError): treat as encrypted, so the
      // gate stays CLOSED and no write path decides "plaintext" (audit M-2).
      return true;
    }
  }

  // ── "Encryption expected" marker ─────────────────────────────────────────
  // Set whenever an encrypted vault has been seen; cleared only by an
  // explicit remove-password or a restore that brings back a plaintext vault.
  // While set, the store refuses to write plaintext vault/notes/vectors even
  // if vault.json has vanished (quarantined, deleted, mid-sync) — otherwise
  // the next save would quietly start a fresh UNENCRYPTED vault.
  private encryptionMarkerFile(): string {
    return path.join(this.paths.configDir, "encryption-expected.json");
  }

  encryptionExpected(): boolean {
    try {
      return fs.existsSync(this.encryptionMarkerFile());
    } catch {
      return true;
    }
  }

  private setEncryptionExpected(on: boolean): void {
    const f = this.encryptionMarkerFile();
    try {
      if (on && !fs.existsSync(f)) {
        atomicWrite(f, JSON.stringify({ version: 1, since: new Date().toISOString() }));
      } else if (!on && fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    } catch {}
  }

  private refusePlaintextWrite(label: string): void {
    if (this.encryptionExpected()) {
      throw new Error(
        `Refusing to write ${label} unencrypted: this vault was encrypted but vault.json is missing or unreadable. Restore it from Settings → Emergency Plan, or set a master password again.`
      );
    }
  }

  isLocked(): boolean {
    return this.isEncryptionEnabled() && !this.encryptionKey;
  }

  /**
   * True when no vault file exists yet — a brand-new installation where the
   * user has saved nothing. This is the state in which master-password setup
   * is MANDATORY (encrypted-by-default onboarding); an existing plaintext
   * vault is instead surfaced as a migration recommendation.
   */
  isFreshVault(): boolean {
    try {
      return !fs.existsSync(this.paths.vaultFile);
    } catch {
      return false;
    }
  }

  // ── Key-state operations are serialized ──────────────────────────────────
  // unlock / setupPassword / removePassword each await a memory-hard KDF.
  // Run concurrently (double-click, two windows) they used to interleave:
  // two setups left the vault encrypted under password A with key B in
  // memory (audit M-3). One queue, one operation at a time.
  private keyOpChain: Promise<unknown> = Promise.resolve();
  // Bumped by every lock(); an unlock that started before a lock must not
  // re-install its key after the lock happened.
  private lockEpoch = 0;

  private exclusive<T>(op: () => Promise<T>): Promise<T> {
    const run = this.keyOpChain.then(op, op);
    this.keyOpChain = run.catch(() => {});
    return run;
  }

  unlock(password: string): Promise<boolean> {
    return this.exclusive(() => this.unlockImpl(password));
  }

  setupPassword(password: string): Promise<void> {
    return this.exclusive(() => this.setupPasswordImpl(password));
  }

  removePassword(password: string): Promise<boolean> {
    return this.exclusive(() => this.removePasswordImpl(password));
  }

  /** Re-key everything under a new password. False when `oldPassword` is wrong. */
  changePassword(oldPassword: string, newPassword: string): Promise<boolean> {
    return this.exclusive(async () => {
      const verified = await this.verifiedKey(oldPassword);
      if (!verified) return false;
      this.installKey(verified.key, verified.header);
      const newSalt = generateSalt();
      await this.rekeyTo(await deriveKeyAsync(newPassword, newSalt), newSalt);
      addLog("SECURITY", "Master password changed — every file and record re-encrypted under the new key.");
      return true;
    });
  }

  /**
   * Forgotten password: open the vault key with the recovery code, then
   * re-key under `newPassword`. Throws with a user-facing message on failure.
   */
  recoverWithCode(code: string, newPassword: string): Promise<void> {
    return this.exclusive(async () => {
      this.completeInterruptedCommit();
      const header = readJsonStrict<any>(this.paths.vaultFile, null);
      if (!header?.encrypted) throw new Error("This vault has no master password — nothing to recover.");
      const rec = readJsonStrict<any>(this.paths.recoveryFile, null);
      if (!rec?.sealed) throw new Error("No recovery key was set up for this vault.");
      const key = openWithRecoveryCode(rec.sealed, code);
      try {
        openEnvelope(header, key, "vault");
      } catch {
        key.fill(0);
        throw new Error("This recovery key is out of date for this vault (it was replaced or the vault was restored from an older copy).");
      }
      this.installKey(key, header);
      try {
        await this.reconcileDbKey("", header);
      } catch {}
      this.maybeMigrateToV2();
      const newSalt = generateSalt();
      await this.rekeyTo(await deriveKeyAsync(newPassword, newSalt), newSalt);
      addLog("SECURITY", "Vault opened with the recovery key; master password reset.");
    });
  }

  /** Derive and check a password against vault.json; null when wrong. */
  private async verifiedKey(password: string): Promise<{ key: Buffer; header: any } | null> {
    this.completeInterruptedCommit();
    const header = readJsonStrict<any>(this.paths.vaultFile, null);
    if (!header?.encrypted) throw new Error("This vault has no master password.");
    const key = await deriveKeyAsync(password, header.salt, kdfFromEnvelope(header));
    try {
      openEnvelope(header, key, "vault");
      return { key, header };
    } catch {
      key.fill(0);
      return null;
    }
  }

  private installKey(key: Buffer, header: any): void {
    if (this.encryptionKey && this.encryptionKey !== key) {
      try {
        this.encryptionKey.fill(0);
      } catch {}
    }
    this.encryptionKey = key;
    this.encryptionSaltHex = header.salt;
    this.encryptionKdf = kdfFromEnvelope(header);
    this.clearCache();
  }

  /**
   * Re-encrypt every file and record under `newKey` (new salt, current KDF).
   * Files are staged and committed as one set (commitStagedWrites). v2 rows
   * are rewritten AFTER that commit; until then the db keeps the old key
   * sealed under the new one (meta prev_key), so a crash in between is
   * repaired at the next unlock with the NEW password (reconcileDbKey).
   */
  private async rekeyTo(newKey: Buffer, newSalt: string): Promise<void> {
    if (!this.encryptionKey) throw new Error("Vault is locked");
    const v2 = this.isV2();
    const vault = this.readVault();
    let vectors: VectorsFile = { version: VECTOR_SCHEMA, chunks: [] };
    try {
      vectors = this.readVectors();
    } catch {}
    const companions = [this.paths.scratchpadFile, this.paths.scratchpadArchiveFile, this.paths.noteRevisionsFile, this.paths.scanSessionsFile].map(
      (f) => [f, this.readProtectedJson<any>(f, null)] as const
    );
    const old = { key: this.encryptionKey, salt: this.encryptionSaltHex, kdf: this.encryptionKdf };
    const db = v2 ? this.db() : null;
    if (db) {
      const prev = encryptString(old.key.toString("hex"), newKey, PREV_KEY_AAD);
      db.tx(() => db.setMeta("prev_key", JSON.stringify(prev)));
    }
    this.encryptionKey = newKey;
    this.encryptionSaltHex = newSalt;
    this.encryptionKdf = currentKdf();
    this.stagedWrites = new Map();
    try {
      if (v2) this.writeHeaderV2();
      else {
        this.writeVault(vault);
        this.writeVectors(vectors);
      }
      for (const [file, obj] of companions) if (obj) this.writeProtectedJson(file, obj);
      this.commitStagedWrites(this.stagedWrites);
    } catch (e) {
      this.stagedWrites = null;
      if (fs.existsSync(this.commitMarkerFile())) {
        try {
          this.completeInterruptedCommit();
        } catch {
          this.lock();
          throw e;
        }
      } else {
        this.encryptionKey = old.key;
        this.encryptionSaltHex = old.salt;
        this.encryptionKdf = old.kdf;
        try {
          db?.tx(() => db.deleteMeta("prev_key"));
        } catch {}
        newKey.fill(0);
        this.clearCache();
        throw e;
      }
    } finally {
      this.stagedWrites = null;
    }
    // Header committed under the new key: now the rows (clears prev_key).
    if (v2) this.writeDbTables(vault.entries, vectors.chunks);
    try {
      old.key.fill(0);
    } catch {}
    this.clearCache();
    this.refreshRecoverySeal();
    // CLI token digests were keyed from the old vault key.
    revokeAllCliTokens(this.paths.cliTokensFile);
    this.touchEmergencySnapshot();
  }

  /** Digest for CLI tokens, keyed from the vault key; null while locked. */
  cliDigester(): Digester | null {
    if (this.isLocked()) return null;
    return cliDigester(this.encryptionKey);
  }

  // ── Recovery key ─────────────────────────────────────────────────────────
  // data/recovery.json = { public key, the CURRENT vault key sealed to it }.
  // Resealed after every key change; the private half (the recovery code)
  // is shown to the user once and never stored. See server/recovery.ts.

  recoveryStatus(): { enabled: boolean; current: boolean; created_at: string | null } {
    const rec = readJsonStrict<any>(this.paths.recoveryFile, null);
    if (!rec?.public_key) return { enabled: false, current: false, created_at: null };
    const header = readJsonStrict<any>(this.paths.vaultFile, null);
    let current = false;
    try {
      current = !!header?.encrypted && rec.key_salt === header.salt && rec.key_kdf === kdfKey(kdfFromEnvelope(header));
    } catch {}
    return { enabled: true, current, created_at: rec.created_at || null };
  }

  /** New recovery key (replaces any previous one). Returns the code — show once. */
  createRecoveryKey(): string {
    if (!this.isEncryptionEnabled()) throw new Error("Set a master password first.");
    if (!this.encryptionKey) throw new Error("Vault is locked");
    const { code, publicKey } = generateRecoveryKey();
    this.writeRecoverySeal(publicKey, new Date().toISOString());
    addLog("SECURITY", "Recovery key created (any previous recovery key no longer works).");
    return code;
  }

  removeRecoveryKey(): void {
    if (this.isLocked()) throw new Error("Vault is locked");
    try {
      fs.unlinkSync(this.paths.recoveryFile);
      addLog("SECURITY", "Recovery key removed.");
    } catch {}
  }

  private writeRecoverySeal(publicKey: string, createdAt: string): void {
    if (!this.encryptionKey || !this.encryptionSaltHex) return;
    atomicWrite(
      this.paths.recoveryFile,
      JSON.stringify(
        {
          version: 1,
          alg: RECOVERY_ALG,
          created_at: createdAt,
          public_key: publicKey,
          key_salt: this.encryptionSaltHex,
          key_kdf: kdfKey(this.keyKdf()),
          sealed: sealToRecoveryKey(this.encryptionKey, publicKey),
        },
        null,
        2
      )
    );
  }

  /** Keep the sealed copy on the current key (after re-key, KDF upgrade, unlock). */
  private refreshRecoverySeal(): void {
    try {
      const rec = readJsonStrict<any>(this.paths.recoveryFile, null);
      if (!rec?.public_key || !this.encryptionKey) return;
      if (rec.key_salt === this.encryptionSaltHex && rec.sealed) {
        // Same salt can still mean a new key (KDF upgrade): check it opens.
        if (rec.key_kdf === kdfKey(this.keyKdf())) return;
      }
      this.writeRecoverySeal(rec.public_key, rec.created_at || new Date().toISOString());
    } catch (e: any) {
      addLog("SECURITY", `Recovery key could not be refreshed (${e?.message}) — create a new one in Settings.`);
    }
  }

  private async unlockImpl(password: string): Promise<boolean> {
    this.completeInterruptedCommit();
    const epoch = this.lockEpoch;
    // Fresh install: no vault file → nothing to unlock (LockScreen passes).
    if (!fs.existsSync(this.paths.vaultFile)) return true;
    // An unparseable vault is QUARANTINED by readJsonOrQuarantine (original
    // preserved as *.corrupt-*). Fail CLOSED (RESIDUAL-2): a corrupt vault
    // must not "unlock" into an empty plaintext one that the next write
    // would happily replace. Recovery runs through the Emergency Plan.
    let raw: any;
    try {
      raw = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
    } catch (e: any) {
      addLog("SECURITY", `Vault file could not be read (${e?.code || e?.message}) — unlock refused, nothing changed. Try again.`);
      return false;
    }
    if (raw === null) {
      addLog("SECURITY", "Vault file unreadable (quarantined as *.corrupt-*) — unlock refused. Restore from Settings → Emergency Plan.");
      return false;
    }
    if (!raw.encrypted) {
      return true;
    }
    try {
      const kdf = kdfFromEnvelope(raw);
      const key = await deriveKeyAsync(password, raw.salt, kdf);
      const decrypted = openEnvelope(raw, key, "vault");
      JSON.parse(decrypted); // Verify valid JSON
      if (epoch !== this.lockEpoch) {
        // Locked (auto-lock, minimize) while the KDF ran: honour the lock.
        key.fill(0);
        addLog("SECURITY", "Unlock discarded: the vault was locked while it was in progress.");
        return false;
      }
      this.encryptionKey = key;
      this.encryptionSaltHex = raw.salt;
      this.encryptionKdf = kdf;
      // The locked period may have cached empty reads — drop them so the
      // freshly decrypted content is served.
      this._scratchpadCache = null;
      this._scratchpadArchiveCache = null;
      // Storage v2: bring rows in line with the header's key (crash recovery
      // for password operations), and move a v1 vault into SQLite.
      try {
        await this.reconcileDbKey(password, raw);
      } catch (e: any) {
        addLog("DATA", `vault.db key reconcile failed (${e?.message}) — rows stay as they are; reads will report the problem.`);
      }
      try {
        this.maybeMigrateToV2();
      } catch (e: any) {
        addLog("DATA", `Storage upgrade to SQLite failed (${e?.message}) — the JSON vault stays in use. Retried on next unlock.`);
      }
      // Transparent KDF migration: a legacy (or weaker-parameter) envelope is
      // re-encrypted with the current Argon2id parameters on successful
      // unlock. The user never sees this — the same password simply derives
      // the stronger key and every file is rewritten under it.
      if (kdfNeedsUpgrade(kdf)) {
        try {
          await this.upgradeKdf(password, raw.salt);
        } catch {
          // Migration is best-effort: the unlock itself succeeded, and the
          // next unlock will retry (or roll forward) the upgrade. If the
          // upgrade had to lock to stay consistent, report that honestly.
          if (!this.encryptionKey) return false;
        }
      }
      // Bind each vault file to its role (AAD). A KDF upgrade above already
      // rewrote everything bound, which makes this a no-op.
      try {
        this.maybeBindFileAad();
      } catch (e: any) {
        addLog("DATA", `Binding vault files to their roles failed (${e?.message}) — files stay as they are. Retried on next unlock.`);
      }
      this.applyRowSumCheck();
      // Verified knowledge of the master password — end the encryption grace
      // period if its window has elapsed (staged plaintext copies are then
      // finally deleted; see stagePlaintextArtifactsForGrace).
      this.maybeClearEncryptionGrace();
      this.refreshRecoverySeal();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Re-keys the vault and every protected companion file with a key derived
   * from the CURRENT KDF standard. Called from unlock() when the on-disk
   * envelope predates it. `oldKey` state is already installed by the caller;
   * this method reads everything (decrypting with that key), derives the new
   * key, and rewrites all envelopes atomically.
   */
  private async upgradeKdf(password: string, saltHex: string): Promise<void> {
    // Read EVERYTHING under the old key first, as raw file objects (no save
    // methods: those re-read from disk and would see the half-upgraded set).
    const vault = this.readVault();
    let vectors: VectorsFile = { version: VECTOR_SCHEMA, chunks: [] };
    try {
      vectors = this.readVectors();
    } catch {}
    const companions = [
      this.paths.scratchpadFile,
      this.paths.scratchpadArchiveFile,
      this.paths.noteRevisionsFile,
      this.paths.scanSessionsFile,
    ].map((f) => [f, this.readProtectedJson<any>(f, null)] as const);

    const oldKey = this.encryptionKey;
    const newKey = await deriveKeyAsync(password, saltHex);
    // Same salt, stronger KDF — the derived key is unrelated to the old one,
    // so every envelope is rewritten under it. All writes are STAGED and then
    // committed as one set (see commitStagedWrites): a crash part-way can no
    // longer leave companion files under the old key (audit M-5).
    const oldKdf = this.encryptionKdf;
    this.encryptionKey = newKey;
    this.encryptionKdf = currentKdf();
    this.stagedWrites = new Map();
    try {
      this.writeVault(vault);
      this.writeVectors(vectors);
      for (const [file, obj] of companions) if (obj) this.writeProtectedJson(file, obj);
      this.commitStagedWrites(this.stagedWrites);
    } catch (e) {
      if (fs.existsSync(this.commitMarkerFile())) {
        // The commit point was passed: some files may already be under the
        // NEW key. Never fall back to the old key now — roll forward, or
        // lock (no key in memory, no writes) and let the next unlock finish.
        try {
          this.completeInterruptedCommit();
        } catch {
          this.lock();
          throw e;
        }
      } else {
        this.encryptionKey = oldKey;
        this.encryptionKdf = oldKdf;
        // v2 rows were rewritten immediately (only file writes are staged):
        // put them back under the old key so this session keeps working.
        if (this.isV2()) {
          this.stagedWrites = null;
          try {
            this.writeDbTables(vault.entries, vectors.chunks);
          } catch {}
        }
        try {
          newKey.fill(0);
        } catch {}
        throw e;
      }
    } finally {
      this.stagedWrites = null;
      this.clearCache();
    }
    try {
      oldKey?.fill(0);
    } catch {}
    addLog("SYSTEM", "Vault re-keyed with current KDF standard (Argon2id) — envelopes upgraded.");
    this.refreshRecoverySeal();
    revokeAllCliTokens(this.paths.cliTokensFile);
    this.touchEmergencySnapshot();
  }

  // ── Staged multi-file commits (KDF upgrade) ─────────────────────────────
  // While stagedWrites is set, persist() collects writes instead of applying
  // them. commitStagedWrites then: fsyncs every file to a temp, records the
  // plan in a marker, renames the set into place, removes the marker. A crash
  // after the marker is written is ROLLED FORWARD on the next unlock
  // (completeInterruptedCommit); a crash before it leaves the old set intact.
  private stagedWrites: Map<string, string | Buffer> | null = null;

  private persist(file: string, data: string | Buffer): void {
    if (this.stagedWrites) this.stagedWrites.set(file, data);
    else atomicWrite(file, data);
  }

  private commitMarkerFile(): string {
    return path.join(this.paths.dataDir, "commit-in-progress.json");
  }

  private commitStagedWrites(writes: Map<string, string | Buffer>): void {
    const plan: Array<{ tmp: string; target: string }> = [];
    try {
      for (const [target, data] of writes) {
        const tmp = path.join(path.dirname(target), `.${path.basename(target)}.commit.tmp`);
        plan.push({ tmp, target });
        const fd = fs.openSync(tmp, "w");
        try {
          fs.writeFileSync(fd, data);
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch (e) {
      // Before the commit point: discard the staged temps, live set untouched.
      for (const { tmp } of plan) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
      throw e;
    }
    atomicWrite(this.commitMarkerFile(), JSON.stringify({ version: 1, files: plan }));
    this.completeInterruptedCommit();
  }

  /** Roll a recorded multi-file commit forward. Safe to call any time. */
  completeInterruptedCommit(): void {
    const marker = this.commitMarkerFile();
    let plan: Array<{ tmp: string; target: string }> = [];
    try {
      if (!fs.existsSync(marker)) return;
      plan = JSON.parse(fs.readFileSync(marker, "utf-8")).files || [];
    } catch {
      return; // unreadable marker: leave everything for manual inspection
    }
    for (const { tmp, target } of plan) {
      if (fs.existsSync(tmp)) withIoRetry(target, () => fs.renameSync(tmp, target));
      this.recordIntegrity(target);
    }
    fsyncDir(this.paths.dataDir);
    fs.unlinkSync(marker);
  }

  lock(): void {
    // Zeroize the derived key material before dropping the reference — a
    // locked vault must not keep raw AES keys on the heap.
    try {
      this.encryptionKey?.fill(0);
    } catch {}
    this.encryptionKey = null;
    this.encryptionSaltHex = null;
    this.lockEpoch++;
    // Purge ALL decrypted caches — entries, settings (API keys), folders,
    // notes. A locked vault serves nothing from memory.
    this.clearCache();
  }

  private async setupPasswordImpl(password: string): Promise<void> {
    if (this.isEncryptionEnabled()) {
      throw new Error("Vault is already encrypted. Remove the current password first.");
    }
    try {
      fs.unlinkSync(this.paths.recoveryFile);
    } catch {}
    revokeAllCliTokens(this.paths.cliTokensFile);
    const salt = generateSalt();
    const key = await deriveKeyAsync(password, salt);
    this.encryptionKey = key;
    this.encryptionSaltHex = salt;
    this.encryptionKdf = currentKdf();

    const vault = this.readVault();
    let vectors: VectorsFile = { version: VECTOR_SCHEMA, chunks: [] };
    try {
      vectors = this.readVectors();
    } catch {
      // ignore
    }

    this.writeVault(vault);
    this.writeVectors(vectors);
    if (this.isV2() && this.db().exists()) {
      try {
        this.db().compact(); // freed plaintext pages are rewritten away
      } catch {}
    }

    // Eagerly pull the companion files into the encrypted envelope (they were
    // plaintext until this point).
    try { this.saveScratchpad(this.getScratchpad(), { force: true }); } catch {}
    try { this.saveScratchpadArchive(this.getScratchpadArchive()); } catch {}
    try {
      const revs = this.readProtectedJson<any>(this.paths.noteRevisionsFile, {
        version: 1,
        revisions: {},
      });
      this.writeProtectedJson(this.paths.noteRevisionsFile, revs);
    } catch {}
    try { this.writeSessions(this.listScanSessions()); } catch {}
    // The vault is now encrypted at rest — every PLAINTEXT copy that existed
    // a moment ago is a liability, but destroying the only recovery path in
    // the same operation that changes credentials is how a hostile or
    // fumbled setup turns into permanent data loss (the "one-call ransom").
    // Industrial pattern: stage the old recovery copies into a grace area
    // and delete them only after the new state is VERIFIED (successful
    // unlock ≥24h later). See clearPlaintextGrace / SECURITY.md.
    this.setEncryptionExpected(true);
    this.stagePlaintextArtifactsForGrace();
    // Synchronous (not debounced): the moment encryption turns on is the
    // moment a ciphertext snapshot must exist, before anything else happens.
    this.flushEmergencySnapshot();
  }

  // ── Encryption grace period (ransom recoverability) ──────────────────────
  // Plaintext-era backups/snapshots are MOVED (not deleted) to
  // backups/plaintext-grace/ when encryption turns on, and deleted only once
  // the vault has been successfully unlocked after the grace window. Honest
  // scope: a one-shot hostile call cannot complete a ransom (the grace copies
  // survive it and Emergency Plan restores from them); a token-holding
  // attacker with sustained access can still finish the job by waiting out
  // the window and unlocking with their own password — but that attacker can
  // already read every secret, so lockout adds nothing for them.
  private static readonly GRACE_MS = 24 * 60 * 60 * 1000;

  private graceDir(): string {
    return path.join(this.paths.backupsDir, "plaintext-grace");
  }

  /** Snapshots staged into the grace area live here (restorable via name). */
  private graceSnapshotDir(): string {
    return path.join(this.graceDir(), "emergency");
  }

  private graceMarkerFile(): string {
    return path.join(this.paths.configDir, "encrypt-grace.json");
  }

  private moveIntoGrace(from: string, toDir: string): boolean {
    try {
      fs.mkdirSync(toDir, { recursive: true });
      let dest = path.join(toDir, path.basename(from));
      let n = 1;
      while (fs.existsSync(dest)) {
        dest = path.join(toDir, `${path.basename(from)}.${n++}`);
      }
      try {
        fs.renameSync(from, dest);
      } catch {
        // Cross-device fallback: copy then unlink.
        fs.copyFileSync(from, dest);
        fs.unlinkSync(from);
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Move every at-rest artifact that still holds plaintext secret data
   * (timestamped backups, unencrypted emergency snapshots, .prev rollbacks)
   * into backups/plaintext-grace/ and record the grace marker. Replaces the
   * old delete-in-place purge, which irreversibly destroyed the recovery
   * path at the same moment encryption was (possibly hostilely) enabled.
   */
  private stagePlaintextArtifactsForGrace(): void {
    const graceDir = this.graceDir();
    let stagedBackups = 0;
    let stagedSnapshots = 0;
    let stagedPrev = 0;

    const isPlaintextJson = (file: string): boolean => {
      try {
        const raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
        return !raw?.encrypted;
      } catch {
        return false; // unreadable ≠ plaintext; never touch what we can't classify
      }
    };

    // Timestamped backup sets (vault-/vectors-/…/settings-*.json — settings
    // backups hold API keys) and stray .prev copies. The grace dir itself
    // carries no .json/.prev suffix at the top level, so it is skipped.
    try {
      for (const f of fs.readdirSync(this.paths.backupsDir)) {
        const full = path.join(this.paths.backupsDir, f);
        if (/\.plain\.sqlite$/.test(f)) {
          if (this.moveIntoGrace(full, graceDir)) stagedBackups++;
          continue;
        }
        if (!/\.(json|prev)$/.test(f)) continue;
        if (isPlaintextJson(full) && this.moveIntoGrace(full, graceDir)) stagedBackups++;
      }
    } catch {}

    // Unencrypted emergency snapshots, across ALL redundant locations.
    const graceSnapDir = this.graceSnapshotDir();
    for (const dir of this.emergencyDirs()) {
      try {
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".iabak")) continue;
          const full = path.join(dir, f);
          try {
            const parsed = JSON.parse(fs.readFileSync(full, "utf8"));
            if (!parsed?.encrypted && this.moveIntoGrace(full, graceSnapDir)) stagedSnapshots++;
          } catch {}
        }
      } catch {}
    }

    // .prev rollback copies from the plaintext era.
    for (const file of [this.paths.scratchpadFile + ".prev", this.paths.scratchpadArchiveFile + ".prev"]) {
      try {
        if (fs.existsSync(file) && isPlaintextJson(file) && this.moveIntoGrace(file, graceDir)) stagedPrev++;
      } catch {}
    }

    try {
      fs.mkdirSync(path.dirname(this.graceMarkerFile()), { recursive: true });
      fs.writeFileSync(
        this.graceMarkerFile(),
        JSON.stringify(
          {
            created_at: new Date().toISOString(),
            vault_salt: this.encryptionSaltHex,
            staged: { backups: stagedBackups, snapshots: stagedSnapshots, prev: stagedPrev },
          },
          null,
          2
        )
      );
    } catch {}

    if (stagedBackups || stagedSnapshots || stagedPrev) {
      addLog(
        "SECURITY",
        `Encryption grace: moved ${stagedBackups} backup(s), ${stagedSnapshots} snapshot(s), ${stagedPrev} rollback copy(ies) to backups/plaintext-grace/. They are deleted only after the vault is next unlocked ≥24h after encryption (ransom-recovery window — see SECURITY.md).`
      );
    }
  }

  /** Delete the grace area + marker. Only called on VERIFIED unlock (see below). */
  private clearPlaintextGrace(reason: string): void {
    try {
      if (!fs.existsSync(this.graceMarkerFile())) return;
      let staged = 0;
      try {
        for (const _ of fs.readdirSync(this.graceDir())) staged++;
      } catch {}
      fs.rmSync(this.graceDir(), { recursive: true, force: true });
      fs.unlinkSync(this.graceMarkerFile());
      addLog("SECURITY", `Encryption grace period ended (${reason}) — removed ${staged} staged plaintext artifact(s).`);
    } catch {}
  }

  /**
   * End the grace period only when BOTH hold: the vault was successfully
   * unlocked with the master password AND the grace window has elapsed.
   * The window is what stops a hostile setup→unlock sequence from clearing
   * its own recovery copies in one sitting.
   */
  private maybeClearEncryptionGrace(): void {
    try {
      const markerPath = this.graceMarkerFile();
      if (!fs.existsSync(markerPath)) return;
      const marker = JSON.parse(fs.readFileSync(markerPath, "utf8"));
      const setAt = Date.parse(marker?.created_at || "") || 0;
      if (Date.now() - setAt >= VaultStore.GRACE_MS) {
        this.clearPlaintextGrace("vault unlocked after the 24h window");
      }
    } catch {}
  }

  private async removePasswordImpl(password: string): Promise<boolean> {
    if (!this.isEncryptionEnabled()) {
      return true;
    }
    let key: Buffer | null = null;
    try {
      const raw = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
      const kdf = kdfFromEnvelope(raw);
      key = await deriveKeyAsync(password, raw.salt, kdf);
      const decryptedVault = openEnvelope(raw, key, "vault");
      const vault = JSON.parse(decryptedVault) as VaultFile;

      let vectors: VectorsFile = { version: VECTOR_SCHEMA, chunks: [] };
      try {
        const rawVectors = readJsonOrQuarantine<any>(this.paths.vectorsFile, null, "vectors.json");
        if (rawVectors && rawVectors.encrypted) {
          const decryptedVectors = openEnvelope(rawVectors, key, "vectors", raw.aad !== undefined);
          vectors = JSON.parse(decryptedVectors) as VectorsFile;
        } else if (rawVectors) {
          vectors = rawVectors;
        }
      } catch {
        // ignore
      }

      // Read companion files while the key is still available, then rewrite
      // them as plaintext alongside the decrypted vault. Install the verified
      // key first: when called on a LOCKED vault the readers would otherwise
      // see "locked → looks empty" and the plaintext rewrite below would
      // replace every note with nothing.
      if (this.encryptionKey && this.encryptionKey !== key) {
        try {
          this.encryptionKey.fill(0);
        } catch {}
      }
      this.encryptionKey = key;
      this.encryptionSaltHex = raw.salt;
      this.encryptionKdf = kdf;
      const scratch = this.getScratchpad();
      const archive = this.getScratchpadArchive();
      const revs = this.readProtectedJson<any>(this.paths.noteRevisionsFile, {
        version: 1,
        revisions: {},
      });
      const sessions = this.readSessions();
      // v2 rows are decrypted now, while the key is still live.
      const v2 = this.isV2(raw);
      const plainRows =
        v2 && this.db().exists()
          ? RECORD_TABLES.map((table) => [table, this.db().all(table).map((r) => [r, this.openRow(table, r, key)] as const)] as const)
          : null;

      try {
        this.encryptionKey?.fill(0);
      } catch {}
      this.encryptionKey = null;
      this.encryptionSaltHex = null;
      // Explicit, password-verified decryption: plaintext is now intended.
      this.setEncryptionExpected(false);

      if (plainRows) {
        // Rows first, header second: a crash in between leaves an encrypted
        // header over plaintext rows, which the next unlock re-encrypts.
        const db = this.db();
        db.tx(() => {
          for (const [table, rows] of plainRows) {
            db.replaceAll(table, rows.map(([r, obj]) => this.sealRow(table, r.id, r.entry_id, obj, null)));
          }
          this.writeKeyState();
        });
      }
      atomicWrite(this.paths.vaultFile, JSON.stringify(v2 ? { version: 2, storage: STORAGE_V2, entries: [] } : vault, null, 2));
      if (!v2) atomicWrite(this.paths.vectorsFile, JSON.stringify(vectors));
      atomicWrite(this.paths.scratchpadFile, JSON.stringify({ version: 2, tabs: scratch }, null, 2));
      atomicWrite(this.paths.scratchpadArchiveFile, JSON.stringify({ version: 1, tabs: archive }, null, 2));
      atomicWrite(this.paths.noteRevisionsFile, JSON.stringify(revs, null, 2));
      atomicWrite(this.paths.scanSessionsFile, JSON.stringify({ version: 1, sessions }, null, 2));
      for (const f of [this.paths.vaultFile, this.paths.vectorsFile, this.paths.scratchpadFile, this.paths.scratchpadArchiveFile, this.paths.noteRevisionsFile, this.paths.scanSessionsFile]) {
        this.recordIntegrity(f);
      }
      this._scratchpadCache = null;
      this._scratchpadArchiveCache = null;
      try {
        fs.unlinkSync(this.paths.recoveryFile);
      } catch {}
      revokeAllCliTokens(this.paths.cliTokensFile);
      this.touchEmergencySnapshot();
      return true;
    } catch (e: any) {
      addLog("SECURITY", `Remove password failed (${e?.message || e}) — nothing was decrypted on disk.`);
      return false;
    } finally {
      try {
        key?.fill(0);
      } catch {}
    }
  }

  // --- Settings ---
  // API keys are wrapped at rest with an OS-keychain-bound key
  // (INDEXARC_SETTINGS_KEY, provisioned by Electron safeStorage/DPAPI) so a
  // settings.json copied off this user profile yields nothing. Without the
  // key (dev/standalone), keys stay plaintext with a one-time warning.
  private static SECRET_SETTING_FIELDS = [
    "gemini_api_key",
    "openai_api_key",
    "groq_api_key",
    "openrouter_api_key",
    "anthropic_api_key",
    "local_openai_api_key",
  ] as const;

  private settingsKeyBuf(): Buffer | null {
    const b64 = process.env.INDEXARC_SETTINGS_KEY;
    if (!b64) return null;
    try {
      const k = Buffer.from(b64, "base64");
      return k.length === 32 ? k : null;
    } catch {
      return null;
    }
  }

  private wrapSettingSecret(value: unknown): unknown {
    if (typeof value !== "string" || value === "" || value.startsWith("enc:v1:")) return value;
    const key = this.settingsKeyBuf();
    if (!key) return value;
    return "enc:v1:" + JSON.stringify(envelopePayload(value, key, crypto.randomBytes(16).toString("hex"), 1));
  }

  private unwrapSettingSecret(value: unknown): unknown {
    if (typeof value !== "string" || !value.startsWith("enc:v1:")) return value;
    const key = this.settingsKeyBuf();
    if (!key) return ""; // ciphertext we can no longer unwrap — never leak the blob
    try {
      const env = JSON.parse(value.slice(7));
      return decryptString(env.ciphertext, key, env.iv, env.authTag);
    } catch {
      return "";
    }
  }

  /** Settings for a diagnostics bundle: every secret field → configured flag. */
  getSettingsForDiagnostics(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    let s: Record<string, unknown> = {};
    try {
      s = this.getSettings() as unknown as Record<string, unknown>;
    } catch {}
    const secret = new Set<string>(VaultStore.SECRET_SETTING_FIELDS as readonly string[]);
    for (const [k, v] of Object.entries(s)) out[k] = secret.has(k) || /key|token|secret|password/i.test(k) ? { configured: !!v } : v;
    return out;
  }

  getSettings(): AppSettings {
    if (this._settingsCache) return this._settingsCache;
    const raw = readJsonOrQuarantine<Partial<AppSettings>>(this.paths.settingsFile, {}, "settings.json");
    // Prefer env keys if settings keys are empty
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...raw };
    for (const f of VaultStore.SECRET_SETTING_FIELDS) {
      const v = (raw as Record<string, unknown>)[f];
      if (typeof v === "string" && v.startsWith("enc:v1:")) {
        (settings as unknown as Record<string, unknown>)[f] = this.unwrapSettingSecret(v);
      }
    }
    if (!settings.gemini_api_key && process.env.GEMINI_API_KEY) {
      settings.gemini_api_key = process.env.GEMINI_API_KEY;
    }
    if (!settings.openai_api_key && process.env.OPENAI_API_KEY) {
      settings.openai_api_key = process.env.OPENAI_API_KEY;
    }
    if (!settings.groq_api_key && process.env.GROQ_API_KEY) {
      settings.groq_api_key = process.env.GROQ_API_KEY;
    }
    if (!settings.openrouter_api_key && process.env.OPENROUTER_API_KEY) {
      settings.openrouter_api_key = process.env.OPENROUTER_API_KEY;
    }
    if (!settings.anthropic_api_key && process.env.ANTHROPIC_API_KEY) {
      settings.anthropic_api_key = process.env.ANTHROPIC_API_KEY;
    }
    // LOCAL_OPENAI_API_KEY lets the key live in .env instead of settings.json
    // (same pattern as the cloud providers — secrets belong outside
    // copyable config files).
    if (!settings.local_openai_api_key && process.env.LOCAL_OPENAI_API_KEY) {
      settings.local_openai_api_key = process.env.LOCAL_OPENAI_API_KEY;
    }
    this._settingsCache = settings;
    return settings;
  }

  saveSettings(partial: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...partial };
    // At-rest form: secret fields wrapped under the OS-bound key; the
    // in-memory cache keeps decrypted values for this process only.
    const atRest: Record<string, unknown> = { ...next };
    if (this.settingsKeyBuf()) {
      for (const f of VaultStore.SECRET_SETTING_FIELDS) {
        atRest[f] = this.wrapSettingSecret((next as Record<string, unknown>)[f]);
      }
    }
    // A wrapped key this process cannot open (portable copy on another
    // PC/user, keychain reset) reads back as "". Saving that "" would destroy
    // the only copy of the key — keep the on-disk blob unless the caller
    // explicitly set that field in this save.
    const onDisk = readJson<Record<string, unknown>>(this.paths.settingsFile, {});
    for (const f of VaultStore.SECRET_SETTING_FIELDS) {
      const blob = onDisk[f];
      if (Object.prototype.hasOwnProperty.call(partial, f)) continue;
      if (typeof blob === "string" && blob.startsWith("enc:v1:") && this.unwrapSettingSecret(blob) === "") {
        atRest[f] = blob;
      }
    }
    atomicWrite(this.paths.settingsFile, JSON.stringify(atRest, null, 2));
    // Re-baseline the integrity manifest — without this, every legitimate
    // settings save tripped "settings.json changed unexpectedly" on the next
    // startup (a false corruption warning).
    this.recordIntegrity(this.paths.settingsFile);
    this._settingsCache = null;
    this.touchEmergencySnapshot();
    return next;
  }

  /** True when settings.json holds plaintext API keys while a wrap key exists. */
  settingsNeedsSecretMigration(): boolean {
    if (!this.settingsKeyBuf()) return false;
    try {
      const raw = readJsonOrQuarantine<Record<string, unknown>>(this.paths.settingsFile, {}, "settings.json");
      return VaultStore.SECRET_SETTING_FIELDS.some(
        (f) => typeof raw[f] === "string" && (raw[f] as string) !== "" && !(raw[f] as string).startsWith("enc:v1:")
      );
    } catch {
      return false;
    }
  }

  // --- Vault ---
  // ── Storage v2: SQLite records (R3.2) ──────────────────────────────────
  private db(): RecordDb {
    if (!this._db) {
      this._db = new RecordDb(this.paths.vaultDbFile);
      // Evaluated at use time, so a key switch (re-key, lock) is always seen.
      this._db.rowMacProvider = () => this.rowMac();
    }
    return this._db;
  }

  /** v2 when vault.json says so, or when there is no vault yet. */
  private isV2(header: any = readJsonStrict<any>(this.paths.vaultFile, null)): boolean {
    return !header || header.storage === STORAGE_V2;
  }

  private _rowMacCache: { key: Buffer; mac: (table: RecordTable, id: string, tag: Buffer) => Buffer } | null = null;

  /** Keyed MAC for the row checksum (RecordDb "rowsum"); null without a key. */
  private rowMac(): ((table: RecordTable, id: string, tag: Buffer) => Buffer) | null {
    const key = this.encryptionKey;
    if (!key) return null;
    if (this._rowMacCache?.key !== key) {
      const k = Buffer.from(crypto.hkdfSync("sha256", key, Buffer.alloc(0), "indexarc:rowsum:v1", 32));
      this._rowMacCache = { key, mac: (table, id, tag) => crypto.createHmac("sha256", k).update(`${table} ${id} `).update(tag).digest() };
    }
    return this._rowMacCache.mac;
  }

  /**
   * Compare the row checksum with the rows on disk. null when there is
   * nothing to check (no key, no database, plaintext rows). A database from
   * before the checksum gets one now (trust on first use).
   */
  private checkRowSum(): string | null {
    if (!this.encryptionKey || !this.isV2()) return null;
    const db = this.db();
    if (!db.exists()) return null;
    const stored = db.getMeta("rowsum");
    const actual = db.computeRowSum();
    if (!actual) return null;
    if (stored === null) {
      let expected = false;
      try {
        const raw = readJsonStrict<any>(this.paths.vaultFile, null);
        expected = JSON.parse(openEnvelope(raw, this.encryptionKey, "vault")).rowsum === 1;
      } catch {}
      if (!expected) {
        // Trust on first use, then record in the header that it exists.
        db.tx(() => db.setMeta("rowsum", actual.toString("hex")));
        this.writeHeaderV2();
        return null;
      }
    } else if (stored.length === 64 && crypto.timingSafeEqual(Buffer.from(stored, "hex"), actual)) return null;
    return "vault.db records changed outside IndexArc: a record was rolled back to an older copy, removed, or copied in from another copy of the vault. Check your entries; restore from Settings → Emergency Plan if something is missing or old.";
  }

  private static aad(table: RecordTable, id: string): string {
    return `indexarc:v2:${table}:${id}`;
  }

  /** Seal one record. `key` null = plaintext row (unencrypted vault only). */
  private sealRow(table: RecordTable, id: string, entryId: string, obj: unknown, key: Buffer | null = this.encryptionKey): RecordRow {
    const json = JSON.stringify(obj);
    if (key) {
      const e = encryptString(json, key, VaultStore.aad(table, id));
      return { id, entry_id: entryId, iv: Buffer.from(e.iv, "hex"), tag: Buffer.from(e.authTag, "hex"), body: Buffer.from(e.ciphertext, "hex") };
    }
    this.refusePlaintextWrite(table === "entries" ? "vault entries" : "vectors");
    return { id, entry_id: entryId, iv: null, tag: null, body: Buffer.from(json, "utf8") };
  }

  private openRow<T>(table: RecordTable, row: RecordRow, key: Buffer | null = this.encryptionKey): T {
    if (row.iv && row.tag) {
      if (!key) throw new Error("Vault is locked");
      const text = decryptString(row.body.toString("hex"), key, row.iv.toString("hex"), row.tag.toString("hex"), VaultStore.aad(table, row.id));
      return JSON.parse(text) as T;
    }
    return JSON.parse(row.body.toString("utf8")) as T;
  }

  /** Record which key the rows are sealed under (inside the caller's tx). */
  private writeKeyState(): void {
    const db = this.db();
    db.deleteMeta("prev_key");
    if (this.encryptionKey) {
      db.setMeta("enc", "1");
      db.setMeta("salt", this.encryptionSaltHex || readJsonStrict<any>(this.paths.vaultFile, null)?.salt || "");
      db.setMeta("kdf", JSON.stringify(this.keyKdf()));
    } else {
      db.setMeta("enc", "0");
      db.deleteMeta("salt");
      db.deleteMeta("kdf");
    }
  }

  /** Small vault.json header: KDF + salt + an encrypted key check. */
  private writeHeaderV2(): void {
    // rowsum: vault.db keeps a row checksum (meta "rowsum"). Recorded in the
    // encrypted header so that deleting the meta row is not mistaken for a
    // vault from before the checksum.
    const body = { version: 2, storage: STORAGE_V2, entries: [] as VaultEntry[], ...(this.encryptionKey ? { rowsum: 1 } : {}) };
    const rawDisk = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
    if ((rawDisk && rawDisk.encrypted) || this.encryptionKey) {
      if (!this.encryptionKey) throw new Error("Vault is locked");
      const salt = this.encryptionSaltHex || rawDisk?.salt || generateSalt();
      const env = envelopePayload(JSON.stringify(body), this.encryptionKey, salt, 2, this.keyKdf(), this.headerRole());
      this.persist(this.paths.vaultFile, JSON.stringify({ ...env, storage: STORAGE_V2 }, null, 2));
    } else {
      this.refusePlaintextWrite("vault.json");
      this.persist(this.paths.vaultFile, JSON.stringify(body, null, 2));
    }
    this.recordIntegrity(this.paths.vaultFile);
  }

  /** Replace both tables under the current key, in one transaction. */
  private writeDbTables(entries: VaultEntry[] | null, chunks: VectorChunk[] | null): void {
    const db = this.db();
    db.tx(() => {
      if (entries) db.replaceAll("entries", entries.map((e) => this.sealRow("entries", e.id, e.id, e)));
      if (chunks) db.replaceAll("vectors", chunks.map((c) => this.sealRow("vectors", c.id, c.entry_id, packChunk(c))));
      this.writeKeyState();
    });
    if (entries) this._entriesCache = null;
    if (chunks) this._vectorsCache = null;
  }

  /** One row-level change: checks lock state, creates the header if needed. */
  private rowWrite(fn: (db: RecordDb) => void): void {
    const header = readJsonStrict<any>(this.paths.vaultFile, null);
    if (header?.encrypted && !this.encryptionKey) throw new Error("Vault is locked");
    if (!header) this.writeHeaderV2();
    const db = this.db();
    db.tx(() => {
      if (db.getMeta("enc") === null) this.writeKeyState();
      fn(db);
    });
    this.touchEmergencySnapshot();
  }

  /**
   * After unlock: if rows are sealed under a different key than the header
   * (a password operation crashed half-way) or are still plaintext under an
   * encrypted header, re-seal them under the header's key.
   */
  private async reconcileDbKey(password: string, header: any): Promise<void> {
    if (!this.isV2(header) || !header?.encrypted || !this.encryptionKey) return;
    const db = this.db();
    if (!db.exists()) return;
    const enc = db.getMeta("enc");
    const hdrKdf = kdfFromEnvelope(header);
    const metaKdf = db.getMeta("kdf");
    // Both sides through kdfFromEnvelope: it normalises the params (drops
    // derived fields such as hashLength), so equal KDFs compare equal.
    if (enc === "1" && db.getMeta("salt") === header.salt && metaKdf && kdfKey(JSON.parse(metaKdf)) === kdfKey(hdrKdf)) {
      // A re-key that never committed its header leaves prev_key behind.
      if (db.getMeta("prev_key") !== null) db.deleteMeta("prev_key");
      return;
    }
    let rowKey: Buffer | null = null;
    // A committed re-key (new password) left the old key sealed under the
    // header key; otherwise the rows are under the same password with other
    // KDF params / salt (KDF upgrade) and the old key is re-derived.
    const prev = db.getMeta("prev_key");
    if (prev) {
      try {
        const p = JSON.parse(prev);
        rowKey = Buffer.from(decryptString(p.ciphertext, this.encryptionKey, p.iv, p.authTag, PREV_KEY_AAD), "hex");
      } catch {}
    }
    if (!rowKey && enc === "1" && metaKdf) rowKey = await deriveKeyAsync(password, db.getMeta("salt") || "", kdfFromEnvelope({ kdf: JSON.parse(metaKdf) }));
    try {
      db.tx(() => {
        for (const table of RECORD_TABLES) {
          const rows = db.all(table).map((r) => this.sealRow(table, r.id, r.entry_id, this.openRow(table, r, rowKey ?? this.encryptionKey)));
          db.replaceAll(table, rows);
        }
        this.writeKeyState();
      });
    } finally {
      rowKey?.fill(0);
    }
    if (enc !== "1") {
      try {
        db.compact();
      } catch {}
    }
    this._entriesCache = null;
    this._vectorsCache = null;
    addLog("DATA", `vault.db rows re-sealed under the current key (${enc === "1" ? "interrupted re-key" : "plaintext rows under an encrypted header"}).`);
  }

  /** Move a v1 (JSON) vault into SQLite. Needs the key when encrypted. */
  private maybeMigrateToV2(): void {
    const header = readJsonStrict<any>(this.paths.vaultFile, null);
    if (!header) return;
    if (this.isV2(header)) {
      // Leftover from a migration interrupted after the header switched.
      if (fs.existsSync(this.paths.vectorsFile)) {
        try {
          fs.unlinkSync(this.paths.vectorsFile);
        } catch {}
      }
      return;
    }
    if (header.encrypted && !this.encryptionKey) return;
    const v1 = this.readVaultV1();
    let chunks: VectorChunk[] = [];
    try {
      chunks = this.readVectorsV1().chunks;
    } catch {}
    // Rollback path: a full snapshot of the v1 files, taken before anything
    // changes (restorable from Settings → Emergency Plan).
    try {
      this.flushEmergencySnapshot();
    } catch {}
    this.writeDbTables(v1.entries, chunks);
    this.writeHeaderV2();
    try {
      fs.unlinkSync(this.paths.vectorsFile);
    } catch {}
    this.clearCache();
    addLog("DATA", `Storage upgraded to SQLite (data/vault.db): ${v1.entries.length} entries, ${chunks.length} vectors. A snapshot of the previous files was taken first.`);
  }

  private readVault(): VaultFile {
    if (this._entriesCache) return { version: 1, entries: this._entriesCache };
    const header = readJsonStrict<any>(this.paths.vaultFile, null);
    if (!this.isV2(header) && (!header.encrypted || this.encryptionKey)) this.maybeMigrateToV2();
    if (this.isV2()) {
      const h = readJsonStrict<any>(this.paths.vaultFile, null);
      if (h?.encrypted && !this.encryptionKey) throw new Error("Vault is locked");
      const db = this.db();
      let entries: VaultEntry[] = [];
      // Header gone but sealed rows present (quarantined, mid-sync): nothing
      // can be decrypted, so read as empty — writes are refused separately
      // by refusePlaintextWrite. Not cached.
      if (!h && !this.encryptionKey && db.exists() && db.getMeta("enc") === "1") return { version: 1, entries: [] };
      if (db.exists()) {
        try {
          entries = db.all("entries").map((r) => this.openRow<VaultEntry>("entries", r));
        } catch (e: any) {
          if (e?.message === "Vault is locked") throw e;
          throw new Error("Failed to decrypt vault: incorrect key or corrupted record");
        }
      }
      entries.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      this._entriesCache = entries;
      return { version: 1, entries };
    }
    return this.readVaultV1();
  }

  /** The original JSON-file reader (v1 vaults, and migration input). */
  private readVaultV1(): VaultFile {
    const raw = readJsonStrict<any>(this.paths.vaultFile, { version: 1, entries: [] });
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      try {
        const decrypted = openEnvelope(raw, this.encryptionKey, "vault");
        const vault = JSON.parse(decrypted) as VaultFile;
        this._entriesCache = vault.entries;
        return vault;
      } catch (e: any) {
        throw new Error("Failed to decrypt vault: incorrect key or corrupted file");
      }
    }
    this._entriesCache = (raw as VaultFile).entries;
    return raw as VaultFile;
  }

  private writeVault(vault: VaultFile) {
    if (this.isV2()) {
      const disk = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
      if (disk?.encrypted && !this.encryptionKey) throw new Error("Vault is locked");
      // Turning encryption on: header first, so a crash leaves an encrypted
      // header over plaintext rows (re-sealed at the next unlock), never
      // encrypted rows behind a header that says "unencrypted".
      const encrypting = !!this.encryptionKey && !disk?.encrypted;
      if (encrypting) this.writeHeaderV2();
      this.writeDbTables(vault.entries, null);
      if (!encrypting) this.writeHeaderV2();
      this.touchEmergencySnapshot();
      return;
    }
    const rawDisk = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
    const isDiskEncrypted = rawDisk && rawDisk.encrypted;

    if (isDiskEncrypted || this.encryptionKey) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      // The stored salt MUST be the one the key was derived from.
      const salt = this.encryptionSaltHex || rawDisk?.salt || generateSalt();
      const text = JSON.stringify(vault, null, 2);
      this.persist(this.paths.vaultFile, JSON.stringify(envelopePayload(text, this.encryptionKey, salt, 1, this.keyKdf(), this.headerRole()), null, 2));
    } else {
      this.refusePlaintextWrite("vault.json");
      this.persist(this.paths.vaultFile, JSON.stringify(vault, null, 2));
    }
    // Only after the write succeeded — a failed write must not invalidate
    // the cache and silently resurrect the previous disk state.
    this._entriesCache = null;
    this.recordIntegrity(this.paths.vaultFile);
    this.touchEmergencySnapshot();
  }

  listEntries(filter?: { status?: EntryStatus | EntryStatus[]; family?: string }): VaultEntry[] {
    let entries = this.readVault().entries;
    if (filter?.status) {
      const statuses = Array.isArray(filter.status) ? filter.status : [filter.status];
      entries = entries.filter((e) => statuses.includes(e.status));
    }
    if (filter?.family) {
      entries = entries.filter((e) => e.family === filter.family);
    }
    return entries.sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    );
  }

  getEntry(id: string): VaultEntry | undefined {
    return this.readVault().entries.find((e) => e.id === id);
  }

  getNeedsAttention(): VaultEntry[] {
    return this.listEntries({
      status: ["needs_name", "needs_type", "needs_review"],
    });
  }

  createEntry(
    data: Omit<VaultEntry, "id" | "created_at" | "updated_at">
  ): VaultEntry {
    const vault = this.readVault();
    const now = new Date().toISOString();
    const entry: VaultEntry = {
      ...data,
      id: randomUUID(),
      created_at: now,
      updated_at: now,
    };
    if (this.isV2()) {
      this.rowWrite((db) => db.put("entries", this.sealRow("entries", entry.id, entry.id, entry)));
      if (this._entriesCache) this._entriesCache.unshift(entry);
      return entry;
    }
    vault.entries.unshift(entry);
    this.writeVault(vault);
    return entry;
  }

  updateEntry(id: string, patch: Partial<VaultEntry>): VaultEntry | null {
    const vault = this.readVault();
    const idx = vault.entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    const next: VaultEntry = {
      ...vault.entries[idx],
      ...patch,
      id: vault.entries[idx].id,
      created_at: vault.entries[idx].created_at,
      updated_at: new Date().toISOString(),
    };
    if (this.isV2()) {
      this.rowWrite((db) => db.put("entries", this.sealRow("entries", next.id, next.id, next)));
      if (this._entriesCache) {
        const i = this._entriesCache.findIndex((e) => e.id === id);
        if (i >= 0) this._entriesCache[i] = next;
      }
      return next;
    }
    vault.entries[idx] = next;
    this.writeVault(vault);
    return vault.entries[idx];
  }

  deleteEntry(id: string): boolean {
    const vault = this.readVault();
    if (this.isV2()) {
      const existed = vault.entries.some((e) => e.id === id);
      this.rowWrite((db) => {
        db.delete("entries", id);
        db.deleteByEntry("vectors", id);
      });
      if (this._entriesCache) this._entriesCache = this._entriesCache.filter((e) => e.id !== id);
      if (this._vectorsCache) this._vectorsCache = this._vectorsCache.filter((c) => c.entry_id !== id);
      return existed;
    }
    const before = vault.entries.length;
    vault.entries = vault.entries.filter((e) => e.id !== id);
    this.writeVault(vault);
    this.removeVectorsForEntry(id);
    return vault.entries.length < before;
  }

  bulkDeleteEntries(ids: string[]): number {
    const idSet = new Set(ids);
    const vault = this.readVault();
    if (this.isV2()) {
      const removed = vault.entries.filter((e) => idSet.has(e.id)).length;
      this.rowWrite((db) => {
        for (const id of idSet) {
          db.delete("entries", id);
          db.deleteByEntry("vectors", id);
        }
      });
      if (this._entriesCache) this._entriesCache = this._entriesCache.filter((e) => !idSet.has(e.id));
      if (this._vectorsCache) this._vectorsCache = this._vectorsCache.filter((c) => !idSet.has(c.entry_id));
      return removed;
    }
    const before = vault.entries.length;
    vault.entries = vault.entries.filter((e) => !idSet.has(e.id));
    const removed = before - vault.entries.length;
    this.writeVault(vault);
    const v = this.readVectors();
    v.chunks = v.chunks.filter((c) => !idSet.has(c.entry_id));
    this.writeVectors(v);
    return removed;
  }

  stats() {
    const entries = this.readVault().entries;
    const needs = entries.filter((e) =>
      ["needs_name", "needs_type", "needs_review"].includes(e.status)
    );
    return {
      total_saved: entries.filter((e) => e.status === "saved").length,
      needs_attention: needs.length,
      total_commands: entries.filter((e) => e.family === "command").length,
      total_notes: entries.filter((e) => e.family === "note").length,
      // Count only the "secret" family so this matches the Library "Secrets &
      // Keys" filter exactly (unknown-family entries live under "Unidentified").
      total_secrets: entries.filter((e) => e.family === "secret").length,
      total_unknown: entries.filter((e) => e.family === "unknown").length,
      total: entries.length,
    };
  }

  // --- Vectors ---
  private readVectors(): VectorsFile {
    const header = readJsonStrict<any>(this.paths.vaultFile, null);
    if (!this.isV2(header) && (!header.encrypted || this.encryptionKey)) this.maybeMigrateToV2();
    if (this.isV2()) {
      if (this._vectorsCache) return { version: VECTOR_SCHEMA, chunks: this._vectorsCache };
      const h = readJsonStrict<any>(this.paths.vaultFile, null);
      if (h?.encrypted && !this.encryptionKey) throw new Error("Vault is locked");
      const db = this.db();
      let chunks: VectorChunk[] = [];
      if (!h && !this.encryptionKey && db.exists() && db.getMeta("enc") === "1") return { version: VECTOR_SCHEMA, chunks: [] };
      if (db.exists()) {
        try {
          chunks = db.all("vectors").map((r) => unpackChunk(this.openRow<any>("vectors", r)));
        } catch (e: any) {
          if (e?.message === "Vault is locked") throw e;
          throw new Error("Failed to decrypt vectors");
        }
      }
      this._vectorsCache = chunks;
      return { version: VECTOR_SCHEMA, chunks };
    }
    return this.readVectorsV1();
  }

  private readVectorsV1(): VectorsFile {
    const parse = (raw: any): VectorsFile => {
      if (!raw || typeof raw !== "object" || raw.version !== VECTOR_SCHEMA || !Array.isArray(raw.chunks)) {
        if (raw && Array.isArray(raw.chunks) && raw.chunks.length) {
          addLog("DATA", `Legacy vector index dropped (${raw.chunks.length} chunk(s) embedded from secret-bearing text) — entries re-embed on next save.`);
        }
        return { version: VECTOR_SCHEMA, chunks: [] };
      }
      return raw as VectorsFile;
    };
    const raw = readJsonOrQuarantine<any>(this.paths.vectorsFile, null, "vectors.json");
    if (!raw) return { version: VECTOR_SCHEMA, chunks: [] };
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      try {
        const decrypted = openEnvelope(raw, this.encryptionKey, "vectors", this.headerAadBound());
        return parse(JSON.parse(decrypted));
      } catch (e: any) {
        throw new Error("Failed to decrypt vectors");
      }
    }
    return parse(raw);
  }

  private writeVectors(v: VectorsFile) {
    if (this.isV2()) {
      const disk = readJsonStrict<any>(this.paths.vaultFile, null);
      if (disk?.encrypted && !this.encryptionKey) throw new Error("Vault is locked");
      this.writeDbTables(null, v.chunks);
      return;
    }
    const rawDisk = readJsonOrQuarantine<any>(this.paths.vectorsFile, null, "vectors.json");
    const isDiskEncrypted = rawDisk && rawDisk.encrypted;

    if (isDiskEncrypted || this.encryptionKey) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      const salt = this.encryptionSaltHex || rawDisk?.salt || generateSalt();
      const text = JSON.stringify(v);
      this.persist(this.paths.vectorsFile, JSON.stringify(envelopePayload(text, this.encryptionKey, salt, 1, this.keyKdf(), "vectors")));
    } else {
      this.refusePlaintextWrite("vectors.json");
      this.persist(this.paths.vectorsFile, JSON.stringify(v));
    }
    this.recordIntegrity(this.paths.vectorsFile);
  }

  upsertVector(chunk: VectorChunk) {
    if (this.isV2()) {
      this.rowWrite((db) => {
        db.deleteByEntry("vectors", chunk.entry_id);
        db.delete("vectors", chunk.id);
        db.put("vectors", this.sealRow("vectors", chunk.id, chunk.entry_id, packChunk(chunk)));
      });
      if (this._vectorsCache) {
        this._vectorsCache = this._vectorsCache.filter((c) => c.id !== chunk.id && c.entry_id !== chunk.entry_id);
        this._vectorsCache.push(chunk);
      }
      return;
    }
    const v = this.readVectors();
    v.chunks = v.chunks.filter((c) => c.id !== chunk.id && c.entry_id !== chunk.entry_id);
    v.chunks.push(chunk);
    this.writeVectors(v);
  }

  removeVectorsForEntry(entryId: string) {
    if (this.isV2()) {
      this.rowWrite((db) => db.deleteByEntry("vectors", entryId));
      if (this._vectorsCache) this._vectorsCache = this._vectorsCache.filter((c) => c.entry_id !== entryId);
      return;
    }
    const v = this.readVectors();
    v.chunks = v.chunks.filter((c) => c.entry_id !== entryId);
    this.writeVectors(v);
  }

  allVectors(): VectorChunk[] {
    return this.readVectors().chunks;
  }

  getRoot() {
    return this.paths.root;
  }

  // --- Vault-key encryption for scratchpad companion files ---
  // Same envelope as vault.json ({encrypted, salt, iv, authTag, ciphertext}).
  // Plaintext scratchpad files were the biggest at-rest leak: notes are where
  // users paste secrets, yet they sat outside the encrypted vault.
  /**
   * True once vault.json ON DISK is bound to its role (file AAD). From then on
   * every encrypted companion file must be bound too: an unbound or mis-bound
   * file is refused instead of silently accepted. Read from disk, not from a
   * flag, so staged-but-uncommitted header writes do not count.
   */
  private headerAadBound(): boolean {
    let st: fs.Stats;
    try {
      st = fs.statSync(this.paths.vaultFile);
    } catch {
      return false;
    }
    const stamp = `${st.mtimeMs}:${st.size}`;
    if (this._headerBoundCache?.stamp === stamp) return this._headerBoundCache.bound;
    const h = readJsonStrict<any>(this.paths.vaultFile, null);
    const bound = !!h?.encrypted && h.aad !== undefined;
    this._headerBoundCache = { stamp, bound };
    return bound;
  }

  /**
   * Role for the next vault.json write: "vault" (bound) only when every
   * encrypted companion on disk is already bound, because a bound header
   * makes the store refuse unbound companions. Until then the header is
   * written unbound and maybeBindFileAad finishes the job at unlock.
   */
  private headerRole(): string | undefined {
    if (this.headerAadBound()) return "vault";
    const files = [this.paths.scratchpadFile, this.paths.scratchpadArchiveFile, this.paths.noteRevisionsFile, this.paths.scanSessionsFile];
    if (!this.isV2()) files.push(this.paths.vectorsFile);
    for (const f of files) {
      // A staged (not yet committed) write counts as what will be on disk.
      const staged = this.stagedWrites?.get(f);
      let raw: any;
      try {
        raw = staged !== undefined ? JSON.parse(staged.toString()) : readJsonStrict<any>(f, null);
      } catch {
        return undefined;
      }
      if (raw?.encrypted && raw.aad === undefined) return undefined;
    }
    return "vault";
  }

  /** AAD role of a companion file: its name, e.g. "scratchpad". */
  private static fileRole(file: string): string {
    return path.basename(file, ".json");
  }

  /**
   * One-time upgrade of a vault written before file AAD existed: re-encrypt
   * each encrypted companion file bound to its role, then the header LAST.
   * Until the header is rewritten, unbound files are still accepted, so a
   * crash part-way leaves a vault that opens and finishes on the next unlock.
   */
  private maybeBindFileAad(): void {
    if (!this.encryptionKey) return;
    const header = readJsonStrict<any>(this.paths.vaultFile, null);
    if (!header?.encrypted || header.aad !== undefined) return;
    for (const f of [this.paths.scratchpadFile, this.paths.scratchpadArchiveFile, this.paths.noteRevisionsFile, this.paths.scanSessionsFile]) {
      const raw = readJsonStrict<any>(f, null);
      if (raw?.encrypted && raw.aad === undefined) this.writeProtectedJson(f, this.readProtectedJson<unknown>(f, null));
    }
    if (this.isV2(header)) {
      this.writeHeaderV2();
    } else {
      const rv = readJsonStrict<any>(this.paths.vectorsFile, null);
      if (rv?.encrypted && rv.aad === undefined) this.writeVectors(this.readVectors());
      this.writeVault(this.readVaultV1());
    }
    this.clearCache();
    addLog("SECURITY", "Vault files bound to their roles (AAD): a file copied over another is now refused.");
  }

  private writeProtectedJson(file: string, obj: unknown): void {
    const rawDisk = readJsonStrict<any>(file, null);
    const isDiskEncrypted = !!(rawDisk && rawDisk.encrypted);
    if (isDiskEncrypted || this.encryptionKey) {
      if (!this.encryptionKey) {
        // Locked: refuse rather than write plaintext over ciphertext.
        throw new Error("Vault is locked");
      }
      const salt =
        this.encryptionSaltHex ||
        rawDisk?.salt ||
        readJsonStrict<any>(this.paths.vaultFile, null)?.salt ||
        generateSalt();
      this.persist(file, JSON.stringify(envelopePayload(JSON.stringify(obj), this.encryptionKey, salt, 2, this.keyKdf(), VaultStore.fileRole(file)), null, 2));
    } else {
      this.refusePlaintextWrite(path.basename(file));
      this.persist(file, JSON.stringify(obj, null, 2));
    }
    this.recordIntegrity(file);
    this.touchEmergencySnapshot();
  }

  private readProtectedJson<T>(file: string, fallback: T): T {
    const raw = readJsonOrQuarantine<any>(file, null, path.basename(file));
    if (!raw) return fallback;
    if (raw.encrypted) {
      if (!this.encryptionKey) return fallback; // locked → looks empty
      try {
        return JSON.parse(openEnvelope(raw, this.encryptionKey, VaultStore.fileRole(file), this.headerAadBound())) as T;
      } catch {
        // Wrong key for this file (e.g. a KDF upgrade interrupted halfway).
        // Returning the empty fallback used to let the next save overwrite
        // the only copy (audit M-5). Keep a copy and fail loudly instead.
        this.preserveUndecryptable(file);
        throw new Error(`${path.basename(file)} cannot be decrypted with the current key — a copy was preserved; restore from Settings → Emergency Plan`);
      }
    }
    return raw as T;
  }

  private preserveUndecryptable(file: string): void {
    try {
      const dir = path.dirname(file);
      const base = path.basename(file);
      if (fs.readdirSync(dir).some((f) => f.startsWith(`${base}.undecryptable-`))) return; // one copy is enough
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(file, `${file}.undecryptable-${stamp}`);
      addLog("DATA", `${base} could not be decrypted — preserved as ${base}.undecryptable-${stamp}`);
    } catch {}
  }

  // --- Integrity manifest (tamper/bit-rot EVIDENCE, not protection) ---
  // The HMAC key lives next to the data on the same disk, so this detects
  // accidental corruption/overwrite — it cannot stop someone who can write
  // to data/. Honest scope: recovery aid, not a security boundary.
  private _integrityWarnings: string[] = [];
  private _integrityKeyBuf: Buffer | null = null;

  private integrityKey(): Buffer {
    if (!this._integrityKeyBuf) {
      try {
        if (fs.existsSync(this.paths.manifestKeyFile)) {
          this._integrityKeyBuf = Buffer.from(fs.readFileSync(this.paths.manifestKeyFile, "utf-8"), "hex");
        }
      } catch {}
      if (!this._integrityKeyBuf || this._integrityKeyBuf.length < 32) {
        this._integrityKeyBuf = crypto.randomBytes(32);
        try {
          fs.mkdirSync(path.dirname(this.paths.manifestKeyFile), { recursive: true });
          fs.writeFileSync(this.paths.manifestKeyFile, this._integrityKeyBuf.toString("hex"), "utf-8");
        } catch {}
      }
    }
    return this._integrityKeyBuf;
  }

  private computeMac(file: string): string {
    return crypto.createHmac("sha256", this.integrityKey()).update(fs.readFileSync(file)).digest("hex");
  }

  private recordIntegrity(file: string): void {
    try {
      if (!fs.existsSync(file)) return;
      const raw = readJson<{ hmacs: Record<string, string> }>(this.paths.manifestFile, { hmacs: {} });
      const macs = raw.hmacs || {};
      macs[path.basename(file)] = this.computeMac(file);
      atomicWrite(this.paths.manifestFile, JSON.stringify({ version: 1, hmacs: macs }, null, 2));
    } catch {}
  }

  /** Compare tracked files against the manifest; returns human-readable warnings. */
  verifyIntegrity(): string[] {
    const warnings: string[] = [];
    try {
      const tracked = [
        this.paths.vaultFile,
        this.paths.vectorsFile,
        this.paths.scratchpadFile,
        this.paths.scratchpadArchiveFile,
        this.paths.noteRevisionsFile,
        this.paths.settingsFile,
      ];
      const stored = readJson<{ hmacs: Record<string, string> }>(this.paths.manifestFile, { hmacs: {} }).hmacs || {};
      const macs: Record<string, string> = {};
      for (const f of tracked) {
        if (!fs.existsSync(f)) continue;
        const name = path.basename(f);
        const mac = this.computeMac(f);
        macs[name] = mac;
        if (stored[name] && stored[name] !== mac) {
          warnings.push(`${name} changed since IndexArc last wrote it (unexpected modification or corruption).`);
        }
      }
      atomicWrite(this.paths.manifestFile, JSON.stringify({ version: 1, hmacs: macs }, null, 2));
    } catch {}
    this._integrityWarnings = warnings;
    this.applyRowSumCheck();
    return this._integrityWarnings;
  }

  private static readonly ROWSUM_WARNING_PREFIX = "vault.db records changed";

  /** Run the row checksum (needs the key) and keep its warning in the list. */
  private applyRowSumCheck(): void {
    let w: string | null = null;
    try {
      w = this.checkRowSum();
    } catch (e: any) {
      addLog("DATA", `Row checksum check failed to run: ${e?.message}`);
    }
    const rest = this._integrityWarnings.filter((x) => !x.startsWith(VaultStore.ROWSUM_WARNING_PREFIX));
    if (w) {
      addLog("SECURITY", w);
      rest.push(w);
    }
    this._integrityWarnings = rest;
  }

  getIntegrityWarnings(): string[] {
    return this._integrityWarnings;
  }

  // --- Scratchpad tabs (portable, survives reinstall/update) ---
  getScratchpad(): any[] {
    if (this._scratchpadCache) return this._scratchpadCache;
    const raw = this.readProtectedJson<{ tabs: any[] }>(this.paths.scratchpadFile, { tabs: [] }).tabs;
    const all = Array.isArray(raw) ? raw : [];

    // MIGRATION / PURGE: If scratchpad.json has archived tabs, migrate them
    // immediately to scratchpad_archive.json so scratchpad.json stays lightweight.
    const hasArchived = all.some((t: any) => !!t.archived);
    if (hasArchived) {
      const active = all.filter((t: any) => !t.archived);
      const toArchive = all.filter((t: any) => !!t.archived);
      
      const existingArchive = this.getScratchpadArchive();
      const existingIds = new Set(existingArchive.map((x: any) => x.id));
      const mergedArchive = [
        ...toArchive.map((t: any) => ({ ...t, archived: true, archivedAt: t.archivedAt || Date.now() })),
        ...existingArchive.filter((x: any) => !existingIds.has(x.id)),
      ];
      this.saveScratchpadArchive(mergedArchive);
      this.saveScratchpad(active, { force: true });
      this._scratchpadCache = active;
      return active;
    }

    const active = all.filter((t: any) => !t.archived);
    this._scratchpadCache = active;
    return active;
  }

  // Side-effect-free read of the durable active tabs (no migration, no cache).
  // Used by saveScratchpad so metadata enrichment can't recurse into the
  // getScratchpad migration path (which itself saves).
  private readScratchpadRaw(): any[] {
    const raw = this.readProtectedJson<any>(this.paths.scratchpadFile, { tabs: [] });
    const all = Array.isArray(raw) ? raw : Array.isArray(raw?.tabs) ? raw.tabs : [];
    return all.filter((t: any) => t && !t.archived);
  }

  /**
   * Public READ-ONLY view of the active tabs for authorization-style checks
   * (e.g. the AI protected-note guard). Unlike getScratchpad(), this never
   * performs the archive-migration write and never populates the write-path
   * cache; a locked vault simply reads as empty.
   */
  peekScratchpadTabs(): any[] {
    if (this._scratchpadCache) return this._scratchpadCache;
    try {
      return this.readScratchpadRaw();
    } catch {
      return [];
    }
  }

  saveScratchpad(
    tabs: any[],
    opts: { force?: boolean; override_protected?: boolean } = {}
  ): any[] {
    const incoming = Array.isArray(tabs) ? tabs : [];
    // Ensure only unarchived tabs live in the active store
    const safe = incoming.filter((t: any) => !t.archived);

    // DATA-LOSS GUARD: never let an empty/partial save silently wipe existing
    // tabs. If the incoming set is empty but a non-empty file already exists,
    // refuse (unless explicitly forced, e.g. the user really deleted all tabs).
    if (safe.length === 0 && !opts.force) {
      const existing = this.readScratchpadRaw();
      if (existing.length > 0) {
        return existing;
      }
    }

    // Envelope v2: the server owns `created_at` / `updated_at` / `rev` per tab.
    // The rev increments whenever the server observes a content or title change
    // — it is the optimistic-concurrency token for saves (409 on mismatch).
    const prevById = new Map<any, any>(this.readScratchpadRaw().map((t: any) => [t.id, t]));

    // PROTECTION GUARD (server-enforced, defense in depth): a save that
    // modifies or omits a protected tab is rejected. `override_protected` is
    // set ONLY by the dedicated protect/unprotect flows — no generic endpoint
    // can pass it.
    if (!opts.override_protected) {
      const violations = this.findScratchpadProtectViolations(safe, prevById);
      if (violations.length) throw new ProtectedTabError(violations);
    }
    const nowIso = new Date().toISOString();
    const enriched = safe.map((t: any) => {
      const prev = prevById.get(t.id);
      const created_at =
        typeof t.created_at === "string" && t.created_at
          ? t.created_at
          : typeof prev?.created_at === "string" && prev.created_at
          ? prev.created_at
          : nowIso;
      const changed = !!prev && (prev.content !== t.content || prev.title !== t.title);
      const rev = changed
        ? (Number(prev?.rev) || 1) + 1
        : Number(t.rev) || Number(prev?.rev) || 1;
      const updated_at = changed
        ? nowIso
        : typeof t.updated_at === "string" && t.updated_at
        ? t.updated_at
        : typeof prev?.updated_at === "string" && prev.updated_at
        ? prev.updated_at
        : created_at;
      return { ...t, created_at, updated_at, rev };
    });

    // Keep a rolling one-step-back copy before every overwrite, so even a
    // forced/mistaken save can be undone.
    try {
      if (fs.existsSync(this.paths.scratchpadFile)) {
        const prev = fs.readFileSync(this.paths.scratchpadFile);
        if (prev.length > 0) {
          atomicWrite(this.paths.scratchpadFile + ".prev", prev);
        }
      }
    } catch {}

    // Cache only AFTER the write succeeded — the same invariant writeVault
    // documents: a failed write must not leave the cache holding state that
    // never reached disk (otherwise reads serve a phantom save).
    this.writeProtectedJson(this.paths.scratchpadFile, { version: 2, tabs: enriched });
    this._scratchpadCache = enriched;
    return enriched;
  }

  /**
   * Protection violations for a whole-array save: a protected tab that is
   * missing (deletion-by-omission) or whose content/title differs.
   */
  findScratchpadProtectViolations(incoming: any[], prevById?: Map<any, any>): string[] {
    const prev = prevById || new Map<any, any>(this.readScratchpadRaw().map((t: any) => [t.id, t]));
    const violations: string[] = [];
    for (const [id, p] of prev) {
      const next = (incoming || []).find((t: any) => t && t.id === id);
      if (p.protected) {
        // A protected note may not be omitted, mutated, or have its flag
        // stripped by a generic save (this exact hole once let a stale client
        // wipe the flags of every note in one whole-array write).
        if (!next || next.content !== p.content || next.title !== p.title || !next.protected) {
          violations.push(id);
          continue;
        }
      }
      // Pin flags are also route-only: a whole-array save may not flip them.
      if (next && !!next.pinned !== !!p.pinned) {
        violations.push(id);
      }
    }
    return violations;
  }

  /** Toggle protection. Returns the updated tab or null. */
  setScratchpadTabProtected(id: string, protect: boolean): any | null {
    const active = this.getScratchpad();
    const tab = active.find((t: any) => t.id === id);
    if (!tab) return null;
    const saved = this.saveScratchpad(
      active.map((t: any) =>
        t.id === id
          ? protect
            ? { ...t, protected: true, protected_at: Date.now() }
            : { ...t, protected: false, protected_at: undefined }
          : t
      ),
      { force: true, override_protected: true }
    );
    return saved.find((t: any) => t.id === id) || null;
  }

  /** Toggle pin. Pinning a protected note is allowed (ordering is not content). */
  setScratchpadTabPinned(id: string, pinned: boolean): any | null {
    const active = this.getScratchpad();
    const tab = active.find((t: any) => t.id === id);
    if (!tab) return null;
    const saved = this.saveScratchpad(
      active.map((t: any) =>
        t.id === id ? { ...t, pinned: !!pinned, pinned_at: pinned ? Date.now() : undefined } : t
      ),
      // Trusted internal flow: the dedicated /pin route is the only thing
      // allowed to change pin flags past the generic-save guard.
      { force: true, override_protected: true }
    );
    return saved.find((t: any) => t.id === id) || null;
  }

  /**
   * Verify a master password against the vault envelope WITHOUT changing lock
   * state. Used by the unprotect flow. Unencrypted vaults have no password to
   * check (the UNPROTECT confirm word is the only gate there).
   */
  async verifyMasterPassword(password: string): Promise<boolean> {
    const raw = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
    if (!raw || !raw.encrypted) return false;
    let key: Buffer | null = null;
    try {
      key = await deriveKeyAsync(password, raw.salt, kdfFromEnvelope(raw));
      openEnvelope(raw, key, "vault");
      return true;
    } catch {
      return false;
    } finally {
      key?.fill(0);
    }
  }

  // --- Granular scratchpad operations (PR-12) ---
  // Content/meta/delete/order are per-tab so one stale client can never
  // clobber unrelated notes (the whole-array POST is a compat path only).

  /** Update one tab's content. baseRev mismatch (and differing content) → conflict. */
  updateScratchpadTabContent(
    id: string,
    content: string,
    baseRev?: number,
    force = false,
    title?: unknown,
    app?: string,
    titleCustom = false
  ): { ok: boolean; conflict?: boolean; protected?: boolean; tab?: any } {
    const active = this.getScratchpad();
    const tab = active.find((t: any) => t.id === id);
    if (tab && tab.protected && !force) {
      return { ok: false, protected: true, tab };
    }
    if (!tab) {
      // Upsert: a brand-new tab created by a client (client-generated id).
      // The client's title travels with the content save — defaulting it to
      // "Scratch" made every newly created note lose its name the first time
      // the server's list replaced the client's (e.g. after an archive).
      const created = {
        id,
        title: (title && String(title)) || "Scratch",
        content,
        archived: false,
        ...(app ? { app } : {}),
        // The user named it before its first save (rename of an unsaved note).
        ...(titleCustom ? { title_custom: true } : {}),
      };
      const saved = this.saveScratchpad([...active, created], { force: true });
      return { ok: true, tab: saved.find((t: any) => t.id === id) };
    }
    if (Number.isFinite(baseRev as number) && (Number(tab.rev) || 1) > Number(baseRev) && tab.content !== content) {
      return { ok: false, conflict: true, tab };
    }
    const updated = active.map((t: any) => (t.id === id ? { ...t, content } : t));
    // `force` here is internal-only (never accepted from route bodies on
    // protected notes) and carries the override through the store guard.
    const saved = this.saveScratchpad(updated, { force: true, override_protected: force });
    return { ok: true, tab: saved.find((t: any) => t.id === id) };
  }

/** Link a note to an application (shared/apps.ts), or unlink it (undefined). Allowed on protected notes: it is not content. */
  setScratchpadTabApp(id: string, app: string | undefined): any | null {
    const active = this.getScratchpad();
    if (!active.some((t: any) => t.id === id)) return null;
    const saved = this.saveScratchpad(
      active.map((t: any) => {
        if (t.id !== id) return t;
        const { app: _old, ...rest } = t;
        return app ? { ...rest, app } : rest;
      }),
      { force: true }
    );
    return saved.find((t: any) => t.id === id) || null;
  }

  /** Move every active note of one application to another (application rename). */
  renameScratchpadApp(isFrom: (app: unknown) => boolean, to: string): number {
    const active = this.getScratchpad();
    let n = 0;
    const next = active.map((t: any) => {
      if (!isFrom(t.app) || t.app === to) return t;
      n++;
      return { ...t, app: to };
    });
    if (n) this.saveScratchpad(next, { force: true });
    return n;
  }

  renameScratchpadTab(id: string, title: string, opts: { automatic?: boolean } = {}): any | null {
    const active = this.getScratchpad();
    const target = active.find((t: any) => t.id === id);
    if (!target) return null;
    if (target.protected && target.title !== title) {
      throw new ProtectedTabError([id]);
    }
    // A first-line name must not overwrite a name the user typed, and must
    // not set the flag that freezes the title.
    if (opts.automatic && target.title_custom) return target;
    const title_custom = opts.automatic ? !!target.title_custom : true;
    const saved = this.saveScratchpad(
      active.map((t: any) => (t.id === id ? { ...t, title, title_custom } : t)),
      { force: true }
    );
    return saved.find((t: any) => t.id === id) || null;
  }

  deleteScratchpadTab(id: string): boolean | "protected" {
    const active = this.getScratchpad();
    const target = active.find((t: any) => t.id === id);
    if (!target) return false;
    if (target.protected) return "protected";
    this.saveScratchpad(active.filter((t: any) => t.id !== id), { force: true, override_protected: true });
    this.clearNoteRevisions(id);
    return true;
  }

  /** Reorder active tabs to match ids (unknown ids ignored, missing ids kept at the end). */
  reorderScratchpad(ids: string[]): any[] {
    const active = this.getScratchpad();
    const byId = new Map<any, any>(active.map((t: any) => [t.id, t]));
    const ordered = (Array.isArray(ids) ? ids : []).map((id: string) => byId.get(id)).filter(Boolean);
    const rest = active.filter((t: any) => !(ids || []).includes(t.id));
    return this.saveScratchpad([...ordered, ...rest], { force: true });
  }

  /**
   * Optimistic-concurrency check: given the client's tabs and the revs it
   * based its edits on, list tabs that were changed server-side since.
   * Used by POST /api/scratchpad to answer 409 before any write happens.
   */
  findScratchpadConflicts(tabs: any[], baseRevs: Record<string, number> | undefined): { id: string; base_rev: number; server_rev: number }[] {
    const conflicts: { id: string; base_rev: number; server_rev: number }[] = [];
    if (!baseRevs || typeof baseRevs !== "object") return conflicts;
    const serverTabs = this.getScratchpad();
    for (const t of tabs || []) {
      if (!t || typeof t !== "object" || !t.id) continue;
      const server = serverTabs.find((x: any) => x.id === t.id);
      if (!server) continue; // brand-new tab, nothing to conflict with
      const base = Number(baseRevs[t.id]);
      if (!Number.isFinite(base)) continue; // client doesn't track this tab
      const serverRev = Number(server.rev) || 1;
      if (serverRev > base && server.content !== t.content) {
        conflicts.push({ id: t.id, base_rev: base, server_rev: serverRev });
      }
    }
    return conflicts;
  }

  // --- Note revisions (server-side history — the client keeps no durable copy) ---
  getNoteRevisions(tabId: string): any[] {
    const raw = this.readProtectedJson<{ revisions: Record<string, any[]> }>(this.paths.noteRevisionsFile, {
      revisions: {},
    });
    const all = raw.revisions || {};
    return Array.isArray(all[tabId]) ? all[tabId] : [];
  }

  addNoteRevision(rev: any, maxKeep = 30): any[] {
    const tabId = String(rev?.tabId || "");
    if (!tabId) return [];
    const raw = this.readProtectedJson<{ revisions: Record<string, any[]> }>(this.paths.noteRevisionsFile, {
      revisions: {},
    });
    const all = raw.revisions || {};
    const existing: any[] = Array.isArray(all[tabId]) ? all[tabId] : [];
    if (existing.length > 0 && existing[0].content === rev.content) return existing;
    const updated = [rev, ...existing.filter((x) => x.content !== rev.content)].slice(0, maxKeep);
    all[tabId] = updated;
    this.writeProtectedJson(this.paths.noteRevisionsFile, { version: 1, revisions: all });
    return updated;
  }

  clearNoteRevisions(tabId: string): void {
    const raw = this.readProtectedJson<{ revisions: Record<string, any[]> }>(this.paths.noteRevisionsFile, {
      revisions: {},
    });
    const all = raw.revisions || {};
    if (!all[tabId]) return;
    delete all[tabId];
    this.writeProtectedJson(this.paths.noteRevisionsFile, { version: 1, revisions: all });
  }

  /**
   * Revision groups whose tab no longer exists. These survive when a note's
   * content saves never landed (server down/locked while the editor kept
   * typing — snapshots POST through a separate path) or a tab was removed
   * out from under live revisions. They are often the ONLY remaining copy
   * of a note the user believes was lost, newest snapshot first.
   */
  getOrphanedNoteRevisions(): Array<{
    tabId: string;
    title: string;
    timestamp: number;
    revisionCount: number;
    charCount: number;
    lastContent: string;
  }> {
    const raw = this.readProtectedJson<{ revisions: Record<string, any[]> }>(this.paths.noteRevisionsFile, {
      revisions: {},
    });
    const all = raw.revisions || {};
    // A revision group is only orphaned if NO tab owns it — active OR
    // archived. Archived notes keep their revision history (unarchive
    // restores it), and surfacing them here would offer "restoring" a note
    // that still exists as a duplicate.
    const tabIds = new Set(this.getScratchpad().map((t: any) => String(t.id)));
    for (const archived of this.getScratchpadArchive()) {
      tabIds.add(String((archived as any)?.id));
    }
    const out: Array<{
      tabId: string;
      title: string;
      timestamp: number;
      revisionCount: number;
      charCount: number;
      lastContent: string;
    }> = [];
    for (const [tabId, revs] of Object.entries(all)) {
      if (!Array.isArray(revs) || revs.length === 0) continue;
      if (tabIds.has(tabId)) continue;
      const latest = revs[0]; // addNoteRevision prepends newest
      out.push({
        tabId,
        title: String(latest?.title || "Note"),
        timestamp: Number(latest?.timestamp) || 0,
        revisionCount: revs.length,
        charCount: Number(latest?.charCount) || 0,
        lastContent: String(latest?.content ?? ""),
      });
    }
    return out.sort((a, b) => b.timestamp - a.timestamp);
  }

  // --- Scratchpad Archive (Passive Cold Storage) ---
  private _archiveBaseline: number | null = null;

  /**
   * Industrial guard: before any destructive archive write, snapshot the
   * current archive file to backups/ with a timestamp so a mistaken or
   * truncated write is always recoverable. Never throws — a failed guard
   * logswarns but does not block the write (the .prev rollback is the
   * hard backstop inside writeProtectedJson/saveScratchpadArchive).
   */
  private guardArchiveWrite(): void {
    try {
      if (!fs.existsSync(this.paths.scratchpadArchiveFile)) return;
      const cur = fs.readFileSync(this.paths.scratchpadArchiveFile);
      if (cur.length === 0) return;
      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .replace("Z", "");
      const dest = path.join(this.paths.backupsDir, `notes-archive-guard-${stamp}.json`);
      fs.mkdirSync(this.paths.backupsDir, { recursive: true });
      atomicWrite(dest, cur);
      addLog("DATA", `Pre-write archive guard snapshot → ${path.basename(dest)}`);
    } catch (e: any) {
      addLog("DATA", `Archive guard snapshot failed: ${e?.message || e}`);
    }
  }

  /**
   * Record the archive count as the baseline on first read. Any later
   * unexpected decrease is flagged by verifyArchiveIntegrity().
   */
  private setArchiveBaseline(count: number): void {
    if (this._archiveBaseline === null) {
      this._archiveBaseline = count;
    }
  }

  /**
   * Compare the current archive count against the baseline. Returns a
   * human-readable warning if the count has dropped (possible data loss),
   * or null if everything is consistent.
   */
  verifyArchiveIntegrity(): string | null {
    const current = this.getScratchpadArchive().length;
    if (this._archiveBaseline !== null && current < this._archiveBaseline) {
      return `Archived notes decreased from ${this._archiveBaseline} to ${current} — possible data loss. Restore from backups/notes-archive-guard-*.json or Settings → Emergency Plan.`;
    }
    return null;
  }

  getScratchpadArchive(): any[] {
    if (this._scratchpadArchiveCache) return this._scratchpadArchiveCache;
    const raw = this.readProtectedJson<{ tabs: any[] }>(this.paths.scratchpadArchiveFile, { tabs: [] }).tabs;
    const tabs = Array.isArray(raw) ? raw : [];
    this._scratchpadArchiveCache = tabs;
    this.setArchiveBaseline(tabs.length);
    this.ensureEmergencySnapshotHasArchive();
    return tabs;
  }

  saveScratchpadArchive(tabs: any[]): any[] {
    this.guardArchiveWrite();
    const safe = Array.isArray(tabs) ? tabs : [];
    try {
      if (fs.existsSync(this.paths.scratchpadArchiveFile)) {
        const prev = fs.readFileSync(this.paths.scratchpadArchiveFile);
        if (prev.length > 0) {
          atomicWrite(this.paths.scratchpadArchiveFile + ".prev", prev);
        }
      }
    } catch {}

    // Cache only after the write succeeded (see saveScratchpad).
    this.writeProtectedJson(this.paths.scratchpadArchiveFile, { version: 1, tabs: safe });
    this._scratchpadArchiveCache = safe;
    return safe;
  }

  archiveScratchpadTab(tabId: string, tabFallback?: any): { success: boolean; reason?: string; activeTabs: any[]; archivedCount: number } {
    const active = this.getScratchpad();
    const targetIdx = active.findIndex((t: any) => t.id === tabId);
    let target = targetIdx !== -1 ? active[targetIdx] : tabFallback;

    if (target && target.protected && targetIdx !== -1) {
      return {
        success: false,
        reason: "protected",
        activeTabs: active,
        archivedCount: this.getScratchpadArchive().length,
      };
    }

    if (!target) {
      return {
        success: false,
        activeTabs: active,
        archivedCount: this.getScratchpadArchive().length,
      };
    }

    // Cold storage FIRST: a crash between the two writes then leaves the tab
    // duplicated (active + archive) instead of silently gone.
    this.guardArchiveWrite();
    const archive = this.getScratchpadArchive();
    const archivedItem = { ...target, archived: true, archivedAt: Date.now() };
    const newArchive = [archivedItem, ...archive.filter((t: any) => t.id !== tabId)];
    this.saveScratchpadArchive(newArchive);

    const newActive = active.filter((t: any) => t.id !== tabId);
    this.saveScratchpad(newActive, { force: true, override_protected: true });

    return {
      success: true,
      activeTabs: newActive,
      archivedCount: newArchive.length,
    };
  }

  restoreScratchpadTab(tabId: string): { success: boolean; restoredTab?: any; activeTabs: any[]; archivedCount: number } {
    const archive = this.getScratchpadArchive();
    const target = archive.find((t: any) => t.id === tabId);
    if (!target) {
      return {
        success: false,
        activeTabs: this.getScratchpad(),
        archivedCount: archive.length,
      };
    }

    // Active list FIRST (deduped by id): a crash then leaves the tab in both
    // places — recoverable — instead of in neither.
    this.guardArchiveWrite();
    const active = this.getScratchpad().filter((t: any) => t.id !== tabId);
    const restored = { ...target, archived: false };
    delete restored.archivedAt;
    const newActive = [...active, restored];
    this.saveScratchpad(newActive, { force: true });

    const newArchive = archive.filter((t: any) => t.id !== tabId);
    this.saveScratchpadArchive(newArchive);

    return {
      success: true,
      restoredTab: restored,
      activeTabs: newActive,
      archivedCount: newArchive.length,
    };
  }

  deleteArchivedScratchpadTab(tabId: string): { success: boolean; archivedCount: number } {
    this.guardArchiveWrite();
    const archive = this.getScratchpadArchive();
    const newArchive = archive.filter((t: any) => t.id !== tabId);
    this.saveScratchpadArchive(newArchive);
    return {
      success: true,
      archivedCount: newArchive.length,
    };
  }

  /**
   * Copy the vault (and vectors) files verbatim into backups/ with a timestamp.
   * Copies raw on-disk bytes, so an encrypted vault stays encrypted in the
   * backup. Skips if the vault is empty/missing or unchanged since the last
   * backup, and prunes to the most recent `keep` copies.
   */
  backupVault(keep = 10): string | null {
    try {
      const src = this.paths.vaultFile;
      if (!fs.existsSync(src)) return null;
      const raw = fs.readFileSync(src);
      if (raw.length === 0) return null;

      const dir = this.paths.backupsDir;
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Skip if identical to the newest existing backup (avoid churn on
      // every restart when nothing changed).
      const byMtime = (a: string, b: string) => {
        try {
          return fs.statSync(path.join(dir, a)).mtimeMs - fs.statSync(path.join(dir, b)).mtimeMs;
        } catch {
          return a < b ? -1 : 1;
        }
      };
      const existing = fs
        .readdirSync(dir)
        .filter((f) => /^vault-.*\.json$/.test(f))
        .sort(byMtime);
      const newest = existing[existing.length - 1];
      // v2: the header rarely changes — the database revision decides.
      const v2db = this.isV2() && this.db().exists() ? this.db() : null;
      const revFile = path.join(dir, ".vault-db-rev");
      const dbRev = v2db ? String(v2db.rev()) : "";
      if (newest) {
        try {
          const prev = fs.readFileSync(path.join(dir, newest));
          const lastRev = fs.existsSync(revFile) ? fs.readFileSync(revFile, "utf8").trim() : "";
          if (prev.equals(raw) && (!v2db || lastRev === dbRev)) return null;
        } catch {}
      }

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .replace("Z", "");
      const dest = path.join(dir, `vault-${stamp}.json`);
      atomicWrite(dest, raw);

      // Also back up companion files alongside (best effort, same stamp) so a
      // restore brings back everything, not just the secrets.
      const companion = (file: string, prefix: string) => {
        try {
          if (fs.existsSync(file)) {
            const buf = fs.readFileSync(file);
            if (buf.length > 0) {
              atomicWrite(path.join(dir, `${prefix}-${stamp}.json`), buf);
            }
          }
        } catch {}
      };
      companion(this.paths.vectorsFile, "vectors");
      if (v2db) {
        try {
          const kind = v2db.getMeta("enc") === "1" ? "enc" : "plain";
          v2db.copyTo(path.join(dir, `vault-db-${stamp}.${kind}.sqlite`));
          fs.writeFileSync(revFile, dbRev);
        } catch {}
      }
      companion(this.paths.scratchpadFile, "scratchpad");
      // Distinct prefixes — "scratchpad-archive" would collide with the
      // "scratchpad-" prune pool and the two kinds would evict each other.
      companion(this.paths.scratchpadArchiveFile, "notes-archive");
      companion(this.paths.noteRevisionsFile, "note-revisions");
      companion(this.paths.settingsFile, "settings");

      this.pruneBackups(keep);
      return dest;
    } catch {
      return null;
    }
  }

  private pruneBackups(keep: number) {
    try {
      const dir = this.paths.backupsDir;
      const prune = (prefix: string, ext = ".json") => {
        // Order by mtime, not filename sort — non-conforming filenames (e.g. a
        // hand-restored copy) must not decide which backups survive.
        const files = fs
          .readdirSync(dir)
          .filter((f) => f.startsWith(prefix) && f.endsWith(ext))
          .sort((a, b) => {
            try {
              return fs.statSync(path.join(dir, a)).mtimeMs - fs.statSync(path.join(dir, b)).mtimeMs;
            } catch {
              return a < b ? -1 : 1;
            }
          });
        while (files.length > keep) {
          const old = files.shift();
          if (old) {
            try {
              fs.unlinkSync(path.join(dir, old));
            } catch {}
          }
        }
      };
      prune("vault-");
      prune("vault-db-", ".sqlite");
      prune("vectors-");
      prune("scratchpad-");
      prune("notes-archive-");
      prune("note-revisions-");
      prune("settings-");
    } catch {}
  }

  listBackups(): { name: string; size: number; created_at: string }[] {
    try {
      const dir = this.paths.backupsDir;
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir)
        .filter((f) => /^vault-.*\.json$/.test(f))
        .map((f) => {
          const st = fs.statSync(path.join(dir, f));
          return { name: f, size: st.size, created_at: st.mtime.toISOString() };
        })
        .sort((a, b) => b.name.localeCompare(a.name));
    } catch {
      return [];
    }
  }

  // --- Watched folders (portable) ---
  listWatchedFolders(): WatchedFolder[] {
    if (this._foldersCache) return this._foldersCache;
    const folders = readJson<{ folders: WatchedFolder[] }>(this.paths.watchedFoldersFile, {
      folders: [],
    }).folders;
    this._foldersCache = folders;
    return folders;
  }

  saveWatchedFolders(folders: WatchedFolder[]) {
    this._foldersCache = null;
    atomicWrite(
      this.paths.watchedFoldersFile,
      JSON.stringify({ version: 1, folders }, null, 2)
    );
  }

  upsertWatchedFolder(folder: WatchedFolder) {
    const folders = this.listWatchedFolders();
    const idx = folders.findIndex((f) => f.id === folder.id || f.path === folder.path);
    if (idx >= 0) folders[idx] = folder;
    else folders.unshift(folder);
    this.saveWatchedFolders(folders);
    return folder;
  }

  removeWatchedFolder(id: string): boolean {
    const folders = this.listWatchedFolders();
    const next = folders.filter((f) => f.id !== id);
    if (next.length === folders.length) return false;
    this.saveWatchedFolders(next);
    return true;
  }

  // --- Scan review sessions (portable) ---
  private readSessions(): FolderScanSession[] {
    // Scan sessions carry extracted secret values and raw file fragments —
    // they belong INSIDE the encryption envelope (audit finding C1), never on
    // disk as plaintext.
    return this.readProtectedJson<{ sessions: FolderScanSession[] }>(this.paths.scanSessionsFile, {
      sessions: [],
    }).sessions;
  }

  private writeSessions(sessions: FolderScanSession[]) {
    // keep last 20 sessions only
    const trimmed = sessions.slice(0, 20);
    this.writeProtectedJson(this.paths.scanSessionsFile, { version: 1, sessions: trimmed });
  }

  listScanSessions(): FolderScanSession[] {
    return this.readSessions();
  }

  getScanSession(id: string): FolderScanSession | undefined {
    return this.readSessions().find((s) => s.id === id);
  }

  getActiveScanSession(): FolderScanSession | undefined {
    return this.readSessions().find((s) => s.status === "review");
  }

  /**
   * Atomic claim for closing a review session (AUD-009): compare-and-set the
   * status BEFORE the caller starts its long awaited work, so a concurrent
   * double-click / double-apply cannot re-enter and save the candidate set
   * twice. Synchronous on purpose — no await may separate the check from the
   * write. Returns the claimed session snapshot, or null when the session is
   * missing or not in the expected state.
   */
  claimScanSession(id: string, expected: FolderScanSession["status"], next: FolderScanSession["status"]): FolderScanSession | null {
    const sessions = this.readSessions();
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    if (sessions[idx].status !== expected) return null;
    sessions[idx] = { ...sessions[idx], status: next, updated_at: new Date().toISOString() };
    this.writeSessions(sessions);
    return sessions[idx];
  }

  saveScanSession(session: FolderScanSession) {
    const sessions = this.readSessions().filter((s) => s.id !== session.id);
    sessions.unshift(session);
    this.writeSessions(sessions);
    return session;
  }

  updateScanSession(
    id: string,
    patch: Partial<FolderScanSession>
  ): FolderScanSession | null {
    const sessions = this.readSessions();
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx === -1) return null;
    sessions[idx] = {
      ...sessions[idx],
      ...patch,
      id: sessions[idx].id,
      updated_at: new Date().toISOString(),
    };
    this.writeSessions(sessions);
    return sessions[idx];
  }

  // ==========================================================================
  // EMERGENCY PLAN
  // --------------------------------------------------------------------------
  // A self-contained, single-file snapshot of EVERYTHING that matters (vault,
  // vectors, scratchpad, settings) bundled together as raw on-disk bytes. The
  // vault stays encrypted if it was encrypted — we never decrypt for a backup.
  //
  // Snapshots are written to MULTIPLE stable, redundant locations that survive
  // an uninstall, a moved/USB exe, and a fresh reinstall:
  //   1) <root>/backups/emergency         (portable — travels with the folder)
  //   2) %APPDATA%/IndexArc/emergency     (machine — survives folder deletion)
  //   3) ~/.IndexArc/emergency            (home — last-ditch fallback)
  // Each snapshot has the same filename in every location, so a restore can pull
  // from whichever survived.
  // ==========================================================================

  private emergencyDirs(): string[] {
    // Tests redirect the machine-level fan-out via INDEXARC_EMERGENCY_DIR —
    // without this, test-created snapshots land in the REAL %APPDATA% and
    // their pruning evicts the user's genuine snapshot history (this exact
    // accident destroyed pre-existing snapshots once; never again).
    if (process.env.INDEXARC_EMERGENCY_DIR) {
      return [path.join(this.paths.backupsDir, "emergency"), process.env.INDEXARC_EMERGENCY_DIR];
    }
    const dirs = [
      path.join(this.paths.backupsDir, "emergency"),
      path.join(process.env.APPDATA || os.homedir(), "IndexArc", "emergency"),
      path.join(os.homedir(), ".IndexArc", "emergency"),
    ];
    const uniq: string[] = [];
    for (const d of dirs) {
      const r = path.resolve(d);
      if (!uniq.includes(r)) uniq.push(r);
    }
    return uniq;
  }

  private buildSnapshot(): { payload: string; encrypted: boolean } {
    const readB64 = (file: string): string | null => {
      try {
        if (fs.existsSync(file)) {
          const buf = fs.readFileSync(file);
          if (buf.length > 0) return buf.toString("base64");
        }
      } catch {}
      return null;
    };
    const snapshot = {
      format: "indexarc-emergency",
      version: 1 as const,
      created_at: new Date().toISOString(),
      encrypted: this.isEncryptionEnabled(),
      files: {
        vault: readB64(this.paths.vaultFile),
        vectors: readB64(this.paths.vectorsFile),
        scratchpad: readB64(this.paths.scratchpadFile),
        // Cold storage + note history are user data too — a snapshot without
        // them "survived" the reinstall but silently lost every archived note
        // and the whole revision history (audit AUD-003).
        scratchpad_archive: readB64(this.paths.scratchpadArchiveFile),
        note_revisions: readB64(this.paths.noteRevisionsFile),
        settings: readB64(this.paths.settingsFile),
        // Storage v2: a consistent copy of the record database.
        vault_db: (() => {
          try {
            if (!this.isV2()) return null;
            const bytes = this.db().snapshotBytes(this.paths.tmpDir);
            return bytes && bytes.length ? bytes.toString("base64") : null;
          } catch {
            return null;
          }
        })(),
      },
    };
    return { payload: JSON.stringify(snapshot), encrypted: snapshot.encrypted };
  }

  /**
   * Write a fresh emergency snapshot to every redundant location.
   * Skips if nothing changed since the newest existing snapshot. Keeps the
   * most recent `keep` per location. Returns the snapshot filename (or null).
   */
  createEmergencySnapshot(keep = 15): string | null {
    try {
      // Scratchpad-only users never create vault.json — their notes are
      // snapshot-worthy too (paths.ts applies the same rule for root
      // detection). Snapshot when ANY bundled file exists, not just the vault.
      const anySource = [
        this.paths.vaultFile,
        this.paths.vaultDbFile,
        this.paths.vectorsFile,
        this.paths.scratchpadFile,
        this.paths.scratchpadArchiveFile,
        this.paths.noteRevisionsFile,
      ].some((f) => fs.existsSync(f));
      if (!anySource) return null;
      const { payload } = this.buildSnapshot();

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .replace("Z", "");
      const name = `indexarc-emergency-${stamp}.iabak`;

      let wroteAny = false;
      for (const dir of this.emergencyDirs()) {
        try {
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

          // Skip if identical to the newest snapshot already here.
          const existing = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".iabak"))
            .sort();
          const newest = existing[existing.length - 1];
          if (newest) {
            try {
              const prev = fs.readFileSync(path.join(dir, newest), "utf-8");
              const prevData = JSON.parse(prev);
              const curData = JSON.parse(payload);
              // Compare file contents only (ignore created_at).
              if (JSON.stringify(prevData.files) === JSON.stringify(curData.files)) {
                continue;
              }
            } catch {}
          }

          atomicWrite(path.join(dir, name), payload);
          wroteAny = true;

          // Tiered retention (see snapshotsToKeep): a burst of edits after a
          // mass delete no longer evicts every snapshot from before it.
          const all = fs.readdirSync(dir).filter((f) => f.endsWith(".iabak"));
          const keepSet = snapshotsToKeep(all, Date.now(), keep);
          for (const old of all) {
            if (keepSet.has(old)) continue;
            try {
              fs.unlinkSync(path.join(dir, old));
            } catch {}
          }
        } catch {}
      }
      if (wroteAny && !this._snapshotSecretsPurged) {
        this._snapshotSecretsPurged = true;
        this.purgePlaintextSnapshotSecrets();
      }
      return wroteAny ? name : null;
    } catch {
      return null;
    }
  }

  private _snapshotSecretsPurged = false;

  /**
   * Snapshots taken before settings secrets were wrapped (safeStorage key)
   * still carry the provider API keys in plaintext — in up to three places,
   * one of them outside the portable root, for up to 8 weeks of retention.
   * Re-wrap them in place. Needs the settings key; without it the live
   * settings.json is plaintext too and there is nothing to gain. Returns the
   * number of snapshot files rewritten.
   */
  purgePlaintextSnapshotSecrets(): number {
    if (!this.settingsKeyBuf()) return 0;
    let rewritten = 0;
    for (const dir of this.emergencyDirs()) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(dir).filter((f) => f.endsWith(".iabak"));
      } catch {
        continue;
      }
      for (const name of names) {
        const file = path.join(dir, name);
        try {
          const snap = JSON.parse(fs.readFileSync(file, "utf-8"));
          const b64 = snap?.files?.settings;
          if (typeof b64 !== "string") continue;
          const settings = JSON.parse(Buffer.from(b64, "base64").toString("utf-8").replace(/^\uFEFF/, ""));
          let changed = false;
          for (const f of VaultStore.SECRET_SETTING_FIELDS) {
            const v = settings?.[f];
            if (typeof v === "string" && v !== "" && !v.startsWith("enc:v1:")) {
              settings[f] = this.wrapSettingSecret(v);
              changed = true;
            }
          }
          if (!changed) continue;
          snap.files.settings = Buffer.from(JSON.stringify(settings, null, 2), "utf-8").toString("base64");
          atomicWrite(file, JSON.stringify(snap));
          rewritten++;
        } catch {}
      }
    }
    return rewritten;
  }

  /**
   * List all emergency snapshots across every location, newest first,
   * de-duplicated by filename (same snapshot may exist in several dirs).
   */
  listEmergencySnapshots(): {
    name: string;
    size: number;
    created_at: string;
    encrypted: boolean;
    has_vault: boolean;
    has_notes: boolean;
    /** True for plaintext-era snapshots staged into the encryption grace
     *  area — the ransom-recovery copies; restorable like any other. */
    grace?: boolean;
    locations: string[];
  }[] {
    const byName = new Map<
      string,
      { name: string; size: number; created_at: string; encrypted: boolean; has_vault: boolean; has_notes: boolean; grace?: boolean; locations: string[] }
    >();
    // Grace-staged snapshots are listed alongside live ones (flagged) so the
    // Emergency Plan UI offers the pre-encryption recovery copies.
    const scanDirs: Array<{ dir: string; grace: boolean }> = [
      ...this.emergencyDirs().map((dir) => ({ dir, grace: false })),
      { dir: this.graceSnapshotDir(), grace: true },
    ];
    for (const { dir, grace } of scanDirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".iabak")) continue;
          const full = path.join(dir, f);
          const st = fs.statSync(full);
          let created_at = st.mtime.toISOString();
          let encrypted = false;
          let has_vault = false;
          let has_notes = false;
          // Snapshots are written once and never modified, and a big vault's
          // can be tens of MB: parse each only once per (size, mtime).
          const cached = snapshotMetaCache.get(full);
          if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) {
            ({ created_at, encrypted, has_vault, has_notes } = cached);
          } else {
            try {
              // has_vault/has_notes let the UI badge snapshots that contain
              // no vault/notes at all ("empty" — restoring one is a no-op),
              // so users don't pick the newest entry blindly.
              const meta = peekSnapshotMeta(fs.readFileSync(full));
              if (meta.created_at) created_at = meta.created_at;
              ({ encrypted, has_vault, has_notes } = meta);
              snapshotMetaCache.set(full, { size: st.size, mtimeMs: st.mtimeMs, created_at, encrypted, has_vault, has_notes });
            } catch {}
          }
          const prev = byName.get(f);
          if (prev) {
            prev.locations.push(dir);
          } else {
            byName.set(f, {
              name: f,
              size: st.size,
              created_at,
              encrypted,
              has_vault,
              has_notes,
              grace,
              locations: [dir],
            });
          }
        }
      } catch {}
    }
    return [...byName.values()].sort((a, b) => b.name.localeCompare(a.name));
  }

  /**
   * Pre-AUD-003 emergency snapshots lack the scratchpad_archive field —
   * restoring one would silently delete every archived note. On first
   * archive read, if every existing snapshot is missing the archive field,
   * create a fresh snapshot that includes it so the restore path is safe.
   */
  private ensureEmergencySnapshotHasArchive(): void {
    try {
      const snaps = this.listEmergencySnapshots();
      if (snaps.length === 0) return;
      const allMissingArchive = snaps.every((s) => !s.has_notes);
      if (!allMissingArchive) return;
      this.createEmergencySnapshot();
      addLog("SYSTEM", "Created fresh emergency snapshot including scratchpad_archive (pre-AUD-003 snapshots lacked it).");
    } catch {}
  }

  /**
   * Restore from a named emergency snapshot. Before overwriting, the CURRENT
   * state is snapshotted first (so a restore is itself undoable). Returns true
   * on success.
   *
   * While the vault is LOCKED only fully-encrypted snapshots are restorable:
   * restoring a plaintext (pre-encryption / grace) snapshot over a locked
   * vault would hand every secret to a token holder without the master
   * password. Plaintext recovery needs either an unlock first, or proof of
   * local presence (moving data/vault.json aside by hand, which un-encrypts
   * the "current" vault and lifts the lock gate).
   */
  restoreEmergencySnapshot(name: string): boolean {
    const snapshot = this.loadEmergencySnapshot(name);
    if (!snapshot) return false;
    if (this.isLocked() && !snapshotIsFullyEncrypted(snapshot)) return false;
    return this.applyEmergencySnapshot(snapshot);
  }

  /** null = snapshot not found/unreadable; otherwise whether every vault-key
   *  protected file inside it is an encrypted envelope. */
  emergencySnapshotIsEncrypted(name: string): boolean | null {
    const snapshot = this.loadEmergencySnapshot(name);
    return snapshot ? snapshotIsFullyEncrypted(snapshot) : null;
  }

  private loadEmergencySnapshot(name: string): any | null {
    // Locate the file in any location — live emergency dirs AND the grace
    // area (pre-encryption recovery copies are restorable by name too).
    let payload: string | null = null;
    for (const dir of [...this.emergencyDirs(), this.graceSnapshotDir()]) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full)) {
          payload = fs.readFileSync(full, "utf-8");
          break;
        }
      } catch {}
    }
    if (!payload) return null;

    let snapshot: any;
    try {
      snapshot = JSON.parse(payload);
    } catch {
      return null;
    }
    if (snapshot?.format !== "indexarc-emergency" || !snapshot.files) return null;
    return snapshot;
  }

  private applyEmergencySnapshot(snapshot: any): boolean {
    // Safety net: snapshot the current state before we clobber it.
    try {
      this.createEmergencySnapshot();
    } catch {}

    // Pre-AUD-003 snapshots have no archive/revisions fields — a null entry
    // makes restoring that file a no-op (backward compatible), while new
    // snapshots round-trip them fully.
    const targets: Array<[string, string | null | undefined]> = [
      [this.paths.vaultFile, snapshot.files.vault],
      [this.paths.vectorsFile, snapshot.files.vectors],
      [this.paths.scratchpadFile, snapshot.files.scratchpad],
      [this.paths.scratchpadArchiveFile, snapshot.files.scratchpad_archive],
      [this.paths.noteRevisionsFile, snapshot.files.note_revisions],
      [this.paths.settingsFile, snapshot.files.settings],
      [this.paths.vaultDbFile, snapshot.files.vault_db],
    ];
    // The live database must be closed (and its WAL dropped) before its file
    // is replaced; it reopens lazily on the next read.
    // Closing is harmless if staging fails (it reopens lazily); the file is
    // only swapped in the rename phase below.
    this._db?.close();

    // Two phases so a failure can't leave a MIXED file set (some files from
    // the snapshot, some from before, possibly under different keys):
    // 1) stage every file to a fsync'd temp — any failure aborts with the
    //    live files untouched; 2) rename the staged set into place.
    const staged: Array<[string, string]> = [];
    const cleanup = () => {
      for (const [tmp] of staged) {
        try {
          fs.unlinkSync(tmp);
        } catch {}
      }
    };
    try {
      for (const [file, b64] of targets) {
        if (b64 == null) continue;
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.restore.tmp`);
        const fd = fs.openSync(tmp, "w");
        try {
          fs.writeFileSync(fd, Buffer.from(b64, "base64"));
          fs.fsyncSync(fd);
        } finally {
          fs.closeSync(fd);
        }
        staged.push([tmp, file]);
      }
    } catch (e: any) {
      cleanup();
      addLog("DATA", `Emergency restore aborted while staging (${e?.code || e?.message}) — nothing was changed`);
      return false;
    }
    for (let i = 0; i < staged.length; i++) {
      const [tmp, file] = staged[i];
      if (file === this.paths.vaultDbFile) {
        // A WAL left by the previous database must never be replayed onto
        // the restored one.
        for (const side of [`${file}-wal`, `${file}-shm`]) {
          try {
            fs.unlinkSync(side);
          } catch {}
        }
      }
      try {
        withIoRetry(file, () => fs.renameSync(tmp, file));
        fsyncDir(path.dirname(file));
      } catch (e: any) {
        // Partially applied. The pre-restore safety snapshot taken above is
        // the way back — say so loudly instead of reporting success.
        for (const [rest] of staged.slice(i)) {
          try {
            fs.unlinkSync(rest);
          } catch {}
        }
        addLog("DATA", `Emergency restore FAILED after ${i}/${staged.length} files (${e?.code || e?.message}). Restore the newest "safety" snapshot from Settings → Emergency Plan.`);
        this.lock();
        this.clearCache();
        return false;
      }
    }

    // The restored vault decides whether encryption is expected from now on.
    this._encEnabledCache = null;
    try {
      const restored = snapshot.files.vault != null ? JSON.parse(Buffer.from(snapshot.files.vault, "base64").toString("utf-8").replace(/^\uFEFF/, "")) : null;
      if (restored) this.setEncryptionExpected(!!restored.encrypted);
    } catch {}

    // Critical: drop ALL in-memory state. The store caches entries, settings,
    // folders and notes — without this, the running server keeps serving the
    // PRE-restore data and the app looks unrestored until a full server
    // restart (this exact bug made restores appear to do nothing).
    // Locking as well: the restored vault may carry a different salt, so a
    // stale key must never be reused — the user unlocks fresh afterwards
    // (lock is a no-op gate when the vault is unencrypted).
    this.lock();
    this.clearCache();
    // Re-baseline integrity HMACs so the next startup check doesn't flag the
    // restored files as "unexpectedly modified".
    for (const f of [this.paths.vaultFile, this.paths.vectorsFile, this.paths.scratchpadFile, this.paths.scratchpadArchiveFile, this.paths.noteRevisionsFile, this.paths.settingsFile]) {
      this.recordIntegrity(f);
    }
    return true;
  }
}
