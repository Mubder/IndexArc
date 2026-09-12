const { app, BrowserWindow, Menu, MenuItem, dialog, ipcMain, Tray, nativeImage, shell } = require("electron");
const { fork, spawn } = require("child_process");
const path = require("path");
const http = require("http");
const https = require("https");
const fs = require("fs");
const os = require("os");
const { execSync, execFileSync } = require("child_process");
const crypto = require("crypto");

// ── Note editor spellchecker ──
// Chromium has no Arabic Hunspell dict, so the note editor keeps spellCheck
// OFF and we run our own bilingual pipeline:
//   • Primary: LanguageTool (local server or public API)
//   • Fallback: ArabicSpellEngine (SymSpell + morphology) + EnglishSpellEngine (SymSpell)
const {
  isArabicToken,
  isLatinToken,
  stripArabicDiacritics,
  checkArabicWord,
  suggestArabicWord,
  checkEnglishWord,
  suggestEnglishWord,
  findMisspelled,
  loadArabicEngine,
  loadEnglishEngine,
  loadUserDictionary,
  addCustomWord,
  initLanguageTool,
  getLanguageTool,
} = require("./shared/spellcheck.cjs");

let arSpell = null; // ArabicSpellEngine
let enSpell = null; // EnglishSpellEngine (SymSpell)
let ltService = null; // LanguageTool

function getUserDictPath() {
  try {
    return path.join(getPortableRoot(), "config", "user_dict.txt");
  } catch {
    return null;
  }
}

function loadEnglishDict() {
  try {
    const dir = path.join(getResourcePath(), "dictionaries", "en");
    const dicPath = path.join(dir, "en.dic");
    if (!fs.existsSync(dicPath)) {
      console.log(`[spellcheck] en.spell: dictionary file not found at ${dicPath}`);
      console.log("[spellcheck] en.spell: falling back to LanguageTool for English spelling");
    }
    const enEngine = loadEnglishEngine(dir);
    if (enEngine && enEngine.loaded) {
      console.log(`[spellcheck] en (SymSpell) dictionary loaded (${enEngine.wordCount} words)`);
      return enEngine;
    }
    console.log("[spellcheck] en.spell: engine loaded but not ready, using LanguageTool fallback");
    return null;
  } catch (e) {
    console.log(`[spellcheck] en dictionary load failed: ${e && e.message ? e.message : e}`);
    console.log("[spellcheck] en.spell: falling back to LanguageTool for English spelling");
    return null;
  }
}

function loadSpellcheckers() {
  const arDir = path.join(getResourcePath(), "dictionaries", "ar");
  const arDicPath = path.join(arDir, "ar.dic");
  if (!fs.existsSync(arDicPath)) {
    console.log(`[spellcheck] ar.spell: dictionary file not found at ${arDicPath}`);
  }
  arSpell = loadArabicEngine(arDir);
  if (arSpell && arSpell.loaded) {
    console.log(`[spellcheck] ar engine ready (${arSpell.wordCount} words)`);
  } else if (arSpell) {
    console.log("[spellcheck] ar engine loaded but dictionary not ready");
  } else {
    console.log("[spellcheck] ar engine failed to load");
  }
  enSpell = loadEnglishDict();

  const userDictPath = getUserDictPath();
  if (userDictPath && fs.existsSync(userDictPath)) {
    loadUserDictionary(userDictPath, arSpell, enSpell);
  }
  const ignoredDictPath = userDictPath ? path.join(path.dirname(userDictPath), "ignored_words.txt") : null;
  if (ignoredDictPath && fs.existsSync(ignoredDictPath)) {
    loadUserDictionary(ignoredDictPath, arSpell, enSpell);
  }

  initLanguageTool().then(() => {
    const lt = getLanguageTool();
    console.log(`[spellcheck] LanguageTool mode: ${lt.getMode()}`);
  }).catch((e) => {
    console.log(`[spellcheck] LanguageTool init failed: ${e && e.message ? e.message : e}`);
  });
}

function isArabicWord(word) {
  return isArabicToken(word);
}

function isLatinWord(word) {
  return isLatinToken(word);
}

function logCrash(tag, e) {
  try {
    const f = path.join(os.tmpdir(), "indexarc-crash.log");
    // Rotate at 1 MiB so a crash loop can never grow the file unbounded in
    // shared temp; keep exactly one previous generation.
    try {
      if (fs.existsSync(f) && fs.statSync(f).size > 1024 * 1024) {
        const old = f + ".1";
        try {
          fs.unlinkSync(old);
        } catch {}
        fs.renameSync(f, old);
      }
    } catch {}
    fs.appendFileSync(
      f,
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
      // A vault is either encrypted entries (vault.json) or scratchpad notes —
      // scratchpad-only users never create vault.json, and ignoring their data
      // made the portable root flap between folders.
      for (const f of ["vault.json", "scratchpad.json"]) {
        const v = path.join(c, "data", f);
        if (fs.existsSync(v) && fs.statSync(v).size > 0) return c;
      }
    } catch {}
  }
  return null;
}

function savePortableRoot(root) {
  try {
    // Persist to registry (preferred) and a marker file (fallback).
    // execFileSync with an argument array: no shell, so a root path can
    // never break quoting and inject shell syntax.
    execFileSync("reg", ["add", REG_KEY, "/v", REG_VALUE, "/t", "REG_SZ", "/d", root, "/f"], {
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

function regQuery(key, value) {
  try {
    return execFileSync("reg", ["query", key, "/v", value], {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return "";
  }
}

function loadPortableRoot() {
  // A persisted root is only trustworthy if it still holds data — an empty
  // (or dev-artifact) folder must never hijack the portable root.
  const out = regQuery(REG_KEY, REG_VALUE);
  const m = out.match(/REG_SZ\s+(.+)$/m);
  if (m) {
    const r = m[1].trim();
    if (r && fs.existsSync(r) && findExistingVaultRoot([r])) return r;
  }
  try {
    const m = getMarkerPath();
    if (fs.existsSync(m)) {
      const parsed = JSON.parse(fs.readFileSync(m, "utf8"));
      if (parsed && parsed.root && fs.existsSync(parsed.root) && findExistingVaultRoot([parsed.root])) {
        return parsed.root;
      }
    }
  } catch {}
  return null;
}

function isWritableDir(dir) {
  try {
    const probe = path.join(dir, ".indexarc-write-test");
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

// PORTABLE-FIRST root resolution.
// The whole point of this app is a self-contained folder you can copy or run
// from a USB stick. So the folder next to the executable ALWAYS wins when it
// already holds data (or can hold it). The registry/AppData marker is only a
// SECONDARY safety net for the installed build, used when the exe folder can't
// be the home (e.g. installed into Program Files under a read-only location).
function getPortableRoot() {
  // 1) Explicit override always wins (dev, tests, power users).
  if (process.env.INDEXARC_ROOT) {
    const r = path.resolve(process.env.INDEXARC_ROOT);
    savePortableRoot(r);
    return r;
  }
  // 2) Dev Electron: isolated sandbox so we NEVER touch the real project vault.
  if (!app.isPackaged) {
    return path.join(process.cwd(), ".desktop-sandbox");
  }

  const exeDir = path.dirname(process.execPath);

  // The "portable" target is a self-extractor: it unpacks the real app into a
  // TEMP dir (which its launcher RMDir /r's when the app exits) and sets
  // PORTABLE_EXECUTABLE_DIR to the folder the user actually keeps the .exe
  // in. The temp dir must NEVER become the vault root — data written there
  // is destroyed on every exit.
  const portableExeDir = process.env.PORTABLE_EXECUTABLE_DIR
    ? path.resolve(process.env.PORTABLE_EXECUTABLE_DIR)
    : null;

  // 3) PORTABLE: if the real exe folder already has a vault, it is the home.
  //    Period. (exeDir is still honored for unpacked/dir builds.)
  const localHome = findExistingVaultRoot([portableExeDir, exeDir]);
  if (localHome) {
    savePortableRoot(localHome);
    return localHome;
  }

  // 4) No data next to the exe yet. Before creating a fresh one, look for an
  //    existing vault anywhere we might have left it, so an update/reinstall or
  //    a moved exe never orphans the user's data. Portable-preferred order.
  let prevInstall = null;
  {
    const out = regQuery("HKCU\\Software\\IndexArc", "InstallLocation");
    const m = out.match(/REG_SZ\s+(.+)$/m);
    if (m) prevInstall = m[1].trim();
  }
  const existing = findExistingVaultRoot([
    portableExeDir,
    loadPortableRoot(),
    prevInstall,
    app.getPath("userData"),
    path.join(os.homedir(), ".IndexArc"),
    path.dirname(getMarkerPath()),
  ]);
  if (existing) {
    savePortableRoot(existing);
    return existing;
  }

  // 5) Genuine first run: prefer the portable location (the folder holding
  //    the .exe — NOT the self-extractor's temp dir) if it is writable;
  //    otherwise fall back to a user-writable AppData folder.
  const home = portableExeDir || exeDir;
  const chosen = isWritableDir(home) ? home : app.getPath("userData");
  savePortableRoot(chosen);
  return chosen;
}

function getResourcePath() {
  if (!app.isPackaged) {
    return process.cwd();
  }
  const appUnpacked = path.join(process.resourcesPath, "app.asar.unpacked");
  const appAsar = path.join(process.resourcesPath, "app.asar");
  const appDir = path.join(process.resourcesPath, "app");

  if (fs.existsSync(appUnpacked)) return appUnpacked;
  if (fs.existsSync(appDir)) return appDir;
  if (fs.existsSync(appAsar)) return appAsar;
  return process.resourcesPath;
}

function getTrayIcon() {
  const candidates = [
    path.join(process.resourcesPath, "app.asar.unpacked", "dist", "Logo1.png"),
    path.join(process.resourcesPath, "app.asar", "dist", "Logo1.png"),
    path.join(getResourcePath(), "dist", "Logo1.png"),
    path.join(getResourcePath(), "public", "Logo1.png"),
    path.join(getResourcePath(), "assets", "icon.png"),
    path.join(process.cwd(), "public", "Logo1.png"),
    path.join(process.cwd(), "assets", "icon.png"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch {}
  }
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
    const found = execFileSync("where.exe", ["ollama"], { encoding: "utf-8", windowsHide: true })
      .trim()
      .split("\n")[0];
    if (found && fs.existsSync(found)) return found;
  } catch {}
  return null;
}

function downloadFile(url, dest, maxBytes = 2 * 1024 * 1024 * 1024) {
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
          const declared = Number(res.headers["content-length"] || 0);
          if (declared && declared > maxBytes) {
            reject(new Error(`Download too large (${declared} bytes > cap ${maxBytes})`));
            res.destroy();
            return;
          }
          let received = 0;
          res.on("data", (chunk) => {
            received += chunk.length;
            if (received > maxBytes) {
              reject(new Error(`Download exceeded size cap (${maxBytes} bytes)`));
              res.destroy();
            }
          });
          const file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve(undefined)));
          res.on("error", reject);
        })
        .on("error", reject);
    request(url);
  });
}

// Verify the downloaded installer's Authenticode signature BEFORE executing
// it: status must be Valid and the signer must be Ollama. Executing
// unverifiable code downloaded over the network is the one path in this app
// that turns a network attacker into code execution — it stays gated.
function verifyAuthenticode(file, expectedSubjectPart) {
  const safePath = file.replace(/'/g, "''");
  const script =
    `$sig = Get-AuthenticodeSignature -FilePath '${safePath}'; ` +
    `if ($sig.Status -ne 'Valid') { exit 2 }; ` +
    `if ($sig.SignerCertificate.Subject -notlike '*${expectedSubjectPart}*') { exit 3 }; ` +
    `exit 0`;
  try {
    execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }
    );
    return true;
  } catch {
    return false;
  }
}

async function installOllama() {
  const url = "https://ollama.com/download/OllamaSetup.exe";
  const tmp = path.join(os.tmpdir(), `ollama-setup-${Date.now()}.exe`);
  try {
    await downloadFile(url, tmp);
    if (!verifyAuthenticode(tmp, "Ollama")) {
      return {
        ok: false,
        error: "Downloaded Ollama installer failed signature verification — execution blocked. Download manually from https://ollama.com/download",
      };
    }
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
    if (typeof url !== "string") return false;
    const parsed = new URL(url);
    const allowedSchemes = ["http:", "https:", "mailto:"];
    if (!allowedSchemes.includes(parsed.protocol)) return false;
    await shell.openExternal(url);
    return true;
  } catch {
    return false;
  }
});

// The embedded vault server exports its pairing token via process.env
// (server/auth.ts). The renderer fetches it once through this bridge and
// presents it as the X-IndexArc-Token header on every /api call — a plain
// web page can never obtain it, which is what blocks rebinding/CSRF.
ipcMain.handle("get-api-token", () => process.env.INDEXARC_API_TOKEN || null);

// Check a batch of words (English and/or Arabic, mixed-language notes are
// the whole point) and return the ones that are misspelled.
ipcMain.handle("spellcheck-words", async (_e, words) => {
  return await findMisspelled(words, arSpell, enSpell);
});

ipcMain.handle("spellcheck-suggest", async (_e, word) => {
  if (typeof word !== "string" || !word.trim()) return [];
  const w = word.trim();
  if (isArabicToken(w)) {
    return await suggestArabicWord(w, arSpell, 8);
  }
  return await suggestEnglishWord(w, enSpell, 6);
});

ipcMain.handle("add-custom-word", async (_e, word) => {
  if (typeof word === "string" && word.trim()) {
    addCustomWord(word.trim(), getUserDictPath(), arSpell, enSpell);
  }
  return true;
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
      ollamaPath = execFileSync("where.exe", ["ollama"], { encoding: "utf-8", windowsHide: true })
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

function getAppIcon() {
  const res = getResourcePath();
  const candidates = [
    path.join(res, "dist", "Logo1.png"),
    path.join(res, "public", "Logo1.png"),
    path.join(res, "assets", "icon.png"),
    path.join(process.resourcesPath, "app", "dist", "Logo1.png"),
    path.join(process.resourcesPath, "app", "public", "Logo1.png"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return nativeImage.createFromPath(p);
    } catch {}
  }
  return getTrayIcon();
}

// OS-keychain-bound key for encrypting API keys inside settings.json
// (DPAPI on Windows, Keychain on macOS, libsecret on Linux). The key never
// exists in plaintext on disk — only safeStorage can unwrap it, so the
// settings file is unreadable off this user profile. Absent support (or a
// dev run), the server falls back to plaintext with a log warning.
function initSettingsSecretsKey(root) {
  try {
    if (!app.isPackaged) return; // dev sandbox: exercise the fallback path
    const { safeStorage } = require("electron");
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return;
    const keyFile = path.join(root, "config", "settings.key.enc");
    let key = null;
    if (fs.existsSync(keyFile)) {
      try {
        const candidate = safeStorage.decryptString(fs.readFileSync(keyFile));
        if (candidate && Buffer.from(candidate, "base64").length === 32) key = candidate;
      } catch {}
    }
    if (!key) {
      key = crypto.randomBytes(32).toString("base64");
      fs.mkdirSync(path.join(root, "config"), { recursive: true });
      fs.writeFileSync(keyFile, safeStorage.encryptString(key));
    }
    process.env.INDEXARC_SETTINGS_KEY = key;
  } catch (e) {
    logCrash("settings-key", e);
  }
}

function startBackendServer() {
  const portableRoot = getPortableRoot();
  initSettingsSecretsKey(portableRoot);

  const candidateServerPaths = [
    path.join(process.resourcesPath, "app.asar.unpacked", "dist", "server.cjs"),
    path.join(process.resourcesPath, "app", "dist", "server.cjs"),
    path.join(process.resourcesPath, "app.asar", "dist", "server.cjs"),
    path.join(__dirname, "dist", "server.cjs"),
    path.join(getResourcePath(), "dist", "server.cjs"),
  ];

  let serverPath = candidateServerPaths.find((p) => fs.existsSync(p)) || candidateServerPaths[0];
  let distDir = path.dirname(serverPath);

  // Fail LOUDLY instead of booting to a blank window: a package without the
  // backend bundle (dist/server.cjs) can never serve the UI.
  if (!fs.existsSync(serverPath)) {
    const msg =
      "The backend server bundle is missing from this installation:\n\n" +
      serverPath +
      "\n\nThe application cannot start. The package was built incompletely — rebuild with: npm run desktop:win";
    console.error("[embedded-server] " + msg);
    try {
      dialog.showErrorBox("IndexArc — build incomplete", msg);
    } catch {}
    app.exit(1);
    return;
  }

  // Ensure portable folders exist next to exe / project
  for (const sub of ["data", "config", "logs", "tmp"]) {
    const d = path.join(portableRoot, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  process.env.PORT = String(PORT);
  process.env.HOST = "127.0.0.1";
  process.env.NODE_ENV = "production";
  process.env.INDEXARC_ROOT = portableRoot;
  process.env.INDEXARC_DIST_DIR = distDir;

  console.log(`Portable root: ${portableRoot}`);
  console.log(`Starting vault server: ${serverPath}`);

  try {
    require(serverPath);
    console.log("[embedded-server] Express vault server embedded cleanly in main process");
  } catch (err) {
    console.error("[embedded-server] Failed to require serverPath directly, attempting fork fallback:", err);
    serverProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
      },
      execPath: process.execPath,
      silent: false,
    });

    serverProcess.on("close", (code) => {
      console.log(`Backend closed: ${code}`);
    });
    serverProcess.on("error", (err) => {
      console.error("Backend failed:", err);
    });
  }
}

// The embedded server publishes its ACTUAL bound port via env — it walks off
// the preferred port when something already squats it, so the shell must
// never assume 3000.
function waitForServerPort(window, attempts = 0) {
  const port = Number(process.env.INDEXARC_ACTUAL_PORT) || 0;
  if (port) {
    pollServerAndLoad(`http://127.0.0.1:${port}`, window);
    return;
  }
  if (attempts > 150) {
    console.error("Backend never reported its listening port.");
    app.quit();
    return;
  }
  setTimeout(() => waitForServerPort(window, attempts + 1), 100);
}

function expectedServerId() {
  const t = process.env.INDEXARC_API_TOKEN;
  return t ? crypto.createHash("sha256").update(t).digest("hex").slice(0, 16) : null;
}

function pollServerAndLoad(url, window, attempts = 0) {
  if (attempts > 120) {
    console.error("Server failed to start.");
    app.quit();
    return;
  }
  http
    .get(`${url}/api/ping`, (res) => {
      if (res.statusCode === 200) {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          // Identity check: a bare 200 proves nothing — whatever squatted
          // the port could have answered. Only load content from a server
          // that proves it holds OUR per-process token.
          let serverId = null;
          try {
            serverId = JSON.parse(body).server_id;
          } catch {}
          const expected = expectedServerId();
          if (!expected || serverId !== expected) {
            console.error(`[security] Server identity mismatch on ${url} — refusing to load window content.`);
            dialog.showErrorBox(
              "IndexArc — server verification failed",
              "The local vault server could not be verified (another application may be interfering with local ports). The application will close."
            );
            app.quit();
            return;
          }
          window.loadURL(url);
          if (!app.isPackaged) {
            window.webContents.openDevTools({ mode: "detach" });
          }
        });
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
    icon: getAppIcon(),
    backgroundColor: "#020617",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  Menu.setApplicationMenu(null);

  // The main window may ONLY ever display the embedded local server. Any
  // other navigation (compromised renderer, crafted link, redirect) is
  // vetoed outright — this is the last line between a web page and the
  // preload bridge.
  mainWindow.webContents.on("will-navigate", (e, url) => {
    try {
      const u = new URL(url);
      const ok =
        u.protocol === "http:" &&
        (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
        u.port === String(Number(process.env.INDEXARC_ACTUAL_PORT) || PORT);
      if (!ok) {
        console.log(`[security] Blocked navigation to ${url}`);
        e.preventDefault();
      }
    } catch {
      e.preventDefault();
    }
  });

  // A secrets vault has no legitimate use for media, geolocation,
  // notifications, or any other web permission — deny everything by default.
  try {
    mainWindow.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    );
  } catch (_) {
    /* permission handler is best-effort */
  }

  // Open any external link (e.g. target="_blank") in the OS default browser
  // instead of spawning a new Electron window. Same parsed-URL scheme
  // allowlist as the open-external IPC — no regex shortcuts.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (["http:", "https:", "mailto:"].includes(parsed.protocol)) {
        shell.openExternal(url);
      }
    } catch {}
    return { action: "deny" };
  });

  try {
    const ses = mainWindow.webContents.session;
    const available = ses.availableSpellCheckerLanguages || [];
    // Prefer English + Arabic; fall back to whatever Chromium actually ships.
    // Note: Chromium's Hunspell spellchecker may not include Arabic on all
    // platforms, so we filter against the available list to avoid errors.
    const wanted = ["en-US", "ar"];
    const langs = wanted.filter((l) => available.includes(l));
    if (langs.length) ses.setSpellCheckerLanguages(langs);
    console.log(`[spellcheck] enabled: ${langs.join(", ") || "none"} (available: ${available.length})`);
  } catch (_) {
    /* spellchecker language setup is best-effort */
  }

  // Right-click spelling suggestions + standard edit actions
  mainWindow.webContents.on("context-menu", async (_event, params) => {
    const menu = new Menu();

    // English (and other Chromium-supported languages): native suggestions.
    for (const suggestion of params.dictionarySuggestions) {
      menu.append(
        new MenuItem({
          label: suggestion,
          click: () => mainWindow.webContents.replaceMisspelling(suggestion),
        })
      );
    }

    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length) {
        menu.append(new MenuItem({ type: "separator" }));
      } else {
        menu.append(new MenuItem({ label: "No suggestions", enabled: false }));
        menu.append(new MenuItem({ type: "separator" }));
      }
      menu.append(
        new MenuItem({
          label: `Add "${params.misspelledWord}" to dictionary`,
          click: () => {
            try {
              mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
              addCustomWord(params.misspelledWord, getUserDictPath(), arSpell, enSpell);
            } catch (_) {}
          },
        })
      );
      menu.append(new MenuItem({ type: "separator" }));
    }

    // Custom spellcheck right-click menu (Arabic and, for the note editor
    // where Chromium's native checker is disabled, English too): check the
    // word under the cursor ourselves whenever the native checker didn't
    // already flag something, so suggestions never get duplicated for
    // fields where the native English checker is active.
    if ((arSpell || enSpell) && params.isEditable && !params.misspelledWord) {
      const word = (params.selectionText || "").trim();
      const isAr = isArabicWord(word);
      const isEn = !isAr && isLatinWord(word);
      const engine = isAr ? arSpell : isEn ? enSpell : null;
      const misspelled = isAr
        ? !(await checkArabicWord(word, arSpell))
        : isEn
          ? !(await checkEnglishWord(word, enSpell))
          : false;

      if ((engine || (isAr && arSpell)) && misspelled) {
        const suggestions = isAr
          ? await suggestArabicWord(word, arSpell, 8)
          : await suggestEnglishWord(word, enSpell, 6);

        if (suggestions.length) {
          for (const s of suggestions) {
            menu.append(
              new MenuItem({
                label: s,
                click: () => mainWindow.webContents.replace(s),
              })
            );
          }
        } else {
          menu.append(new MenuItem({ label: "No suggestions", enabled: false }));
        }
        menu.append(new MenuItem({ type: "separator" }));
        menu.append(
          new MenuItem({
            label: `Add "${word}" to dictionary`,
            click: () => {
              try {
                addCustomWord(word, getUserDictPath(), arSpell, enSpell);
                mainWindow.webContents.session.addWordToSpellCheckerDictionary(word);
              } catch (_) {}
            },
          })
        );
        menu.append(
          new MenuItem({
            label: `Ignore "${word}"`,
            click: () => {
              try {
                addCustomWord(word, getUserDictPath(), arSpell, enSpell);
              } catch (_) {}
            },
          })
        );
        menu.append(new MenuItem({ type: "separator" }));
      }
    }

    const canEdit = params.isEditable;
    menu.append(new MenuItem({ label: "Cut", role: "cut", enabled: canEdit && !!params.selectionText }));
    menu.append(new MenuItem({ label: "Copy", role: "copy", enabled: !!params.selectionText }));
    menu.append(new MenuItem({ label: "Paste", role: "paste", enabled: canEdit }));
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(new MenuItem({ label: "Select All", role: "selectAll" }));

    menu.popup({ window: mainWindow });
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    // Dev-only: in packaged builds renderer output must not be forwarded to
    // stdout, where redirected logs previously captured full note bodies.
    if (!app.isPackaged) {
      console.log(`[RENDERER ${level}] ${message} (${sourceId}:${line})`);
    }
  });

  waitForServerPort(mainWindow);

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
    loadSpellcheckers();
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
  // Flush any pending emergency snapshot before the process dies. The vault
  // may live in the install folder, which the next reinstall's uninstaller
  // deletes — this keeps the machine-level copy (%APPDATA%) current so a
  // restore never loses the last few minutes of changes.
  try {
    if (typeof globalThis.__indexarcFlushEmergency === "function") {
      globalThis.__indexarcFlushEmergency();
    }
  } catch {}
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
