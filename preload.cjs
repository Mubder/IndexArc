// @ts-check
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  isElectron: true,
  checkOllamaInstalled: () => ipcRenderer.invoke("check-ollama-installed"),
  installOllama: () => ipcRenderer.invoke("install-ollama"),
  startOllama: () => ipcRenderer.invoke("start-ollama"),
  openExternal: (/** @type {string} */ url) => ipcRenderer.invoke("open-external", url),
  getApiToken: () => ipcRenderer.invoke("get-api-token"),
  copyText: (/** @type {string} */ text, /** @type {number | undefined} */ clearAfterMs, /** @type {string | undefined} */ html) => ipcRenderer.invoke("copy-text", text, clearAfterMs, html),
  readDocFile: (/** @type {string} */ filePath) => ipcRenderer.invoke("docs-read", filePath),
  pickDocFiles: () => ipcRenderer.invoke("docs-pick"),
  writeDocFile: (/** @type {string} */ filePath, /** @type {string} */ text) => ipcRenderer.invoke("docs-write", filePath, text),
  writeDocFileSync: (/** @type {string} */ filePath, /** @type {string} */ text) => ipcRenderer.sendSync("docs-write-sync", filePath, text),
  takePendingDocs: () => ipcRenderer.invoke("docs-take-pending"),
  onDocsOpen: (/** @type {(paths: string[]) => void} */ cb) => {
    ipcRenderer.on("docs-open", (_e, paths) => { try { cb(paths || []); } catch {} });
  },
  onDocsRequestClose: (/** @type {() => void} */ cb) => {
    ipcRenderer.on("docs-request-close", () => { try { cb(); } catch {} });
  },
  docsCloseResult: (/** @type {boolean} */ proceed) => ipcRenderer.send("docs-close-result", proceed),
  openFilesWindow: () => ipcRenderer.invoke("docs-open-window"),
  // Quit handshake for the Files window: main asks us to write every dirty
  // file synchronously, then we acknowledge so the process can exit.
  onDocsFlushRequest: (/** @type {() => void} */ cb) => {
    ipcRenderer.on("docs-flush-request", () => { try { cb(); } catch {} });
  },
  docsFlushComplete: () => ipcRenderer.send("docs-flush-complete"),
  notifyScratchpadChanged: () => ipcRenderer.send("scratchpad-changed-from-doc"),
  onScratchpadChanged: (/** @type {() => void} */ cb) => {
    const handler = () => { try { cb(); } catch {} };
    ipcRenderer.on("scratchpad-changed", handler);
    return () => ipcRenderer.removeListener("scratchpad-changed", handler);
  },
  setFileAssociation: (/** @type {string} */ ext, /** @type {boolean} */ enabled) => ipcRenderer.invoke("file-assoc", ext, enabled),
  spellcheckWords: (/** @type {string[]} */ words) => ipcRenderer.invoke("spellcheck-words", words),
  spellcheckSuggest: (/** @type {string} */ word) => ipcRenderer.invoke("spellcheck-suggest", word),
  addCustomWord: (/** @type {string} */ word) => ipcRenderer.invoke("add-custom-word", word),
  // Quit handshake: main asks the renderer to flush unsaved notes before the
  // app exits; the renderer answers when its save queue is drained.
  onFlushRequest: (/** @type {() => void} */ cb) => {
    ipcRenderer.on("flush-request", () => {
      try { cb(); } catch {}
    });
  },
  flushComplete: () => ipcRenderer.send("flush-complete"),
  // Auto-update (shared/updater.cjs). Nothing reaches the network until the
  // renderer calls checkForUpdates.
  checkForUpdates: () => ipcRenderer.invoke("update-check"),
  downloadUpdate: () => ipcRenderer.invoke("update-download"),
  installUpdate: () => ipcRenderer.invoke("update-install"),
  onUpdateEvent: (/** @type {(name: string, payload: unknown) => void} */ cb) => {
    for (const name of ["update-progress", "update-ready", "update-error"]) {
      ipcRenderer.on(name, (_e, payload) => {
        try { cb(name, payload); } catch {}
      });
    }
  },
});

// On right-click inside a text field, select the word under the cursor when
// nothing is selected. This lets the main-process context menu read the word
// (via params.selectionText) so it can offer spelling suggestions — both
// Chromium's native ones and our own Arabic ones, which Chromium's built-in
// spellchecker does not provide.
// \p{L} matches letters of ANY script (Latin, Arabic, ...), so this works
// for mixed-language text without needing per-language handling.
const WORD_CHAR = /[\p{L}\p{M}\p{N}_'-]/u;

/**
 * @param {HTMLInputElement | HTMLTextAreaElement} el
 * @param {number} pos
 */
function selectWordAt(el, pos) {
  const value = el.value;
  if (!value) return;
  let start = pos;
  let end = pos;
  while (start > 0 && WORD_CHAR.test(value[start - 1])) start--;
  while (end < value.length && WORD_CHAR.test(value[end])) end++;
  if (end > start) {
    try {
      el.setSelectionRange(start, end);
    } catch (_) {
      /* some input types don't support selection */
    }
  }
}

// Same idea as selectWordAt, but for contentEditable regions (e.g. the note
// editor), where there is no .value/.selectionStart to work with — the word
// boundaries have to be found by walking the actual text node under the
// click point.
/**
 * @param {number} x
 * @param {number} y
 */
function selectWordInContentEditable(x, y) {
  const sel = window.getSelection();
  if (!sel) return;
  let range = null;
  if (typeof document.caretRangeFromPoint === "function") {
    range = document.caretRangeFromPoint(x, y);
  } else if (typeof document.caretPositionFromPoint === "function") {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  }
  if (!range) return;
  const node = range.startContainer;
  if (!node || node.nodeType !== Node.TEXT_NODE) return;
  const text = node.nodeValue || "";
  let start = range.startOffset;
  let end = start;
  while (start > 0 && WORD_CHAR.test(text[start - 1])) start--;
  while (end < text.length && WORD_CHAR.test(text[end])) end++;
  if (end <= start) return;
  try {
    const wordRange = document.createRange();
    wordRange.setStart(node, start);
    wordRange.setEnd(node, end);
    sel.removeAllRanges();
    sel.addRange(wordRange);
  } catch (_) {
    /* best-effort */
  }
}

window.addEventListener(
  "contextmenu",
  (e) => {
    const el = /** @type {HTMLElement | null} */ (e.target);
    if (!el) return;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const field = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (el);
      if (typeof field.selectionStart !== "number") return;
      // Only auto-select when the user hasn't already made a selection.
      if (field.selectionStart !== field.selectionEnd) return;
      selectWordAt(field, field.selectionStart);
      return;
    }
    const editable = el.closest && el.closest('[contenteditable="true"]');
    if (!editable) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return; // respect an existing manual selection
    selectWordInContentEditable(e.clientX, e.clientY);
  },
  true
);
