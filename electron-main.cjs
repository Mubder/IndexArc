const { app, BrowserWindow, Menu } = require("electron");
const { fork } = require("child_process");
const path = require("path");
const http = require("http");

let serverProcess = null;
let mainWindow = null;
const PORT = 3000;

// Set env for production by default in desktop mode
process.env.NODE_ENV = "production";

function startBackendServer() {
  const serverPath = path.join(__dirname, "dist", "server.cjs");
  
  console.log(`Starting backend database server from: ${serverPath}`);
  
  // Fork the Express backend as a child process
  serverProcess = fork(serverPath, [], {
    env: { 
      ...process.env, 
      PORT: PORT.toString(),
      NODE_ENV: "production"
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
  if (attempts > 30) {
    console.error("Failed to connect to local database server after 30 attempts.");
    app.quit();
    return;
  }

  http.get(`http://localhost:${PORT}/api/status`, (res) => {
    if (res.statusCode === 200) {
      console.log("Local server is online! Loading desktop interface.");
      window.loadURL(url);
    } else {
      setTimeout(() => pollServerAndLoad(url, window, attempts + 1), 200);
    }
  }).on("error", () => {
    setTimeout(() => pollServerAndLoad(url, window, attempts + 1), 200);
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
      sandbox: true
    },
    icon: path.join(__dirname, "public", "favicon.ico") // Fallback icon path
  });

  // Remove the standard menu bar for a clean, application-like feel
  Menu.setApplicationMenu(null);

  const localUrl = `http://localhost:${PORT}`;
  
  // Wait until server starts responding before loading
  pollServerAndLoad(localUrl, mainWindow);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

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
