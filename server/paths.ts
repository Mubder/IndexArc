import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import os from "os";

/**
 * Portable single-folder root.
 * Priority: INDEXARC_ROOT env → executable/cwd for portable → process.cwd()
 * All vault data and config live under this root — USB-safe.
 */
function loadPersistedRoot(): string | null {
  // Mirror electron-main: restore the vault root saved on a previous run so a
  // standalone/updated launch never orphans user data.
  try {
    const out = execSync(`reg query "HKCU\\Software\\IndexArc" /v Root`, {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    } as any);
    const m = out.match(/REG_SZ\s+(.+)$/m);
    if (m) {
      const r = m[1].trim();
      if (r && fs.existsSync(r)) return r;
    }
  } catch {}
  try {
    const base = process.env.APPDATA || os.homedir();
    const marker = path.join(base, "IndexArc", "vault-root.json");
    if (fs.existsSync(marker)) {
      const parsed = JSON.parse(fs.readFileSync(marker, "utf8"));
      if (parsed && parsed.root && fs.existsSync(parsed.root)) return parsed.root;
    }
  } catch {}
  return null;
}

function hasVault(root: string | null | undefined): boolean {
  if (!root) return false;
  try {
    // Scratchpad-only users never create vault.json — their notes count too.
    for (const f of ["vault.json", "scratchpad.json"]) {
      const v = path.join(root, "data", f);
      if (fs.existsSync(v) && fs.statSync(v).size > 0) return true;
    }
  } catch {}
  return false;
}

export function getAppRoot(): string {
  if (process.env.INDEXARC_ROOT) {
    return path.resolve(process.env.INDEXARC_ROOT);
  }
  // Electron always passes INDEXARC_ROOT; this branch only runs when the
  // server is launched standalone.
  //
  // PORTABLE-FIRST: prefer the folder that ships alongside this build (the
  // parent of dist/) when it already holds a vault, so a copied/USB install is
  // self-contained. Only fall back to the machine-specific persisted root when
  // there is no local vault to use.
  const distSibling = process.env.INDEXARC_DIST_DIR
    ? path.dirname(path.resolve(process.env.INDEXARC_DIST_DIR))
    : null;
  if (hasVault(distSibling)) return distSibling as string;

  if (process.env.NODE_ENV === "production") {
    const persisted = loadPersistedRoot();
    if (persisted) return persisted;
  }
  if (distSibling) return distSibling;
  return path.resolve(process.cwd());
}

export function ensurePortableLayout(root: string = getAppRoot()) {
  const dirs = [
    path.join(root, "data"),
    path.join(root, "config"),
    path.join(root, "logs"),
    path.join(root, "tmp"),
    path.join(root, "backups"),
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
  return {
    root,
    dataDir: path.join(root, "data"),
    configDir: path.join(root, "config"),
    logsDir: path.join(root, "logs"),
    tmpDir: path.join(root, "tmp"),
    backupsDir: path.join(root, "backups"),
    vaultFile: path.join(root, "data", "vault.json"),
    vectorsFile: path.join(root, "data", "vectors.json"),
    settingsFile: path.join(root, "config", "settings.json"),
    watchedFoldersFile: path.join(root, "data", "watched_folders.json"),
    scanSessionsFile: path.join(root, "data", "scan_sessions.json"),
    scratchpadFile: path.join(root, "data", "scratchpad.json"),
    scratchpadArchiveFile: path.join(root, "data", "scratchpad_archive.json"),
    noteRevisionsFile: path.join(root, "data", "note_revisions.json"),
    manifestFile: path.join(root, "data", "manifest.json"),
    manifestKeyFile: path.join(root, "config", "manifest.key"),
  };
}

export type PortablePaths = ReturnType<typeof ensurePortableLayout>;

export interface AlternateRootInfo {
  root: string;
  vaultExists: boolean;
  vaultEntries: number | null;
  vaultEncrypted: boolean;
  scratchpadTabs: number | null;
}

function countEntriesLenient(root: string): { entries: number | null; encrypted: boolean; exists: boolean } {
  try {
    const f = path.join(root, "data", "vault.json");
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) return { entries: null, encrypted: false, exists: false };
    const raw = JSON.parse(fs.readFileSync(f, "utf-8"));
    if (raw && raw.encrypted) return { entries: null, encrypted: true, exists: true };
    const entries = Array.isArray(raw?.entries) ? raw.entries.length : 0;
    return { entries, encrypted: false, exists: true };
  } catch {
    return { entries: null, encrypted: false, exists: true };
  }
}

function countScratchTabsLenient(root: string): number | null {
  try {
    const f = path.join(root, "data", "scratchpad.json");
    if (!fs.existsSync(f) || fs.statSync(f).size === 0) return null;
    const raw = JSON.parse(fs.readFileSync(f, "utf-8"));
    const tabs = Array.isArray(raw) ? raw : Array.isArray(raw?.tabs) ? raw.tabs : null;
    return tabs ? tabs.length : null;
  } catch {
    return null;
  }
}

/**
 * Other places on this machine where a vault may already exist. Used by the
 * /api/health diagnostics endpoint (and startup logs) to detect the classic
 * "empty app after relaunch" situation: the server is serving a fresh/empty
 * root while the user's real data sits in a different folder (dev sandbox vs
 * project folder vs packaged exe folder vs AppData).
 *
 * Never switches roots automatically — it only REPORTS, so the dev sandbox
 * isolation guarantee is preserved.
 */
export function findAlternateVaultRoots(currentRoot: string): AlternateRootInfo[] {
  const norm = (p: string) => {
    try {
      return path.resolve(p);
    } catch {
      return p;
    }
  };
  const current = norm(currentRoot);
  const candidates: (string | null | undefined)[] = [
    process.cwd(),
    path.join(process.cwd(), ".desktop-sandbox"),
    process.env.INDEXARC_DIST_DIR ? path.dirname(path.resolve(process.env.INDEXARC_DIST_DIR)) : null,
    loadPersistedRoot(),
    path.join(process.env.APPDATA || os.homedir(), "IndexArc"),
    path.join(os.homedir(), ".IndexArc"),
  ];
  const seen = new Set<string>([current.toLowerCase()]);
  const out: AlternateRootInfo[] = [];
  for (const c of candidates) {
    if (!c) continue;
    let r: string;
    try {
      r = norm(c);
    } catch {
      continue;
    }
    const key = r.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      if (!fs.existsSync(path.join(r, "data"))) continue;
    } catch {
      continue;
    }
    const v = countEntriesLenient(r);
    const tabs = countScratchTabsLenient(r);
    if (!v.exists && tabs === null) continue;
    out.push({
      root: r,
      vaultExists: v.exists,
      vaultEntries: v.entries,
      vaultEncrypted: v.encrypted,
      scratchpadTabs: tabs,
    });
    if (out.length >= 5) break;
  }
  return out;
}
