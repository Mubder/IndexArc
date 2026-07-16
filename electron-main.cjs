const { app, BrowserWindow, Menu, dialog, ipcMain, Tray, nativeImage, shell } = require("electron");
const { fork, spawn } = require("child_process");
const path = require("path");
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const { execSync } = require("child_process");

function logCrash(tag, e) {
  try {
    fs.appendFileSync(
      path.join(os.tmpdir(), "indexarc-crash.log"),
      `[${new Date().toISOString()}] [${tag}] ${e && e.stack ? e.stack : e}\n`
    );
  } catch {}
}
process.on("uncaughtException", (e) => logCrash("uncaughtException", e));
process.on("unhandledRejection", (e) => logCrash("unhandledRejection", e));

let serverProcess = null;
let ollamaProcess = null;
let mainWindow = null;
let tray = null;
let isQuiting = false;
const PORT = Number(process.env.PORT) || 3000;

/**
 * Where vault data lives (data/, config/, logs/).
 * - Packaged: folder next to the .exe (USB portable) — starts EMPTY
 * - Dev Electron: isolated `.desktop-sandbox/` so we NEVER use your real project vault
 * - Override: INDEXARC_ROOT env
 *
 * IMPORTANT: user secrets must never be baked into the installer/package.
 */
const REG_KEY = "HKCU\\Software\\IndexArc";
const REG_VALUE = "Root";

// A stable, writable marker location that survives reinstalls/updates.
// (AppData is never touched by the installer, unlike the install folder.)
function getMarkerPath() {
  const base = process.env.APPDATA || app.getPath("userData");
  return path.join(base, "IndexArc", "vault-root.json");
}

// Find a candidate root that already contains a real vault (so we never
// orphan user data when the exe moves to a new folder on update).
function findExistingVaultRoot(candidates) {
  for (const c of candidates) {
    if (!c) continue;
    try {
      const v = path.join(c, "data", "vault.json");
      if (fs.existsSync(v) && fs.statSync(v).size > 0) return c;
    } catch {}
  }
  return null;
}

function savePortableRoot(root) {
  try {
    // Persist to registry (preferred) and a marker file (fallback).
    execSync(`reg add "${REG_KEY}" /v ${REG_VALUE} /t REG_SZ /d "${root}" /f`, {
      windowsHide: true,
      stdio: "ignore",
    });
  } catch {}
  try {
    const m = getMarkerPath();
    fs.mkdirSync(path.dirname(m), { recursive: true });
    fs.writeFileSync(m, JSON.stringify({ root, savedAt: new Date().toISOString() }));
  } catch {}
}

function loadPortableRoot() {
  try {
    const out = execSync(`reg query "${REG_KEY}" /v ${REG_VALUE}`, {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = out.match(/REG_SZ\s+(.+)$/m);
    if (m) {
      const r = m[1].trim();
      if (r && fs.existsSync(r)) return r;
    }
  } catch {}
  try {
    const m = getMarkerPath();
    if (fs.existsSync(m)) {
      const parsed = JSON.parse(fs.readFileSync(m, "utf8"));
      if (parsed && parsed.root && fs.existsSync(parsed.root)) return parsed.root;
    }
  } catch {}
  return null;
}

function getPortableRoot() {
  // 1) Explicit override always wins.
  if (process.env.INDEXARC_ROOT) {
    const r = path.resolve(process.env.INDEXARC_ROOT);
    savePortableRoot(r);
    return r;
  }
  // 2) Dev Electron: isolated sandbox so we NEVER touch the real project vault.
  if (!app.isPackaged) {
    return path.join(process.cwd(), ".desktop-sandbox");
  }
  // 3) Restored root from a previous run (survives reinstall/update). If it
  //    still holds the user's data, always reuse it — never start fresh.
  const restored = loadPortableRoot();
  if (restored) return restored;
  // 4) First real run: place the vault next to the exe if writable, else
  //    fall back to the user-writable AppData folder.
  const exeDir = path.dirname(process.execPath);
  let chosen = exeDir;
  try {
    const probe = path.join(exeDir, ".indexarc-write-test");
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
  } catch {
    chosen = app.getPath("userData");
  }
  // 5) Migration safety: if the chosen location is empty but a prior location
  //    (previous install dir, userData, or the AppData marker's parent) already
  //    has data, use that instead so updating never loses the vault.
  if (!findExistingVaultRoot([chosen])) {
    let prevInstall = null;
    try {
      const out = execSync(`reg query "HKCU\\Software\\IndexArc" /v InstallLocation`, {
        windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      });
      const m = out.match(/REG_SZ\s+(.+)$/m);
      if (m) prevInstall = m[1].trim();
    } catch {}
    const alt = findExistingVaultRoot([
      prevInstall,
      app.getPath("userData"),
      path.join(os.homedir(), ".IndexArc"),
      path.dirname(getMarkerPath()),
    ]);
    if (alt) chosen = alt;
  }
  savePortableRoot(chosen);
  return chosen;
}

function getResourcePath() {
  if (!app.isPackaged) {
    return process.cwd();
  }
  // electron-builder: app files live under resources/app (asar:false)
  const candidates = [
    path.join(process.resourcesPath, "app"),
    process.resourcesPath,
    path.dirname(process.execPath),
  ];
  for (const c of candidates) {
    if (fs.existsSync(path.join(c, "dist", "server.cjs"))) return c;
    if (fs.existsSync(path.join(c, "electron-main.cjs"))) return c;
  }
  return path.join(process.resourcesPath, "app");
}

function getTrayIcon() {
  const candidates = [
    path.join(getResourcePath(), "public", "Logo1.png"),
    path.join(process.resourcesPath, "app", "public", "Logo1.png"),
    path.join(getResourcePath(), "assets", "icon.png"),
    path.join(process.cwd(), "public", "Logo1.png"),
    path.join(process.cwd(), "assets", "icon.png"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch {}
  }
  // Fallback: a tiny generated icon so the tray never fails to create.
  return nativeImage.createFromDataURL(
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAOklEQVR4nO3TMQEAAAgEoNP+nmZHwAYW0EudCRAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAg8Bv0AgfXC/0W0QAAAABJRU5ErkJggg=="
  );
}

function showWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(getTrayIcon());
  } catch (e) {
    logCrash("tray", e);
    return;
  }
  tray.setToolTip("IndexArc Vault");
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open IndexArc", click: () => showWindow() },
    { type: "separator" },
    {
      label: "Exit",
      click: () => {
        isQuiting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("click", () => showWindow());
}

function findOllamaPath() {
  const candidates = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    path.join(process.env.PROGRAMFILES || "", "Ollama", "ollama.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Ollama", "ollama.exe"),
    "ollama.exe",
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  try {
    const found = execSync("where.exe ollama", { encoding: "utf-8" })
      .trim()
      .split("\n")[0];
    if (found && fs.existsSync(found)) return found;
  } catch {}
  return null;
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const request = (u) =>
      https
        .get(u, (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return request(res.headers.location);
          }
          if (!res.statusCode || res.statusCode !== 200) {
            reject(new Error("Download failed: " + res.statusCode));
            return;
          }
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve(undefined)));
          res.on("error", reject);
        })
        .on("error", reject);
    request(url);
  });
}

async function installOllama() {
  const url = "https://ollama.com/download/OllamaSetup.exe";
  const tmp = path.join(os.tmpdir(), `ollama-setup-${Date.now()}.exe`);
  try {
    await downloadFile(url, tmp);
    await new Promise((resolve, reject) => {
      const inst = spawn(tmp, ["/S"], { stdio: "ignore" });
      inst.on("exit", (code) => resolve(code));
      inst.on("error", reject);
    });
    await new Promise((r) => setTimeout(r, 1500));
    const p = findOllamaPath();
    return { ok: !!p, path: p };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

ipcMain.handle("check-ollama-installed", async () => {
  return !!findOllamaPath();
});

ipcMain.handle("start-ollama", async () => {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return true;
  } catch {}
  const p = findOllamaPath();
  if (!p) return false;
  try {
    spawn(p, ["serve"], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("install-ollama", async () => {
  return await installOllama();
});

ipcMain.handle("open-external", async (_e, url) => {
  try {
    shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

async function startOllamaIfNeeded() {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      console.log("Ollama is already running.");
      return;
    }
  } catch {}

  console.log("Ollama is not running. Attempting to start…");
  const ollamaPaths = [
    path.join(process.env.LOCALAPPDATA || "", "Programs", "Ollama", "ollama.exe"),
    path.join(process.env.PROGRAMFILES || "", "Ollama", "ollama.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Ollama", "ollama.exe"),
    "ollama.exe",
  ];

  let ollamaPath = null;
  for (const p of ollamaPaths) {
    try {
      if (p && fs.existsSync(p)) {
        ollamaPath = p;
        break;
      }
    } catch {}
  }
  if (!ollamaPath) {
    try {
      ollamaPath = execSync("where.exe ollama", { encoding: "utf-8" })
        .trim()
        .split("\n")[0];
    } catch {}
  }
  if (!ollamaPath) {
    console.log("Ollama not found — local AI optional.");
    return;
  }

  ollamaProcess = spawn(ollamaPath, ["serve"], {
    detached: true,
    stdio: "ignore",
  });
  ollamaProcess.unref();

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch("http://127.0.0.1:11434/api/tags", {
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        console.log("Ollama started.");
        return;
      }
    } catch {}
  }
}

function startBackendServer() {
  const resourcePath = getResourcePath();
  const portableRoot = getPortableRoot();
  const serverPath = path.join(resourcePath, "dist", "server.cjs");
  const distDir = path.join(resourcePath, "dist");

  // Ensure portable folders exist next to exe / project
  for (const sub of ["data", "config", "logs", "tmp"]) {
    const d = path.join(portableRoot, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  console.log(`Portable root: ${portableRoot}`);
  console.log(`Starting vault server: ${serverPath}`);

  serverProcess = fork(serverPath, [], {
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      NODE_ENV: "production",
      INDEXARC_ROOT: portableRoot,
      INDEXARC_DIST_DIR: distDir,
    },
    silent: false,
  });

  serverProcess.on("close", (code) => {
    console.log(`Backend closed: ${code}`);
  });
  serverProcess.on("error", (err) => {
    console.error("Backend failed:", err);
  });
}

function pollServerAndLoad(url, window, attempts = 0) {
  if (attempts > 120) {
    console.error("Server failed to start.");
    app.quit();
    return;
  }
  http
    .get(`http://127.0.0.1:${PORT}/api/ping`, (res) => {
      if (res.statusCode === 200) {
        window.loadURL(url);
        if (!app.isPackaged) {
          window.webContents.openDevTools({ mode: "detach" });
        }
      } else {
        setTimeout(() => pollServerAndLoad(url, window, attempts + 1), 400);
      }
    })
    .on("error", () => {
      setTimeout(() => pollServerAndLoad(url, window, attempts + 1), 400);
    });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 960,
    minHeight: 640,
    title: "IndexArc Vault",
    icon: path.join(getResourcePath(), "public", "Logo1.png"),
    backgroundColor: "#020617",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      spellcheck: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  Menu.setApplicationMenu(null);
  pollServerAndLoad(`http://127.0.0.1:${PORT}`, mainWindow);

  // Closing the window sends the app to the tray instead of quitting.
  mainWindow.on("close", (e) => {
    if (!isQuiting) {
      e.preventDefault();
      mainWindow.hide();
      return;
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  createTray();
}

ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Folder",
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

app.on("ready", async () => {
  try {
    await startOllamaIfNeeded();
    startBackendServer();
    createWindow();
  } catch (e) {
    logCrash("ready", e);
  }
});

app.on("window-all-closed", () => {
  // With a tray, keep the app running when all windows are closed
  // (except on macOS where the convention is to quit).
  if (process.platform === "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

app.on("will-quit", () => {
  if (tray) {
    try {
      tray.destroy();
    } catch {}
  }
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {}
  }
});
