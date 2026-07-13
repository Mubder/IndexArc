import fs from "fs";
import path from "path";
import type { VaultStore } from "../store.js";
import type { AppSettings, WatchedFolder } from "../types.js";
import { scanFileIntoSession } from "./folderScan.js";
import { addLog } from "../logs.js";

type WatcherHandle = {
  watcher: fs.FSWatcher;
  folderId: string;
  folderPath: string;
  sessionId: string;
  debounce: Map<string, NodeJS.Timeout>;
};

/**
 * In-process recursive folder watchers.
 * Events debounce per file and merge extracts into the active review session.
 */
export class FolderWatcherManager {
  private handles = new Map<string, WatcherHandle>();

  constructor(
    private store: VaultStore,
    private getSettings: () => AppSettings
  ) {}

  listActive(): string[] {
    return [...this.handles.keys()];
  }

  isWatching(folderId: string): boolean {
    return this.handles.has(folderId);
  }

  start(folder: WatchedFolder, sessionId: string): boolean {
    this.stop(folder.id);
    const dir = path.resolve(folder.path);
    if (!fs.existsSync(dir)) {
      addLog("WATCH", `Cannot watch missing path: ${dir}`);
      return false;
    }

    try {
      // recursive supported on Windows & macOS; Linux Node 20+ also often works
      const watcher = fs.watch(dir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const full = path.join(dir, filename.toString());
        this.queueFile(folder.id, full);
      });

      this.handles.set(folder.id, {
        watcher,
        folderId: folder.id,
        folderPath: dir,
        sessionId,
        debounce: new Map(),
      });

      addLog("WATCH", `Watching ${dir} (session ${sessionId.slice(0, 8)})`);
      return true;
    } catch (e: any) {
      addLog("WATCH", `Failed to watch ${dir}: ${e.message}`);
      return false;
    }
  }

  private queueFile(folderId: string, filePath: string) {
    const handle = this.handles.get(folderId);
    if (!handle) return;

    // ignore dirs / temp writes
    const base = path.basename(filePath);
    if (base.startsWith(".") && !base.startsWith(".env")) {
      // allow .env*
      if (!base.startsWith(".env")) return;
    }

    const existing = handle.debounce.get(filePath);
    if (existing) clearTimeout(existing);

    handle.debounce.set(
      filePath,
      setTimeout(async () => {
        handle.debounce.delete(filePath);
        try {
          if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return;
          addLog("WATCH", `Change detected: ${path.basename(filePath)}`);
          await scanFileIntoSession(
            this.store,
            this.getSettings(),
            handle.sessionId,
            filePath,
            false
          );
        } catch (e: any) {
          addLog("WATCH", `Rescan failed: ${e.message}`);
        }
      }, 800)
    );
  }

  /** Point watcher at a new review session after rescan */
  retargetSession(folderId: string, sessionId: string) {
    const h = this.handles.get(folderId);
    if (h) h.sessionId = sessionId;
  }

  stop(folderId: string) {
    const h = this.handles.get(folderId);
    if (!h) return;
    try {
      h.watcher.close();
    } catch {
      /* ignore */
    }
    for (const t of h.debounce.values()) clearTimeout(t);
    this.handles.delete(folderId);
    addLog("WATCH", `Stopped watcher ${folderId.slice(0, 8)}`);
  }

  stopAll() {
    for (const id of [...this.handles.keys()]) this.stop(id);
  }

  /** Restore watchers for folders marked watching (attach to latest review session if any) */
  restoreFromStore() {
    const folders = this.store.listWatchedFolders().filter((f) => f.watching);
    for (const f of folders) {
      const sessionId =
        f.last_scan_id ||
        this.store.getActiveScanSession()?.id ||
        this.store.listScanSessions()[0]?.id;
      if (sessionId) this.start(f, sessionId);
    }
  }
}
