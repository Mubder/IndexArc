const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  isElectron: true,
  checkOllamaInstalled: () => ipcRenderer.invoke("check-ollama-installed"),
  installOllama: () => ipcRenderer.invoke("install-ollama"),
  startOllama: () => ipcRenderer.invoke("start-ollama"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  spellcheckArabic: (words) => ipcRenderer.invoke("spellcheck-ar", words),
});

// On right-click inside a text field, select the word under the cursor when
// nothing is selected. This lets the main-process context menu read the word
// (via params.selectionText) so it can offer Arabic spelling suggestions,
// which Chromium's built-in spellchecker does not provide.
const WORD_CHAR = /[\p{L}\p{M}\p{N}_'-]/u;

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

window.addEventListener(
  "contextmenu",
  (e) => {
    const el = e.target;
    if (!el || (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")) return;
    if (typeof el.selectionStart !== "number") return;
    // Only auto-select when the user hasn't already made a selection.
    if (el.selectionStart !== el.selectionEnd) return;
    selectWordAt(el, el.selectionStart);
  },
  true
);
