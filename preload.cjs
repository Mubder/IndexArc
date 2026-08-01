const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  selectFolder: () => ipcRenderer.invoke("select-folder"),
  isElectron: true,
  checkOllamaInstalled: () => ipcRenderer.invoke("check-ollama-installed"),
  installOllama: () => ipcRenderer.invoke("install-ollama"),
  startOllama: () => ipcRenderer.invoke("start-ollama"),
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  spellcheckWords: (words) => ipcRenderer.invoke("spellcheck-words", words),
  spellcheckSuggest: (word) => ipcRenderer.invoke("spellcheck-suggest", word),
});

// On right-click inside a text field, select the word under the cursor when
// nothing is selected. This lets the main-process context menu read the word
// (via params.selectionText) so it can offer spelling suggestions — both
// Chromium's native ones and our own Arabic ones, which Chromium's built-in
// spellchecker does not provide.
// \p{L} matches letters of ANY script (Latin, Arabic, ...), so this works
// for mixed-language text without needing per-language handling.
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

// Same idea as selectWordAt, but for contentEditable regions (e.g. the note
// editor), where there is no .value/.selectionStart to work with — the word
// boundaries have to be found by walking the actual text node under the
// click point.
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
    const el = e.target;
    if (!el) return;
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      if (typeof el.selectionStart !== "number") return;
      // Only auto-select when the user hasn't already made a selection.
      if (el.selectionStart !== el.selectionEnd) return;
      selectWordAt(el, el.selectionStart);
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
