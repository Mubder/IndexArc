const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const { fork, spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");
const { execSync } = require("child_process");

let serverProcess = null;
let ollamaProcess = null;
let mainWindow = null;
const PORT = Number(process.env.PORT) || 3000;

/**
 * Portable single-folder root:
 * - Dev: project cwd
 * - Packaged: directory containing the executable (USB-safe)
 */
function getPortableRoot() {
  if (process.env.INDEXARC_ROOT) {
    return path.resolve(process.env.INDEXARC_ROOT);
  }
  if (!app.isPackaged) {
    return process.cwd();
  }
  // Portable: data/config next to IndexArc.exe
  return path.dirname(process.execPath);
}

function getResourcePath() {
  if (!app.isPackaged) {
    return process.cwd();
  }
  return path.join(process.resourcesPath, "app");
}

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
    .get(`http://127.0.0.1:${PORT}/api/status`, (res) => {
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
    backgroundColor: "#020617",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  Menu.setApplicationMenu(null);
  pollServerAndLoad(`http://127.0.0.1:${PORT}`, mainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
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
  await startOllamaIfNeeded();
  startBackendServer();
  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

app.on("will-quit", () => {
  if (serverProcess) {
    try {
      serverProcess.kill();
    } catch {}
  }
});
