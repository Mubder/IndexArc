const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const { fork } = require("child_process");
const path = require("path");
const http = require("http");

let serverProcess = null;
let mainWindow = null;
const PORT = 3000;

// Resolve paths for packaged app
function getResourcePath() {
  // In development: project root
  // In packaged app: resources/app.asar.unpacked or resources/app
  // Check if we're running from electron's installed location (node_modules/electron)
  const isDev = !app.isPackaged;
  
  if (isDev) {
    return process.cwd();
  }
  // electron-builder puts resources in process.resourcesPath
  return path.join(process.resourcesPath, "app");
}

function startBackendServer() {
  const resourcePath = getResourcePath();
  const serverPath = path.join(resourcePath, "dist", "server.cjs");
  const dataDir = path.join(app.getPath("userData"), "indexarc-data");
  const distDir = path.join(resourcePath, "dist");
  
  console.log(`Resource path: ${resourcePath}`);
  console.log(`Starting backend database server from: ${serverPath}`);
  console.log(`Data directory: ${dataDir}`);
  console.log(`Dist directory: ${distDir}`);

  // Fork the Express backend as a child process
  serverProcess = fork(serverPath, [], {
    env: { 
      ...process.env, 
      PORT: PORT.toString(),
      NODE_ENV: "production",
      INDEXARC_DATA_DIR: dataDir,
      INDEXARC_DIST_DIR: distDir
    },
    silent: false
  });

  serverProcess.on("close", (code) => {
    console.log(`Backend server closed with code: ${code}`);
  });

  serverProcess.on("error", (err) => {
    console.error("Failed to start backend server process:", err);
  });
}

function pollServerAndLoad(url, window, attempts = 0) {
  if (attempts > 120) {
    console.error("Failed to connect to local database server after 120 attempts.");
    app.quit();
    return;
  }

  // Use 127.0.0.1 directly to prevent IPv6/IPv4 lookup discrepancy on localhost in Windows
  http.get(`http://127.0.0.1:${PORT}/api/status`, (res) => {
    if (res.statusCode === 200) {
      console.log("Local server is online! Loading desktop interface.");
      window.loadURL(url);
    } else {
      setTimeout(() => pollServerAndLoad(url, window, attempts + 1), 400);
    }
  }).on("error", () => {
    setTimeout(() => pollServerAndLoad(url, window, attempts + 1), 400);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 1024,
    minHeight: 768,
    title: "IndexArc Desktop",
    backgroundColor: "#020617", // Match slate-950 theme color
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: path.join(__dirname, "preload.cjs")
    },
    icon: path.join(__dirname, "public", "favicon.ico") // Fallback icon path
  });

  // Remove the standard menu bar for a clean, application-like feel
  Menu.setApplicationMenu(null);

  const localUrl = `http://127.0.0.1:${PORT}`;
  
  // Wait until server starts responding before loading
  pollServerAndLoad(localUrl, mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC handler for folder picker dialog
ipcMain.handle("select-folder", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
    title: "Select Folder to Watch",
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Ensure background server dies when Electron process dies
app.on("ready", () => {
  startBackendServer();
  createWindow();
});

app.on("window-all-closed", () => {
  // On macOS, apps usually stay active until explicitly quit
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Hard terminate backend on quit
app.on("will-quit", () => {
  if (serverProcess) {
    console.log("Terminating local server daemon...");
    serverProcess.kill();
  }
});
