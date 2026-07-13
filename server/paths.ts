import path from "path";
import fs from "fs";

/**
 * Portable single-folder root.
 * Priority: INDEXARC_ROOT env → executable/cwd for portable → process.cwd()
 * All vault data and config live under this root — USB-safe.
 */
export function getAppRoot(): string {
  if (process.env.INDEXARC_ROOT) {
    return path.resolve(process.env.INDEXARC_ROOT);
  }
  // Bundled CJS (esbuild server.cjs) sets __dirname to dist/
  // Dev (tsx) uses project root via cwd.
  if (process.env.INDEXARC_DIST_DIR) {
    // Electron: data next to resources or user-specified; prefer sibling of dist
    const distDir = path.resolve(process.env.INDEXARC_DIST_DIR);
    // Portable layout: ROOT/dist + ROOT/data → root is parent of dist when packaged as app/
    const candidate = path.dirname(distDir);
    return candidate;
  }
  return path.resolve(process.cwd());
}

export function ensurePortableLayout(root: string = getAppRoot()) {
  const dirs = [
    path.join(root, "data"),
    path.join(root, "config"),
    path.join(root, "logs"),
    path.join(root, "tmp"),
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
    vaultFile: path.join(root, "data", "vault.json"),
    vectorsFile: path.join(root, "data", "vectors.json"),
    settingsFile: path.join(root, "config", "settings.json"),
    watchedFoldersFile: path.join(root, "data", "watched_folders.json"),
    scanSessionsFile: path.join(root, "data", "scan_sessions.json"),
  };
}

export type PortablePaths = ReturnType<typeof ensurePortableLayout>;
