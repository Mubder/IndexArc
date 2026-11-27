// @ts-check
// Who may talk to the Electron main process (preload bridge and IPC).
//
// Only the main window's top frame, showing our own local server, is
// trusted: get-api-token hands out the vault pairing token, so a subframe,
// another webContents, or the main window after navigating elsewhere must
// be refused. Kept free of Electron imports so it can be unit-tested
// (shared/ipc-trust.test.ts).

/**
 * @param {string} url
 * @param {number | string} port the embedded server's port
 */
function isAppUrl(url, port) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" && (u.hostname === "127.0.0.1" || u.hostname === "localhost") && u.port === String(port);
  } catch {
    return false;
  }
}

/**
 * @param {{ sender?: any; senderFrame?: any } | null | undefined} e an IPC event (invoke or send)
 * @param {{ isDestroyed(): boolean; webContents: any } | { isDestroyed(): boolean; webContents: any }[] | null | undefined} windows
 *        the vault window, or that window plus the document window
 * @param {number | string} port
 */
function isTrustedSender(e, windows, port) {
  try {
    if (!e) return false;
    const list = Array.isArray(windows) ? windows : windows ? [windows] : [];
    const owner = list.find((w) => w && !w.isDestroyed() && e.sender === w.webContents);
    if (!owner) return false;
    const frame = e.senderFrame;
    if (!frame || frame !== e.sender.mainFrame) return false;
    return isAppUrl(frame.url, port);
  } catch {
    return false;
  }
}

module.exports = { isAppUrl, isTrustedSender };
