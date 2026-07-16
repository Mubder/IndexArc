import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
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
import { deriveKey, generateSalt, encryptString, decryptString } from "./crypto.js";

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

  constructor(private paths: PortablePaths) {}

  // --- Encryption Support ---
  isEncryptionEnabled(): boolean {
    const raw = readJson<any>(this.paths.vaultFile, null);
    return !!(raw && raw.encrypted);
  }

  isLocked(): boolean {
    return this.isEncryptionEnabled() && !this.encryptionKey;
  }

  unlock(password: string): boolean {
    const raw = readJson<any>(this.paths.vaultFile, null);
    if (!raw || !raw.encrypted) {
      return true;
    }
    try {
      const key = deriveKey(password, raw.salt);
      const decrypted = decryptString(raw.ciphertext, key, raw.iv, raw.authTag);
      JSON.parse(decrypted); // Verify valid JSON
      this.encryptionKey = key;
      return true;
    } catch {
      return false;
    }
  }

  lock(): void {
    this.encryptionKey = null;
  }

  setupPassword(password: string): void {
    if (this.isEncryptionEnabled()) {
      throw new Error("Vault is already encrypted. Remove the current password first.");
    }
    const salt = generateSalt();
    const key = deriveKey(password, salt);
    this.encryptionKey = key;

    const vault = this.readVault();
    let vectors = { version: 1 as const, chunks: [] as any[] };
    try {
      vectors = this.readVectors();
    } catch {
      // ignore
    }

    this.writeVault(vault);
    this.writeVectors(vectors);
  }

  removePassword(password: string): boolean {
    if (!this.isEncryptionEnabled()) {
      return true;
    }
    const raw = readJson<any>(this.paths.vaultFile, null);
    try {
      const key = deriveKey(password, raw.salt);
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

      this.encryptionKey = null;

      atomicWrite(this.paths.vaultFile, JSON.stringify(vault, null, 2));
      atomicWrite(this.paths.vectorsFile, JSON.stringify(vectors));
      return true;
    } catch {
      return false;
    }
  }

  // --- Settings ---
  getSettings(): AppSettings {
    const raw = readJson<Partial<AppSettings>>(this.paths.settingsFile, {});
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
    return settings;
  }

  saveSettings(partial: Partial<AppSettings>): AppSettings {
    const next = { ...this.getSettings(), ...partial };
    atomicWrite(this.paths.settingsFile, JSON.stringify(next, null, 2));
    return next;
  }

  // --- Vault ---
  private readVault(): VaultFile {
    const raw = readJson<any>(this.paths.vaultFile, { version: 1, entries: [] });
    if (raw.encrypted) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      try {
        const decrypted = decryptString(raw.ciphertext, this.encryptionKey, raw.iv, raw.authTag);
        return JSON.parse(decrypted) as VaultFile;
      } catch (e: any) {
        throw new Error("Failed to decrypt vault: incorrect key or corrupted file");
      }
    }
    return raw as VaultFile;
  }

  private writeVault(vault: VaultFile) {
    const rawDisk = readJson<any>(this.paths.vaultFile, null);
    const isDiskEncrypted = rawDisk && rawDisk.encrypted;

    if (isDiskEncrypted || this.encryptionKey) {
      if (!this.encryptionKey) {
        throw new Error("Vault is locked");
      }
      const salt = rawDisk?.salt || generateSalt();
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
      total_secrets: entries.filter((e) => e.family === "secret" || e.family === "unknown").length,
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
      const salt = rawDisk?.salt || generateSalt();
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
      const existing = fs
        .readdirSync(dir)
        .filter((f) => /^vault-.*\.json$/.test(f))
        .sort();
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

      // Also back up vectors alongside (best effort, same stamp).
      try {
        if (fs.existsSync(this.paths.vectorsFile)) {
          const v = fs.readFileSync(this.paths.vectorsFile);
          if (v.length > 0) {
            fs.writeFileSync(path.join(dir, `vectors-${stamp}.json`), v);
          }
        }
      } catch {}

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
        const files = fs
          .readdirSync(dir)
          .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
          .sort();
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
    return readJson<{ folders: WatchedFolder[] }>(this.paths.watchedFoldersFile, {
      folders: [],
    }).folders;
  }

  saveWatchedFolders(folders: WatchedFolder[]) {
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
}
