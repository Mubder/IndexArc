import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, undo } from "@codemirror/commands";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { bracketMatching, defaultHighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { normalizePastedPlain } from "../lib/clipboardText";
import { highlightDomRange, showFindHighlight } from "./findHighlight";

export interface CaretInfo {
  line: number;
  col: number;
  count: number;
}

export interface SourceEditorHandle {
  focus: () => void;
  getValue: () => string;
  /** Replace the whole document; records in CodeMirror's undo history. */
  setValue: (text: string) => void;
  selectRange: (from: number, to: number) => void;
  getSelection: () => { from: number; to: number };
  scrollToSelection: () => void;
  highlightMatch: (from: number, to: number) => void;
  clearHighlight: () => void;
  undo: () => void;
  redo: () => void;
}

function languageFor(ext: string): Extension[] {
  switch (ext) {
    case ".md":
    case ".markdown": return [markdown()];
    case ".json":
    case ".jsonc": return [json()];
    case ".js":
    case ".mjs":
    case ".cjs": return [javascript()];
    case ".jsx": return [javascript({ jsx: true })];
    case ".ts": return [javascript({ typescript: true })];
    case ".tsx": return [javascript({ typescript: true, jsx: true })];
    case ".html":
    case ".htm":
    case ".xml":
    case ".svg": return [html()];
    case ".css": return [css()];
    case ".yaml":
    case ".yml": return [yaml()];
    case ".py": return [python()];
    case ".sql": return [sql()];
    default: return [];
  }
}

const editorTheme = EditorView.theme({
  "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)", fontSize: "13px" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65", overflow: "auto" },
  ".cm-content": { padding: "28px 40px 64px", caretColor: "var(--accent-bright)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-muted)", border: "none", paddingLeft: "8px" },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 8px", minWidth: "32px" },
  ".cm-activeLine": { backgroundColor: "var(--bg-hover)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text)" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--accent-bg) !important" },
  ".cm-cursor": { borderLeftColor: "var(--accent-bright)" },
}, { dark: true });

export const SourceEditor = forwardRef<SourceEditorHandle, {
  value: string;
  ext: string;
  normalizePaste: boolean;
  readOnly?: boolean;
  onChange: (text: string) => void;
  onCaret: (info: CaretInfo) => void;
}>(function SourceEditor({ value, ext, normalizePaste, readOnly, onChange, onCaret }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCaretRef = useRef(onCaret);
  onChangeRef.current = onChange;
  onCaretRef.current = onCaret;

  useImperativeHandle(ref, () => ({
    focus() { viewRef.current?.focus(); },
    getValue() { return viewRef.current?.state.doc.toString() ?? ""; },
    setValue(text) {
      const view = viewRef.current;
      if (!view) return;
      const current = view.state.doc.toString();
      if (current === text) return;
      view.dispatch({ changes: { from: 0, to: current.length, insert: text } });
    },
    selectRange(from, to) {
      const view = viewRef.current;
      if (!view) return;
      const size = view.state.doc.length;
      const a = Math.max(0, Math.min(from, size));
      const b = Math.max(a, Math.min(to, size));
      view.dispatch({ selection: { anchor: a, head: b } });
      view.focus();
    },
    getSelection() {
      const view = viewRef.current;
      if (!view) return { from: 0, to: 0 };
      const { from, to } = view.state.selection.main;
      return { from, to };
    },
    scrollToSelection() {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.from, { y: "center" }) });
    },
    highlightMatch(from, to) {
      const view = viewRef.current;
      if (!view) return;
      highlightDomRange((pos) => view.domAtPos(pos), from, to);
    },
    clearHighlight() { showFindHighlight(null); },
    undo() { const view = viewRef.current; if (view) undo(view); },
    redo() { const view = viewRef.current; if (view) redo(view); },
  }), []);

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const caretOf = (state: EditorState): CaretInfo => {
      const pos = state.selection.main.from;
      const line = state.doc.lineAt(pos);
      return { line: line.number, col: pos - line.from + 1, count: state.doc.length };
    };
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      drawSelection(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      highlightSelectionMatches(),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, indentWithTab]),
      EditorView.lineWrapping,
      EditorView.editable.of(!readOnly),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      editorTheme,
      ...languageFor(ext),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          onChangeRef.current(update.state.doc.toString());
          showFindHighlight(null); // the range is stale after an edit
        }
        if (update.docChanged || update.selectionSet) onCaretRef.current(caretOf(update.state));
      }),
    ];
    if (normalizePaste) {
      extensions.push(EditorView.domEventHandlers({
        paste(event, view) {
          const incoming = event.clipboardData?.getData("text/plain");
          if (!incoming) return false;
          event.preventDefault();
          const norm = normalizePastedPlain(incoming);
          const { from, to } = view.state.selection.main;
          view.dispatch({ changes: { from, to, insert: norm }, selection: { anchor: from + norm.length } });
          return true;
        },
      }));
    }
    const view = new EditorView({ state: EditorState.create({ doc: value, extensions }), parent: root });
    viewRef.current = view;
    onCaretRef.current(caretOf(view.state));
    return () => {
      viewRef.current = null;
      view.destroy();
    };
    // Mount once per file extension / reload. `value` is the initial document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="w-full h-full min-h-0 overflow-hidden" dir="auto" />;
});
