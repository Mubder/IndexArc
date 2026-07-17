import path from "path";
import fs from "fs";

/**
 * Portable single-folder root.
 * Priority: INDEXARC_ROOT env → executable/cwd for portable → process.cwd()
 * All vault data and config live under this root — USB-safe.
 */
function loadPersistedRoot(): string | null {
  // Mirror electron-main: restore the vault root saved on a previous run so a
  // standalone/updated launch never orphans user data.
  try {
    const { execSync } = require("child_process");
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
    const base = process.env.APPDATA || require("os").homedir();
    const marker = require("path").join(base, "IndexArc", "vault-root.json");
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
    const v = path.join(root, "data", "vault.json");
    return fs.existsSync(v) && fs.statSync(v).size > 0;
  } catch {
    return false;
  }
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
  };
}

export type PortablePaths = ReturnType<typeof ensurePortableLayout>;
