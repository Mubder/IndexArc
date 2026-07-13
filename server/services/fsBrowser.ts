import fs from "fs";
import path from "path";
import os from "os";

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

/** Drive letters (Windows) or filesystem roots */
export function listFsRoots(): { path: string; label: string }[] {
  if (process.platform === "win32") {
    const roots: { path: string; label: string }[] = [];
    for (let i = 65; i <= 90; i++) {
      const letter = String.fromCharCode(i);
      const p = `${letter}:\\`;
      try {
        if (fs.existsSync(p)) {
          roots.push({ path: p, label: `${letter}:` });
        }
      } catch {
        /* skip */
      }
    }
    // user home as shortcut
    const home = os.homedir();
    if (home && fs.existsSync(home)) {
      roots.unshift({ path: home, label: "Home" });
    }
    return roots;
  }

  const roots = [{ path: "/", label: "/" }];
  const home = os.homedir();
  if (home && fs.existsSync(home)) {
    roots.unshift({ path: home, label: "Home" });
  }
  return roots;
}

export function listDirectory(dirPath: string): {
  path: string;
  parent: string | null;
  entries: FsEntry[];
} {
  const resolved = path.resolve(dirPath || (process.platform === "win32" ? "C:\\" : "/"));

  if (!fs.existsSync(resolved)) {
    throw new Error(`Path does not exist: ${resolved}`);
  }
  const st = fs.statSync(resolved);
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${resolved}`);
  }

  let entries: FsEntry[] = [];
  try {
    const dirents = fs.readdirSync(resolved, { withFileTypes: true });
    entries = dirents
      .map((d) => {
        const full = path.join(resolved, d.name);
        let isDirectory = d.isDirectory();
        // resolve symlinks lightly
        if (d.isSymbolicLink()) {
          try {
            isDirectory = fs.statSync(full).isDirectory();
          } catch {
            isDirectory = false;
          }
        }
        return {
          name: d.name,
          path: full,
          isDirectory,
        };
      })
      .filter((e) => e.isDirectory) // folders only for picker
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (e: any) {
    throw new Error(`Cannot read directory: ${e.message}`);
  }

  const parent = path.dirname(resolved);
  const parentSame =
    parent === resolved ||
    (process.platform === "win32" && /^[A-Za-z]:\\?$/.test(resolved) && parent === resolved);

  return {
    path: resolved,
    parent: parentSame ? null : parent,
    entries,
  };
}
