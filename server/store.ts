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
import { deriveKey, deriveKeyAsync, generateSalt, encryptString, decryptString } from "./crypto.js";
import { addLog } from "./logs.js";

interface VaultFile {
  version: 1;
  entries: VaultEntry[];
}

interface VectorsFile {
  version: 1;
  chunks: VectorChunk[];
}

function atomicWrite(filePath: string, data: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data, "utf-8");
  fs.renameSync(tmp, filePath);
}

// Like readJson, but for critical data files: an unparseable file is renamed
// to *.corrupt-<stamp> (quarantined, never deleted or overwritten) so the
// user can recover it manually instead of the store silently wiping it.
function readJsonOrQuarantine<T>(filePath: string, fallback: T, label: string): T {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
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

function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
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
  private _settingsCache: AppSettings | null = null;
  private _entriesCache: VaultEntry[] | null = null;
  private _foldersCache: WatchedFolder[] | null = null;
  private _scratchpadCache: any[] | null = null;
  private _scratchpadArchiveCache: any[] | null = null;

  constructor(private paths: PortablePaths) {}

  /** Invalidate all in-memory caches (call after any write) */
  clearCache() {
    this._settingsCache = null;
    this._entriesCache = null;
    this._foldersCache = null;
    this._scratchpadCache = null;
    this._scratchpadArchiveCache = null;
  }

  // --- Encryption Support ---
  isEncryptionEnabled(): boolean {
    const raw = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
    return !!(raw && raw.encrypted);
  }

  isLocked(): boolean {
    return this.isEncryptionEnabled() && !this.encryptionKey;
  }

  async unlock(password: string): Promise<boolean> {
    const raw = readJson<any>(this.paths.vaultFile, null);
    if (!raw || !raw.encrypted) {
      return true;
    }
    try {
      const key = await deriveKeyAsync(password, raw.salt);
      const decrypted = decryptString(raw.ciphertext, key, raw.iv, raw.authTag);
      JSON.parse(decrypted); // Verify valid JSON
      this.encryptionKey = key;
      this.encryptionSaltHex = raw.salt;
      // The locked period may have cached empty reads — drop them so the
      // freshly decrypted content is served.
      this._scratchpadCache = null;
      this._scratchpadArchiveCache = null;
      return true;
    } catch {
      return false;
    }
  }

  lock(): void {
    this.encryptionKey = null;
    this.encryptionSaltHex = null;
    // Purge decrypted caches too — a locked vault must not serve content
    // that is still sitting in memory caches.
    this._scratchpadCache = null;
    this._scratchpadArchiveCache = null;
  }

  async setupPassword(password: string): Promise<void> {
    if (this.isEncryptionEnabled()) {
      throw new Error("Vault is already encrypted. Remove the current password first.");
    }
    const salt = generateSalt();
    const key = await deriveKeyAsync(password, salt);
    this.encryptionKey = key;
    this.encryptionSaltHex = salt;

    const vault = this.readVault();
    let vectors = { version: 1 as const, chunks: [] as any[] };
    try {
      vectors = this.readVectors();
    } catch {
      // ignore
    }

    this.writeVault(vault);
    this.writeVectors(vectors);

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
  }

  async removePassword(password: string): Promise<boolean> {
    if (!this.isEncryptionEnabled()) {
      return true;
    }
    const raw = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
    try {
      const key = await deriveKeyAsync(password, raw.salt);
      const decryptedVault = decryptString(raw.ciphertext, key, raw.iv, raw.authTag);
      const vault = JSON.parse(decryptedVault) as VaultFile;

      let vectors = { version: 1 as const, chunks: [] as any[] };
      try {
        const rawVectors = readJson<any>(this.paths.vectorsFile, null);
        if (rawVectors && rawVectors.encrypted) {
          const decryptedVectors = decryptString(rawVectors.ciphertext, key, rawVectors.iv, rawVectors.authTag);
          vectors = JSON.parse(decryptedVectors) as VectorsFile;
        } else if (rawVectors) {
          vectors = rawVectors;
        }
      } catch {
        // ignore
      }

      // Read companion files while the key is still available, then rewrite
      // them as plaintext alongside the decrypted vault.
      const scratch = this.getScratchpad();
      const archive = this.getScratchpadArchive();
      const revs = this.readProtectedJson<any>(this.paths.noteRevisionsFile, {
        version: 1,
        revisions: {},
      });

      this.encryptionKey = null;
      this.encryptionSaltHex = null;

      atomicWrite(this.paths.vaultFile, JSON.stringify(vault, null, 2));
      atomicWrite(this.paths.vectorsFile, JSON.stringify(vectors));
      atomicWrite(this.paths.scratchpadFile, JSON.stringify({ version: 2, tabs: scratch }, null, 2));
      atomicWrite(this.paths.scratchpadArchiveFile, JSON.stringify({ version: 1, tabs: archive }, null, 2));
      atomicWrite(this.paths.noteRevisionsFile, JSON.stringify(revs, null, 2));
      for (const f of [this.paths.vaultFile, this.paths.vectorsFile, this.paths.scratchpadFile, this.paths.scratchpadArchiveFile, this.paths.noteRevisionsFile]) {
        this.recordIntegrity(f);
      }
      this._scratchpadCache = null;
      this._scratchpadArchiveCache = null;
      return true;
    } catch {
      return false;
    }
  }

  // --- Settings ---
  getSettings(): AppSettings {
    if (this._settingsCache) return this._settingsCache;
    const raw = readJsonOrQuarantine<Partial<AppSettings>>(this.paths.settingsFile, {}, "settings.json");
    // Prefer env keys if settings keys are empty
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...raw };
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
    this._settingsCache = settings;
    return settings;
  }

  saveSettings(partial: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...partial };
    atomicWrite(this.paths.settingsFile, JSON.stringify(next, null, 2));
    this._settingsCache = null;
    return next;
  }

  // --- Vault ---
  private readVault(): VaultFile {
    if (this._entriesCache) return { version: 1, entries: this._entriesCache };
    const raw = readJson<any>(this.paths.vaultFile, { version: 1, entries: [] });
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      try {
        const decrypted = decryptString(raw.ciphertext, this.encryptionKey, raw.iv, raw.authTag);
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
    const rawDisk = readJsonOrQuarantine<any>(this.paths.vaultFile, null, "vault.json");
    const isDiskEncrypted = rawDisk && rawDisk.encrypted;

    if (isDiskEncrypted || this.encryptionKey) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      // The stored salt MUST be the one the key was derived from.
      const salt = this.encryptionSaltHex || rawDisk?.salt || generateSalt();
      const text = JSON.stringify(vault, null, 2);
      const encrypted = encryptString(text, this.encryptionKey);
      
      const payload = {
        version: 1,
        encrypted: true as const,
        salt,
        ...encrypted
      };
      atomicWrite(this.paths.vaultFile, JSON.stringify(payload, null, 2));
    } else {
      atomicWrite(this.paths.vaultFile, JSON.stringify(vault, null, 2));
    }
    // Only after the write succeeded — a failed write must not invalidate
    // the cache and silently resurrect the previous disk state.
    this._entriesCache = null;
    this.recordIntegrity(this.paths.vaultFile);
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
    vault.entries.unshift(entry);
    this.writeVault(vault);
    return entry;
  }

  updateEntry(id: string, patch: Partial<VaultEntry>): VaultEntry | null {
    const vault = this.readVault();
    const idx = vault.entries.findIndex((e) => e.id === id);
    if (idx === -1) return null;
    vault.entries[idx] = {
      ...vault.entries[idx],
      ...patch,
      id: vault.entries[idx].id,
      created_at: vault.entries[idx].created_at,
      updated_at: new Date().toISOString(),
    };
    this.writeVault(vault);
    return vault.entries[idx];
  }

  deleteEntry(id: string): boolean {
    const vault = this.readVault();
    const before = vault.entries.length;
    vault.entries = vault.entries.filter((e) => e.id !== id);
    this.writeVault(vault);
    this.removeVectorsForEntry(id);
    return vault.entries.length < before;
  }

  bulkDeleteEntries(ids: string[]): number {
    const idSet = new Set(ids);
    const vault = this.readVault();
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
    const raw = readJson<any>(this.paths.vectorsFile, { version: 1, chunks: [] });
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      try {
        const decrypted = decryptString(raw.ciphertext, this.encryptionKey, raw.iv, raw.authTag);
        return JSON.parse(decrypted) as VectorsFile;
      } catch (e: any) {
        throw new Error("Failed to decrypt vectors");
      }
    }
    return raw as VectorsFile;
  }

  private writeVectors(v: VectorsFile) {
    const rawDisk = readJson<any>(this.paths.vectorsFile, null);
    const isDiskEncrypted = rawDisk && rawDisk.encrypted;

    if (isDiskEncrypted || this.encryptionKey) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      const salt = this.encryptionSaltHex || rawDisk?.salt || generateSalt();
      const text = JSON.stringify(v);
      const encrypted = encryptString(text, this.encryptionKey);
      
      const payload = {
        version: 1,
        encrypted: true as const,
        salt,
        ...encrypted
      };
      atomicWrite(this.paths.vectorsFile, JSON.stringify(payload));
    } else {
      atomicWrite(this.paths.vectorsFile, JSON.stringify(v));
    }
    this.recordIntegrity(this.paths.vectorsFile);
  }

  upsertVector(chunk: VectorChunk) {
    const v = this.readVectors();
    v.chunks = v.chunks.filter((c) => c.id !== chunk.id && c.entry_id !== chunk.entry_id);
    v.chunks.push(chunk);
    this.writeVectors(v);
  }

  removeVectorsForEntry(entryId: string) {
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
  private writeProtectedJson(file: string, obj: unknown): void {
    const rawDisk = readJson<any>(file, null);
    const isDiskEncrypted = !!(rawDisk && rawDisk.encrypted);
    if (isDiskEncrypted || this.encryptionKey) {
      if (!this.encryptionKey) {
        // Locked: refuse rather than write plaintext over ciphertext.
        throw new Error("Vault is locked");
      }
      const salt =
        this.encryptionSaltHex ||
        rawDisk?.salt ||
        readJson<any>(this.paths.vaultFile, null)?.salt ||
        generateSalt();
      const encrypted = encryptString(JSON.stringify(obj), this.encryptionKey);
      atomicWrite(
        file,
        JSON.stringify({ version: 2, encrypted: true as const, salt, ...encrypted }, null, 2)
      );
    } else {
      atomicWrite(file, JSON.stringify(obj, null, 2));
    }
    this.recordIntegrity(file);
  }

  private readProtectedJson<T>(file: string, fallback: T): T {
    const raw = readJsonOrQuarantine<any>(file, null, path.basename(file));
    if (!raw) return fallback;
    if (raw.encrypted) {
      if (!this.encryptionKey) return fallback; // locked → looks empty
      try {
        return JSON.parse(decryptString(raw.ciphertext, this.encryptionKey, raw.iv, raw.authTag)) as T;
      } catch {
        return fallback;
      }
    }
    return raw as T;
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
    return warnings;
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

  saveScratchpad(tabs: any[], opts: { force?: boolean } = {}): any[] {
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
          fs.writeFileSync(this.paths.scratchpadFile + ".prev", prev);
        }
      }
    } catch {}

    this._scratchpadCache = enriched;
    this.writeProtectedJson(this.paths.scratchpadFile, { version: 2, tabs: enriched });
    return enriched;
  }

  // --- Granular scratchpad operations (PR-12) ---
  // Content/meta/delete/order are per-tab so one stale client can never
  // clobber unrelated notes (the whole-array POST is a compat path only).

  /** Update one tab's content. baseRev mismatch (and differing content) → conflict. */
  updateScratchpadTabContent(id: string, content: string, baseRev?: number): { ok: boolean; conflict?: boolean; tab?: any } {
    const active = this.getScratchpad();
    const tab = active.find((t: any) => t.id === id);
    if (!tab) {
      // Upsert: a brand-new tab created by a client (client-generated id).
      const created = { id, title: "Scratch", content, archived: false };
      const saved = this.saveScratchpad([...active, created], { force: true });
      return { ok: true, tab: saved.find((t: any) => t.id === id) };
    }
    if (Number.isFinite(baseRev as number) && (Number(tab.rev) || 1) > Number(baseRev) && tab.content !== content) {
      return { ok: false, conflict: true, tab };
    }
    const updated = active.map((t: any) => (t.id === id ? { ...t, content } : t));
    const saved = this.saveScratchpad(updated, { force: true });
    return { ok: true, tab: saved.find((t: any) => t.id === id) };
  }

  renameScratchpadTab(id: string, title: string): any | null {
    const active = this.getScratchpad();
    if (!active.some((t: any) => t.id === id)) return null;
    const saved = this.saveScratchpad(active.map((t: any) => (t.id === id ? { ...t, title } : t)), { force: true });
    return saved.find((t: any) => t.id === id) || null;
  }

  deleteScratchpadTab(id: string): boolean {
    const active = this.getScratchpad();
    if (!active.some((t: any) => t.id === id)) return false;
    this.saveScratchpad(active.filter((t: any) => t.id !== id), { force: true });
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

  // --- Scratchpad Archive (Passive Cold Storage) ---
  getScratchpadArchive(): any[] {
    if (this._scratchpadArchiveCache) return this._scratchpadArchiveCache;
    const raw = this.readProtectedJson<{ tabs: any[] }>(this.paths.scratchpadArchiveFile, { tabs: [] }).tabs;
    const tabs = Array.isArray(raw) ? raw : [];
    this._scratchpadArchiveCache = tabs;
    return tabs;
  }

  saveScratchpadArchive(tabs: any[]): any[] {
    const safe = Array.isArray(tabs) ? tabs : [];
    try {
      if (fs.existsSync(this.paths.scratchpadArchiveFile)) {
        const prev = fs.readFileSync(this.paths.scratchpadArchiveFile);
        if (prev.length > 0) {
          fs.writeFileSync(this.paths.scratchpadArchiveFile + ".prev", prev);
        }
      }
    } catch {}

    this._scratchpadArchiveCache = safe;
    this.writeProtectedJson(this.paths.scratchpadArchiveFile, { version: 1, tabs: safe });
    return safe;
  }

  archiveScratchpadTab(tabId: string, tabFallback?: any): { success: boolean; activeTabs: any[]; archivedCount: number } {
    const active = this.getScratchpad();
    const targetIdx = active.findIndex((t: any) => t.id === tabId);
    let target = targetIdx !== -1 ? active[targetIdx] : tabFallback;

    if (!target) {
      return {
        success: false,
        activeTabs: active,
        archivedCount: this.getScratchpadArchive().length,
      };
    }

    // Cold storage FIRST: a crash between the two writes then leaves the tab
    // duplicated (active + archive) instead of silently gone.
    const archive = this.getScratchpadArchive();
    const archivedItem = { ...target, archived: true, archivedAt: Date.now() };
    const newArchive = [archivedItem, ...archive.filter((t: any) => t.id !== tabId)];
    this.saveScratchpadArchive(newArchive);

    const newActive = active.filter((t: any) => t.id !== tabId);
    this.saveScratchpad(newActive, { force: true });

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
      if (newest) {
        try {
          const prev = fs.readFileSync(path.join(dir, newest));
          if (prev.equals(raw)) return null;
        } catch {}
      }

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace("T", "_")
        .replace("Z", "");
      const dest = path.join(dir, `vault-${stamp}.json`);
      fs.writeFileSync(dest, raw);

      // Also back up companion files alongside (best effort, same stamp) so a
      // restore brings back everything, not just the secrets.
      const companion = (file: string, prefix: string) => {
        try {
          if (fs.existsSync(file)) {
            const buf = fs.readFileSync(file);
            if (buf.length > 0) {
              fs.writeFileSync(path.join(dir, `${prefix}-${stamp}.json`), buf);
            }
          }
        } catch {}
      };
      companion(this.paths.vectorsFile, "vectors");
      companion(this.paths.scratchpadFile, "scratchpad");
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
      const prune = (prefix: string) => {
        // Order by mtime, not filename sort — non-conforming filenames (e.g. a
        // hand-restored copy) must not decide which backups survive.
        const files = fs
          .readdirSync(dir)
          .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
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
      prune("vectors-");
      prune("scratchpad-");
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
    return readJson<{ sessions: FolderScanSession[] }>(this.paths.scanSessionsFile, {
      sessions: [],
    }).sessions;
  }

  private writeSessions(sessions: FolderScanSession[]) {
    // keep last 20 sessions only
    const trimmed = sessions.slice(0, 20);
    atomicWrite(
      this.paths.scanSessionsFile,
      JSON.stringify({ version: 1, sessions: trimmed }, null, 2)
    );
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
        settings: readB64(this.paths.settingsFile),
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
      if (!fs.existsSync(this.paths.vaultFile)) return null;
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

          fs.writeFileSync(path.join(dir, name), payload, "utf-8");
          wroteAny = true;

          // Prune to keep newest N.
          const after = fs
            .readdirSync(dir)
            .filter((f) => f.endsWith(".iabak"))
            .sort();
          while (after.length > keep) {
            const old = after.shift();
            if (old) {
              try {
                fs.unlinkSync(path.join(dir, old));
              } catch {}
            }
          }
        } catch {}
      }
      return wroteAny ? name : null;
    } catch {
      return null;
    }
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
    locations: string[];
  }[] {
    const byName = new Map<
      string,
      { name: string; size: number; created_at: string; encrypted: boolean; locations: string[] }
    >();
    for (const dir of this.emergencyDirs()) {
      try {
        if (!fs.existsSync(dir)) continue;
        for (const f of fs.readdirSync(dir)) {
          if (!f.endsWith(".iabak")) continue;
          const full = path.join(dir, f);
          const st = fs.statSync(full);
          let created_at = st.mtime.toISOString();
          let encrypted = false;
          try {
            const parsed = JSON.parse(fs.readFileSync(full, "utf-8"));
            if (parsed?.created_at) created_at = parsed.created_at;
            encrypted = !!parsed?.encrypted;
          } catch {}
          const prev = byName.get(f);
          if (prev) {
            prev.locations.push(dir);
          } else {
            byName.set(f, {
              name: f,
              size: st.size,
              created_at,
              encrypted,
              locations: [dir],
            });
          }
        }
      } catch {}
    }
    return [...byName.values()].sort((a, b) => b.name.localeCompare(a.name));
  }

  /**
   * Restore from a named emergency snapshot. Before overwriting, the CURRENT
   * state is snapshotted first (so a restore is itself undoable). Returns true
   * on success.
   */
  restoreEmergencySnapshot(name: string): boolean {
    // Locate the file in any location.
    let payload: string | null = null;
    for (const dir of this.emergencyDirs()) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full)) {
          payload = fs.readFileSync(full, "utf-8");
          break;
        }
      } catch {}
    }
    if (!payload) return false;

    let snapshot: any;
    try {
      snapshot = JSON.parse(payload);
    } catch {
      return false;
    }
    if (snapshot?.format !== "indexarc-emergency" || !snapshot.files) return false;

    // Safety net: snapshot the current state before we clobber it.
    try {
      this.createEmergencySnapshot();
    } catch {}

    const writeB64 = (file: string, b64: string | null) => {
      if (b64 == null) return;
      try {
        const buf = Buffer.from(b64, "base64");
        const dir = path.dirname(file);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.tmp`);
        fs.writeFileSync(tmp, buf);
        fs.renameSync(tmp, file);
      } catch {}
    };

    writeB64(this.paths.vaultFile, snapshot.files.vault);
    writeB64(this.paths.vectorsFile, snapshot.files.vectors);
    writeB64(this.paths.scratchpadFile, snapshot.files.scratchpad);
    writeB64(this.paths.settingsFile, snapshot.files.settings);

    // The restored vault may be encrypted; drop any in-memory key so the user
    // is prompted to unlock with the restored vault's password.
    this.encryptionKey = null;
    return true;
  }
}
