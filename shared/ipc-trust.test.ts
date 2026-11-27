import { describe, it, expect } from "vitest";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { isAppUrl, isTrustedSender } = require("./ipc-trust.cjs");

// Electron checklist items 12/17: every IPC message is sender-checked.
describe("IPC sender trust", () => {
  const PORT = 3150;
  const url = `http://127.0.0.1:${PORT}/`;

  function windowWith(frameUrl = url) {
    const mainFrame: any = { url: frameUrl };
    const webContents: any = { mainFrame };
    const win = { isDestroyed: () => false, webContents };
    return { win, webContents, mainFrame };
  }

  it.each([
    [url, true],
    [`http://localhost:${PORT}/#/settings`, true],
    [`http://127.0.0.1:${PORT + 1}/`, false],
    [`https://127.0.0.1:${PORT}/`, false],
    [`http://127.0.0.2:${PORT}/`, false],
    [`http://evil.example:${PORT}/`, false],
    [`file:///C:/app/index.html`, false],
    ["not a url", false],
  ])("isAppUrl(%s) → %s", (u, ok) => {
    expect(isAppUrl(u, PORT)).toBe(ok);
  });

  it("trusts the main window's top frame on the app URL", () => {
    const { win, webContents, mainFrame } = windowWith();
    expect(isTrustedSender({ sender: webContents, senderFrame: mainFrame }, win, PORT)).toBe(true);
  });

  it("refuses a subframe of the main window", () => {
    const { win, webContents } = windowWith();
    expect(isTrustedSender({ sender: webContents, senderFrame: { url } }, win, PORT)).toBe(false);
  });

  it("trusts a document window that was opened by the app", () => {
    const main = windowWith();
    const doc = windowWith(`http://127.0.0.1:${PORT}/?surface=docs`);
    expect(isTrustedSender({ sender: doc.webContents, senderFrame: doc.mainFrame }, [main.win, doc.win], PORT)).toBe(true);
  });

  it("refuses another webContents, even on the app URL", () => {
    const { win } = windowWith();
    const other = windowWith();
    expect(isTrustedSender({ sender: other.webContents, senderFrame: other.mainFrame }, win, PORT)).toBe(false);
  });

  it("refuses the main window after it navigated away", () => {
    const { win, webContents, mainFrame } = windowWith("https://evil.example/");
    expect(isTrustedSender({ sender: webContents, senderFrame: mainFrame }, win, PORT)).toBe(false);
  });

  it("refuses when there is no window, it is destroyed, or the event is malformed", () => {
    const { win, webContents, mainFrame } = windowWith();
    expect(isTrustedSender({ sender: webContents, senderFrame: mainFrame }, null, PORT)).toBe(false);
    expect(isTrustedSender({ sender: webContents, senderFrame: mainFrame }, { ...win, isDestroyed: () => true }, PORT)).toBe(false);
    expect(isTrustedSender(undefined, win, PORT)).toBe(false);
    expect(isTrustedSender({ sender: webContents }, win, PORT)).toBe(false);
    const throwing = { isDestroyed: () => { throw new Error("gone"); }, webContents };
    expect(isTrustedSender({ sender: webContents, senderFrame: mainFrame }, throwing, PORT)).toBe(false);
  });
});
