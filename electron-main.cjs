// @ts-check
const { app, BrowserWindow, Menu, MenuItem, dialog, ipcMain, Tray, nativeImage, shell, clipboard } = require("electron");
const { spawn } = require("child_process");
const { childEnv } = require("./shared/child-env.cjs");
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

/** @type {ReturnType<typeof loadArabicEngine>} */
let arSpell = null; // ArabicSpellEngine
/** @type {ReturnType<typeof loadEnglishEngine>} */
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
    console.log(`[spellcheck] en dictionary load failed: ${e instanceof Error && e.message ? e.message : e}`);
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

/** @param {string} word */
function isArabicWord(word) {
  return isArabicToken(word);
}

/** @param {string} word */
function isLatinWord(word) {
  return isLatinToken(word);
}

/**
 * @param {string} tag
 * @param {any} e anything that was thrown or rejected (not necessarily an Error)
 */
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

// The vault server runs in an Electron utilityProcess (R3.1): Argon2, file
// parsing and regex work can no longer freeze the window, and a crash there
// does not take the shell down. Its secrets are handed over in the child's
// env only — never this process's env, which Ollama/LanguageTool inherit.
/** @type {import("electron").UtilityProcess | null} */
let serverProcess = null;
let backendPort = 0; // reported by the server once it is listening
const apiToken = crypto.randomBytes(32).toString("hex");
/** @type {string | null} */
let settingsKey = null;
let ollamaProcess = null;
/** @typedef {import("electron").BrowserWindow} Win */
// Callbacks registered on the window only run while it exists; they read
// `mainWindow` as a non-null `Win` (a cast, no runtime check).
/** @type {Win | null} */
let mainWindow = null;
/** @type {import("electron").Tray | null} */
let tray = null;
let isQuiting = false;
const PORT = Number(process.env.PORT) || 3000;

// SINGLE INSTANCE: launching the exe again while the app is tray-hidden used
// to start a SECOND full instance with its own server on the next port — its
// window loaded STALE server state while the tray instance still held newer
// unsaved edits in memory, so notes looked wiped until the hidden instance
// saved. A second launch now just restores + focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}

// Render in SOFTWARE. Three independent GPU-compositing failures on consumer
// drivers (constant coil whine; scroll drift; blank unpainted regions where
// the accessibility tree showed every element but the window painted only a
// fragment). Layer tweaks and animation caps were insufficient. A secrets
// vault must render correctly on every machine — correctness beats
// compositing performance, and software raster also eliminates the
// canvas-driven GPU load entirely.
app.disableHardwareAcceleration();

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
/**
 * @param {Array<string | null | undefined>} candidates
 * @returns {string | null}
 */
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

/** @param {string} root */
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

/**
 * @param {string} key
 * @param {string} value
 * @returns {string}
 */
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

/** @param {string} dir */
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
  // 1) Explicit override always wins (dev, tests, power users). It applies
  //    to this launch only: it is NOT saved to the registry/marker, or one
  //    test or dev run would silently repoint the installed app at a
  //    scratch folder on its next start.
  if (process.env.INDEXARC_ROOT) {
    return path.resolve(process.env.INDEXARC_ROOT);
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

/**
 * @param {string} url
 * @param {string} dest
 * @param {number} [maxBytes]
 * @returns {Promise<void>}
 */
function downloadFile(url, dest, maxBytes = 2 * 1024 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    /** @param {string} u */
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
/**
 * @param {string} file
 * @param {string} expectedOrg
 * @returns {boolean}
 */
function verifyAuthenticode(file, expectedOrg) {
  const safePath = file.replace(/'/g, "''");
  // Report status + subject as JSON and decide here: the old
  // `-notlike '*Ollama*'` accepted ANY valid cert whose subject merely
  // contained the word (e.g. "CN=Not Ollama Ltd").
  const script =
    `$sig = Get-AuthenticodeSignature -FilePath '${safePath}'; ` +
    `@{ status = [string]$sig.Status; subject = [string]$sig.SignerCertificate.Subject } | ConvertTo-Json -Compress`;
  try {
    const out = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }
    );
    const { status, subject } = JSON.parse(out);
    return status === "Valid" && signerMatches(subject, expectedOrg);
  } catch {
    return false;
  }
}

/**
 * CN and O of an X.500 subject must both be exactly `org` (an optional Inc./LLC suffix allowed).
 * @param {unknown} subject
 * @param {string} org
 * @returns {boolean}
 */
function signerMatches(subject, org) {
  if (typeof subject !== "string") return false;
  /** @type {Record<string, string>} */
  const rdn = {};
  for (const part of subject.match(/(?:[^,"]|"[^"]*")+/g) || []) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    rdn[part.slice(0, i).trim().toUpperCase()] = part.slice(i + 1).trim().replace(/^"|"$/g, "");
  }
  /** @param {unknown} v */
  const ok = (v) => typeof v === "string" && new RegExp(`^${org}(,? (Inc[.]?|LLC))?$`, "i").test(v);
  return ok(rdn.CN) && ok(rdn.O);
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
      const inst = spawn(tmp, ["/S"], { stdio: "ignore", windowsHide: true, env: childEnv() });
      inst.on("exit", (code) => resolve(code));
      inst.on("error", reject);
    });
    await new Promise((r) => setTimeout(r, 1500));
    const p = findOllamaPath();
    return { ok: !!p, path: p };
  } catch (e) {
    return { ok: false, error: (e instanceof Error && e.message) || String(e) };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

// Every IPC message checks WHO is calling: only the main window's top frame,
// showing our own local server, may reach the bridge (get-api-token hands out
// the vault pairing token). A subframe or any other webContents is refused.
// The logic lives in shared/ipc-trust.cjs (unit-tested).
const ipcTrust = require("./shared/ipc-trust.cjs");
/** @param {string} url */
function isAppUrl(url) {
  return ipcTrust.isAppUrl(url, backendPort || PORT);
}

/** @param {import("electron").IpcMainInvokeEvent | import("electron").IpcMainEvent} e */
function isTrustedSender(e) {
  return ipcTrust.isTrustedSender(e, mainWindow, backendPort || PORT);
}

// Defaults for EVERY webContents, including any created later: no <webview>
// may attach (the tag is off, this is the backstop), no window may open, and
// nothing but the app may be navigated to. The main window then installs its
// own handlers on top (external links open in the OS browser).
app.on("web-contents-created", (_event, contents) => {
  contents.on("will-attach-webview", (e) => {
    console.log("[security] Blocked a <webview> from attaching");
    e.preventDefault();
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
});

/**
 * @param {string} channel
 * @param {(e: import("electron").IpcMainInvokeEvent, ...args: unknown[]) => unknown} fn
 */
function handleTrusted(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (!isTrustedSender(e)) {
      console.log(`[security] Refused IPC "${channel}" from an untrusted sender`);
      return null;
    }
    return fn(e, ...args);
  });
}

handleTrusted("check-ollama-installed", async () => {
  return !!findOllamaPath();
});

handleTrusted("start-ollama", async () => {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags", {
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) return true;
  } catch {}
  const p = findOllamaPath();
  if (!p) return false;
  try {
    spawnOllamaServe(p);
    return true;
  } catch {
    return false;
  }
});

handleTrusted("install-ollama", async () => {
  return await installOllama();
});

handleTrusted("open-external", async (_e, url) => {
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

// The shell mints the pairing token and hands it to the server process
// (server/auth.ts). The renderer fetches it once through this bridge and
// presents it as the X-IndexArc-Token header on every /api call — a plain
// web page can never obtain it, which is what blocks rebinding/CSRF.
handleTrusted("get-api-token", () => apiToken);

// Copy via the OS clipboard in the MAIN process. navigator.clipboard in a
// packaged Electron window rejects silently on focus changes (the click
// itself can unfocus the document), which made every Copy button lie about
// succeeding. The text is never logged.
// Secrets (clearAfterMs > 0) are wiped from the OS clipboard after the delay
// — but only if the clipboard still holds exactly what we put there, so a
// newer copy by the user is never clobbered.
/** @type {NodeJS.Timeout | null} */
let clipboardClearTimer = null;
handleTrusted("copy-text", async (_e, text, clearAfterMs) => {
  if (typeof text !== "string" || text.length === 0 || text.length > 1024 * 1024) return false;
  try {
    // Electron 44: writeText/readText return Promises. Awaiting (via
    // Promise.resolve, so a sync API also works) makes a failed write report
    // false and lets the timed clear compare real text.
    await Promise.resolve(clipboard.writeText(text));
    if (clipboardClearTimer) clearTimeout(clipboardClearTimer);
    clipboardClearTimer = null;
    const delay = Number(clearAfterMs);
    if (Number.isFinite(delay) && delay > 0) {
      clipboardClearTimer = setTimeout(() => {
        clipboardClearTimer = null;
        // Clear only if the clipboard still holds what we put there.
        Promise.resolve(clipboard.readText())
          .then((current) => {
            if (current === text) clipboard.clear();
          })
          .catch(() => {});
      }, Math.min(delay, 10 * 60_000));
    }
    return true;
  } catch {
    return false;
  }
});

// Auto-update from GitHub Releases (R2.3): checks run only on request from
// the renderer; install only on signed builds (see shared/updater.cjs).
require("./shared/updater.cjs").registerUpdater({
  app,
  handleTrusted,
  send: (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  },
});

// Check a batch of words (English and/or Arabic, mixed-language notes are
// the whole point) and return the ones that are misspelled.
handleTrusted("spellcheck-words", async (_e, words) => {
  return await findMisspelled(words, arSpell, enSpell);
});

handleTrusted("spellcheck-suggest", async (_e, word) => {
  if (typeof word !== "string" || !word.trim()) return [];
  const w = word.trim();
  if (isArabicToken(w)) {
    return await suggestArabicWord(w, arSpell, 8);
  }
  return await suggestEnglishWord(w, enSpell, 6);
});

handleTrusted("add-custom-word", async (_e, word) => {
  if (typeof word === "string" && word.trim()) {
    addCustomWord(word.trim(), getUserDictPath(), arSpell, enSpell);
  }
  return true;
});

/**
 * Start `ollama serve` without any console window, now or later.
 *
 * On Windows it must NOT be detached: a detached process has no console, so
 * every helper Ollama starts afterwards (ollama.exe runner, llama-server.exe,
 * one per model load, e.g. on each save that computes search vectors) gets a
 * new visible console that flashes up and closes. Not detached plus
 * windowsHide gives it a hidden console its helpers share. The cost: Node ties
 * a non-detached child to the app, so an Ollama that IndexArc started stops
 * when IndexArc quits (an Ollama the user started is used and left alone).
 * @param {string} exe
 */
function spawnOllamaServe(exe) {
  const win = process.platform === "win32";
  ollamaProcess = spawn(exe, ["serve"], { detached: !win, stdio: "ignore", windowsHide: true, env: childEnv() });
  ollamaProcess.on("error", (e) => console.log("Ollama start failed:", e.message));
  ollamaProcess.unref();
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
      ollamaPath = execFileSync("where.exe", ["ollama"], { encoding: "utf-8", windowsHide: true })
        .trim()
        .split("\n")[0];
    } catch {}
  }
  if (!ollamaPath) {
    console.log("Ollama not found — local AI optional.");
    return;
  }

  spawnOllamaServe(ollamaPath);

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
/** @param {string} root */
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
      if (!key) {
        // The key file exists but this OS user/machine can't open it (portable
        // copy moved to another PC, profile reset). NEVER overwrite it: that
        // would orphan every wrapped API key in settings.json for good. Run
        // without a wrap key instead — the store keeps the unreadable blobs
        // untouched, and they work again on the original machine.
        logCrash("settings-key", new Error("settings.key.enc is not decryptable on this machine — API keys unavailable here; file left intact"));
        return;
      }
    }
    if (!key) {
      key = crypto.randomBytes(32).toString("base64");
      fs.mkdirSync(path.join(root, "config"), { recursive: true });
      fs.writeFileSync(keyFile, safeStorage.encryptString(key));
    }
    settingsKey = key;
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

  // dist/ is unpacked (outside asar integrity), so verify it against the
  // manifest packed inside app.asar before require()-ing any of it. Dev runs
  // (unpackaged) rebuild dist/ freely and skip this.
  if (app.isPackaged) {
    const { verifyDist, MANIFEST_NAME } = require("./shared/verify-dist.cjs");
    const check = verifyDist(distDir, path.join(__dirname, MANIFEST_NAME));
    if (!check.ok) {
      const msg =
        "The application files failed their integrity check (" +
        check.reason +
        "):\n\n" +
        check.problems.slice(0, 10).join("\n") +
        "\n\nThe installation is incomplete or has been modified. Reinstall IndexArc from a trusted download.";
      console.error("[embedded-server] " + msg);
      try {
        dialog.showErrorBox("IndexArc — build incomplete", msg);
      } catch {}
      app.exit(1);
      return;
    }
    console.log(`[embedded-server] dist integrity OK (${check.checked} files)`);
  }

  // Ensure portable folders exist next to exe / project
  for (const sub of ["data", "config", "logs", "tmp"]) {
    const d = path.join(portableRoot, sub);
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }

  process.env.INDEXARC_ROOT = portableRoot;
  console.log(`Portable root: ${portableRoot}`);
  console.log(`Starting vault server: ${serverPath}`);
  backendLaunch = { serverPath, distDir, portableRoot };
  spawnBackend(PORT);
}

/** @type {{ serverPath: string, distDir: string, portableRoot: string } | null} */
let backendLaunch = null;
let backendStopping = false;
/** @type {number[]} */
const backendCrashes = [];

/** @param {number} preferredPort */
function spawnBackend(preferredPort) {
  const { utilityProcess } = require("electron");
  // Always set by startBackendServer() before the first spawn.
  const { serverPath, distDir, portableRoot } = /** @type {NonNullable<typeof backendLaunch>} */ (backendLaunch);
  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    PORT: String(preferredPort),
    HOST: "127.0.0.1",
    NODE_ENV: "production",
    INDEXARC_ROOT: portableRoot,
    INDEXARC_DIST_DIR: distDir,
    INDEXARC_API_TOKEN: apiToken,
    INDEXARC_VERSION: app.getVersion(),
  };
  if (settingsKey) env.INDEXARC_SETTINGS_KEY = settingsKey;
  else delete env.INDEXARC_SETTINGS_KEY;

  let child;
  try {
    child = utilityProcess.fork(serverPath, [], {
      env,
      serviceName: "IndexArc Vault Server",
      stdio: "inherit",
    });
  } catch (err) {
    // A broken bundle is a broken build — fail LOUDLY instead of hanging.
    console.error("[backend] Failed to start vault server:", err);
    try {
      dialog.showErrorBox(
        "IndexArc — server failed to start",
        "The vault server could not start:\n\n" +
          (err instanceof Error && err.message ? err.message : String(err)) +
          "\n\nThe application will close. Your data on disk is untouched."
      );
    } catch {}
    app.exit(1);
    return;
  }
  serverProcess = child;

  child.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "listening" && Number.isInteger(msg.port)) {
      const restarted = backendPort !== 0;
      backendPort = msg.port;
      console.log(`[backend] vault server listening on ${backendPort} (pid ${child.pid})`);
      // After a crash restart, reload the window from the new instance.
      if (restarted && mainWindow && !mainWindow.isDestroyed()) {
        pollServerAndLoad(`http://127.0.0.1:${backendPort}`, mainWindow);
      }
    }
  });

  child.on("exit", (code) => {
    if (serverProcess === child) serverProcess = null;
    if (backendStopping || isQuiting) return;
    logCrash("backend-exit", new Error(`vault server exited with code ${code}`));
    // Restart a crashed server, but not in a loop: 3 crashes in a minute
    // means something is persistently wrong (corrupt file, broken build).
    const now = Date.now();
    backendCrashes.push(now);
    while (backendCrashes.length && now - backendCrashes[0] > 60_000) backendCrashes.shift();
    if (backendCrashes.length > 3) {
      try {
        dialog.showErrorBox(
          "IndexArc — vault server stopped",
          "The vault server stopped unexpectedly several times in a row. The application will close. Your data on disk is untouched; details are in logs/crash.log."
        );
      } catch {}
      app.exit(1);
      return;
    }
    spawnBackend(backendPort || PORT);
  });
}

// Graceful stop: the server flushes its pending emergency snapshot and stops
// its folder watchers, then exits. Killed after `timeoutMs` regardless.
/**
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function stopBackend(timeoutMs) {
  const child = serverProcess;
  if (!child) return Promise.resolve();
  backendStopping = true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve();
    }, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      child.postMessage({ type: "shutdown" });
    } catch {
      clearTimeout(timer);
      try { child.kill(); } catch {}
      resolve();
    }
  });
}

// The server reports its ACTUAL bound port — it walks off the preferred port
// when something already squats it, so the shell must never assume 3000.
/**
 * @param {import("electron").BrowserWindow} window
 * @param {number} [attempts]
 */
function waitForServerPort(window, attempts = 0) {
  if (backendPort) {
    pollServerAndLoad(`http://127.0.0.1:${backendPort}`, window);
    return;
  }
  if (attempts > 300) {
    console.error("Backend never reported its listening port.");
    app.quit();
    return;
  }
  setTimeout(() => waitForServerPort(window, attempts + 1), 100);
}

function expectedServerId() {
  return crypto.createHash("sha256").update(apiToken).digest("hex").slice(0, 16);
}

/**
 * @param {string} url
 * @param {import("electron").BrowserWindow} window
 * @param {number} [attempts]
 */
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
      webviewTag: false,
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
    if (!isAppUrl(url)) {
      console.log(`[security] Blocked navigation to ${url}`);
      e.preventDefault();
    }
  });

  // A secrets vault has no legitimate use for media, geolocation,
  // notifications, or any other web permission — deny everything by default.
  try {
    mainWindow.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false)
    );
    // Synchronous permission CHECKS (navigator.permissions.query, some
    // device APIs) bypass the request handler — deny those too.
    mainWindow.webContents.session.setPermissionCheckHandler(() => false);
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
          click: () => /** @type {Win} */ (mainWindow).webContents.replaceMisspelling(suggestion),
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
              /** @type {Win} */ (mainWindow).webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord);
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
                click: () => /** @type {Win} */ (mainWindow).webContents.replace(s),
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
                /** @type {Win} */ (mainWindow).webContents.session.addWordToSpellCheckerDictionary(word);
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

    // Open where the user right-clicked, not where the cursor is now: the
    // spellcheck lookups above are async and the mouse may have moved.
    menu.popup({ window: /** @type {Win} */ (mainWindow), x: params.x, y: params.y });
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
  // Windows shutdown / logoff — shorter deadline, the OS is not patient.
  // "session-end" is a window event (it was registered on `app`, where it
  // never fires).
  mainWindow.on("session-end", (e) => {
    quitWithFlush(e, 1500);
  });

  mainWindow.on("close", (e) => {
    if (!isQuiting) {
      e.preventDefault();
      /** @type {Win} */ (mainWindow).hide();
      return;
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  createTray();
}

handleTrusted("select-folder", async () => {
  const result = await dialog.showOpenDialog(/** @type {Win} */ (mainWindow), {
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

// ── Coordinated flush before exit ──
// The renderer owns the freshest note content (editor memory + debounce
// timers). Quitting used to destroy it mid-debounce — the last keystrokes
// died unsaved. Before the app goes down, give the renderer a short, bounded
// window to push everything to the embedded server (each POST is written
// straight to disk), then proceed with the quit.
let flushBeforeExitDone = false;
/**
 * @param {number} timeoutMs
 * @returns {Promise<void>}
 */
function requestRendererFlush(timeoutMs) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      try { ipcMain.removeListener("flush-complete", onFlushComplete); } catch {}
      resolve();
    };
    /** @param {import("electron").IpcMainEvent} e */
    const onFlushComplete = (e) => {
      // Only the main window may end the flush wait early; anyone else
      // could otherwise cut the save of the last keystrokes short.
      if (isTrustedSender(e)) finish();
      else console.log('[security] Ignored "flush-complete" from an untrusted sender');
    };
    ipcMain.on("flush-complete", onFlushComplete);
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    try {
      mainWindow.webContents.send("flush-request");
    } catch {
      finish();
    }
  });
}

/**
 * @param {import("electron").Event | undefined} e
 * @param {number} timeoutMs
 */
function quitWithFlush(e, timeoutMs) {
  if (flushBeforeExitDone) return; // second pass — let the quit proceed
  try {
    e?.preventDefault?.();
  } catch {}
  flushBeforeExitDone = true;
  // Renderer first (its last edits POST to the server), then the server
  // flushes its pending emergency snapshot and exits. The vault may live in
  // the install folder, which the next reinstall's uninstaller deletes — this
  // keeps the machine-level copy (%APPDATA%) current.
  requestRendererFlush(timeoutMs)
    .then(() => stopBackend(timeoutMs))
    .then(() => {
      isQuiting = true;
      app.quit();
    });
}

app.on("before-quit", (e) => {
  // Tray Exit, app.quit() from anywhere, and the silent uninstall that
  // precedes a reinstall/update all land here first.
  quitWithFlush(e, 3000);
});


app.on("activate", () => {
  if (mainWindow === null) createWindow();
});

app.on("will-quit", () => {
  // The graceful stop (and its emergency flush) ran in quitWithFlush; this
  // only covers paths that skipped it.
  backendStopping = true;
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
