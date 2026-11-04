// @ts-check
// Auto-update from GitHub Releases (R2.3).
//
// Policy:
// - Nothing contacts the network unless the user asks (Settings → "Check for
//   updates", or the opt-in check at startup). The renderer decides.
// - Download and install only happen when the running build can verify the
//   update's code signature: electron-updater checks it against the
//   `publisherName` written into app-update.yml at build time, which exists
//   only for signed builds. Unsigned builds still report a new version and
//   link to the release page, but never install anything themselves.
// - The portable .exe cannot self-update (electron-updater supports NSIS only).
const fs = require("fs");
const path = require("path");

const RELEASES_URL = "https://github.com/Mubder/IndexArc/releases";

/**
 * Reads `publisherName` from app-update.yml (a tiny YAML subset: a scalar or
 * a "- item" list). Returns [] when absent.
 * @param {string} text
 * @returns {string[]}
 */
function parsePublisherNames(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^publisherName:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const inline = m[1].trim();
    if (inline && inline !== "[]") {
      out.push(inline.replace(/^['"]|['"]$/g, ""));
      continue;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const item = /^\s*-\s*(.+)$/.exec(lines[j]);
      if (!item) break;
      out.push(item[1].trim().replace(/^['"]|['"]$/g, ""));
    }
  }
  return out.filter(Boolean);
}

/**
 * @param {{ isPackaged: boolean, isPortable: boolean, platform: string, publisherNames: string[] }} env
 * @returns {{ canCheck: boolean, canInstall: boolean, reason: string }}
 */
function updatePolicy(env) {
  if (!env.isPackaged) return { canCheck: false, canInstall: false, reason: "dev" };
  if (env.platform !== "win32") return { canCheck: true, canInstall: false, reason: "platform" };
  if (env.isPortable) return { canCheck: true, canInstall: false, reason: "portable" };
  if (!env.publisherNames.length) return { canCheck: true, canInstall: false, reason: "unsigned" };
  return { canCheck: true, canInstall: true, reason: "" };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} >0 when a is newer than b
 */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, "").split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * @param {{
 *   app: import("electron").App,
 *   handleTrusted: (channel: string, fn: (e: import("electron").IpcMainInvokeEvent, ...args: any[]) => any) => void,
 *   send: (channel: string, payload: unknown) => void,
 * }} deps
 */
function registerUpdater({ app, handleTrusted, send }) {
  let publisherNames = /** @type {string[]} */ ([]);
  try {
    publisherNames = parsePublisherNames(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8"));
  } catch {
    /* no app-update.yml: dev or unsigned build */
  }
  const policy = updatePolicy({
    isPackaged: app.isPackaged,
    isPortable: !!process.env.PORTABLE_EXECUTABLE_DIR,
    platform: process.platform,
    publisherNames,
  });

  /** @type {import("electron-updater").AppUpdater | null} */
  let updater = null;
  const getUpdater = () => {
    if (updater) return updater;
    updater = require("electron-updater").autoUpdater;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on("download-progress", (p) => send("update-progress", { percent: Math.round(p.percent || 0) }));
    updater.on("update-downloaded", (info) => send("update-ready", { version: info.version }));
    updater.on("error", (err) => send("update-error", { message: String(err && err.message ? err.message : err) }));
    return updater;
  };

  handleTrusted("update-check", async () => {
    const current = app.getVersion();
    if (!policy.canCheck) return { status: "unsupported", current, reason: policy.reason, canInstall: false, releasesUrl: RELEASES_URL };
    try {
      const res = await getUpdater().checkForUpdates();
      const latest = res && res.updateInfo ? res.updateInfo.version : current;
      const available = compareVersions(latest, current) > 0;
      return {
        status: available ? "available" : "current",
        current,
        latest,
        canInstall: available && policy.canInstall,
        reason: policy.reason,
        releasesUrl: RELEASES_URL,
      };
    } catch (e) {
      return { status: "error", current, message: e instanceof Error ? e.message : String(e), canInstall: false, reason: policy.reason, releasesUrl: RELEASES_URL };
    }
  });

  handleTrusted("update-download", async () => {
    if (!policy.canInstall) return { ok: false, reason: policy.reason };
    await getUpdater().downloadUpdate();
    return { ok: true };
  });

  handleTrusted("update-install", async () => {
    if (!policy.canInstall || !updater) return { ok: false, reason: policy.reason || "not-downloaded" };
    // The normal quit path still runs (renderer flush, server shutdown).
    setImmediate(() => updater && updater.quitAndInstall(false, true));
    return { ok: true };
  });

  return policy;
}

module.exports = { registerUpdater, updatePolicy, parsePublisherNames, compareVersions, RELEASES_URL };
