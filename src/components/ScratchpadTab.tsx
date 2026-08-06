import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  Plus,
  X,
  Save,
  Wand2,
  KeyRound,
  Trash2,
  Loader2,
  Copy,
  Sparkles,
  Pencil,
  Undo2,
  Archive,
  ArchiveRestore,
  Bold,
  Italic,
  Underline,
  Highlighter,
  Eraser,
  Undo,
  Redo,
  Palette,
  ClipboardPaste,
  ArrowUp,
  ArrowDown,
  AlignLeft,
  AlignRight,
  Languages,
  BookPlus,
  EyeOff,
  Zap,
  ZapOff,
} from "lucide-react";
import { AnalyzeCandidate, Settings } from "../types";
import { getTranslation } from "../utils/i18n";

type NoteBidiMode = "auto" | "ltr" | "rtl";

interface ScratchTab {
  id: string;
  title: string;
  content: string;
  archived?: boolean;
  archivedAt?: number;
}

interface Detection {
  families: string[];
  candidates: AnalyzeCandidate[];
  provider: string;
}

interface Busy {
  analyze?: boolean;
  save?: boolean;
  rewrite?: boolean;
}

type RewriteStyle = "human" | "professional" | "technical" | "concise" | "formal" | "casual";

const STORAGE_KEY = "indexarc-scratchpad";
const REWRITE_STYLES: RewriteStyle[] = ["human", "professional", "technical", "concise", "formal", "casual"];
const REWRITE_STYLE_KEYS: Record<RewriteStyle, string> = {
  human: "rewrite_style_human",
  professional: "rewrite_style_professional",
  technical: "rewrite_style_technical",
  concise: "rewrite_style_concise",
  formal: "rewrite_style_formal",
  casual: "rewrite_style_casual",
};

const HIGHLIGHT_COLORS = [
  { hex: "#fef08a", key: "highlight_yellow" },
  { hex: "#86efac", key: "highlight_green" },
  { hex: "#93c5fd", key: "highlight_blue" },
  { hex: "#fca5a5", key: "highlight_red" },
  { hex: "#d8b4fe", key: "highlight_purple" },
];

const TEXT_COLORS = [
  { hex: "#ffffff", key: "text_color_white" },
  { hex: "#f87171", key: "text_color_red" },
  { hex: "#fb923c", key: "text_color_orange" },
  { hex: "#facc15", key: "text_color_yellow" },
  { hex: "#4ade80", key: "text_color_green" },
  { hex: "#38bdf8", key: "text_color_blue" },
  { hex: "#c084fc", key: "text_color_purple" },
];

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `t_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function loadTabs(): ScratchTab[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((x: any) => ({
          id: x.id || uid(),
          title: x.title || "Scratch",
          content: x.content || "",
          archived: !!x.archived,
        }));
      }
    }
  } catch {}
  return [{ id: uid(), title: "Scratch 1", content: "" }];
}

// --- Caret/selection offset helpers -------------------------------------
// We snapshot the editor's selection as a (start, end) character offset
// pair over its textContent. This survives DOM replacement (unlike Range
// objects, which point at detached nodes after innerHTML is reassigned) and
// lets our owned history stack restore the selection on undo/redo.

function getSelectionOffsets(root: HTMLElement): [number, number] {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !root.contains(sel.anchorNode)) {
    return [0, 0];
  }
  const range = sel.getRangeAt(0);
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const start = pre.toString().length;
  const end = start + range.toString().length;
  return [start, end];
}

function setSelectionOffsets(root: HTMLElement, start: number, end: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node: Text | null;
  let counted = 0;
  let startNode: Text | null = null;
  let startOff = 0;
  let endNode: Text | null = null;
  let endOff = 0;
  while ((node = walker.nextNode() as Text | null)) {
    const len = node.nodeValue?.length ?? 0;
    if (!startNode && counted + len >= start) {
      startNode = node;
      startOff = Math.min(start - counted, len);
    }
    if (!endNode && counted + len >= end) {
      endNode = node;
      endOff = Math.min(end - counted, len);
    }
    if (startNode && endNode) break;
    counted += len;
  }
  // If end fell past the last text node, clamp to the end of the editor.
  if (!endNode) {
    const last = root.lastChild;
    if (last && last.nodeType === Node.TEXT_NODE) {
      endNode = last as Text;
      endOff = last.nodeValue?.length ?? 0;
    } else if (startNode) {
      endNode = startNode;
      endOff = startOff;
    }
  }
  if (!startNode) return; // nothing to select
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.setStart(startNode, startOff);
  range.setEnd(endNode ?? startNode, endNode ? endOff : startOff);
  sel.removeAllRanges();
  sel.addRange(range);
}

// ── Spellcheck tokenization (shared with server/electron via same rules) ──
// Word = run of Arabic letters, or Latin letters with internal ' / -
const SPELL_WORD_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+|[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/g;
const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
const LATIN_WORD_RE = /^[A-Za-z]+(?:['\u2019-][A-Za-z]+)*$/;
const CLEAN_TOKEN_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0640\u064B-\u0652\u0670]/g;

function sanitizeToken(token: string): string {
  return token.replace(CLEAN_TOKEN_RE, "");
}

function isArabicToken(token: string): boolean {
  return ARABIC_RE.test(token) && !/[A-Za-z]/.test(token);
}

function isLatinToken(token: string): boolean {
  return LATIN_WORD_RE.test(token);
}

function extractSpellWords(text: string): string[] {
  const words: string[] = [];
  try {
    const segmenter = new Intl.Segmenter(["en", "ar"], { granularity: "word" });
    for (const segment of segmenter.segment(text)) {
      if (!segment.isWordLike) continue;
      const clean = sanitizeToken(segment.segment);
      if (!clean || clean.length <= 1) continue;
      if (isArabicToken(clean) || isLatinToken(clean)) words.push(clean);
    }
  } catch {
    const matches = text.match(SPELL_WORD_RE) || [];
    for (const m of matches) {
      const clean = sanitizeToken(m);
      if (!clean || clean.length <= 1) continue;
      if (isArabicToken(clean) || isLatinToken(clean)) words.push(clean);
    }
  }
  return Array.from(new Set(words));
}

function getWordAtPoint(root: HTMLElement, x: number, y: number): { word: string; range: Range } | null {
  let range: Range | null = null;
  if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(x, y);
  } else if ((document as any).caretPositionFromPoint) {
    const pos = (document as any).caretPositionFromPoint(x, y);
    if (pos && pos.offsetNode) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.setEnd(pos.offsetNode, pos.offset);
    }
  }
  if (!range || !range.startContainer || !root.contains(range.startContainer)) {
    return null;
  }

  const node = range.startContainer;
  if (node.nodeType !== Node.TEXT_NODE) return null;

  const text = node.nodeValue || "";
  const offset = range.startOffset;

  let start = offset;
  while (start > 0 && /[\w\u0600-\u06FF\u0750-\u077F''\u2019-]/.test(text[start - 1])) {
    start--;
  }
  let end = offset;
  while (end < text.length && /[\w\u0600-\u06FF\u0750-\u077F''\u2019-]/.test(text[end])) {
    end++;
  }

  const word = text.slice(start, end).trim();
  if (!word || word.length <= 1) return null;

  const wordRange = document.createRange();
  wordRange.setStart(node, start);
  wordRange.setEnd(node, end);

  return { word, range: wordRange };
}

function measureCaretPos(editor: HTMLElement): { top: number; left: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return null;

  const range = sel.getRangeAt(0);
  const editorBox = editor.getBoundingClientRect();
  const rects = range.getClientRects();

  if (rects && rects.length > 0) {
    const lastRect = rects[rects.length - 1];
    if (lastRect.width >= 0 && lastRect.height >= 0) {
      return {
        top: lastRect.top - editorBox.top,
        left: lastRect.right - editorBox.left,
      };
    }
  }

  try {
    const cl = range.cloneRange();
    const span = document.createElement("span");
    span.appendChild(document.createTextNode("\u200b"));
    cl.insertNode(span);
    const box = span.getBoundingClientRect();
    if (span.parentNode) span.parentNode.removeChild(span);
    return {
      top: box.top - editorBox.top,
      left: box.left - editorBox.left,
    };
  } catch {
    return null;
  }
}

/** First strong character decides a paragraph/note's natural base direction. */
function detectBaseDir(text: string): "ltr" | "rtl" {
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // Arabic / Hebrew blocks → RTL
    if (
      (code >= 0x0590 && code <= 0x05ff) ||
      (code >= 0x0600 && code <= 0x06ff) ||
      (code >= 0x0750 && code <= 0x077f) ||
      (code >= 0x08a0 && code <= 0x08ff) ||
      (code >= 0xfb1d && code <= 0xfdff) ||
      (code >= 0xfe70 && code <= 0xfeff)
    ) {
      return "rtl";
    }
    // Latin / common LTR letters
    if (
      (code >= 0x0041 && code <= 0x005a) ||
      (code >= 0x0061 && code <= 0x007a) ||
      (code >= 0x00c0 && code <= 0x024f)
    ) {
      return "ltr";
    }
  }
  return "ltr";
}

/** Scroll a page container (main) so `el` sits near the top of the viewport. */
function scrollContainerToReveal(el: HTMLElement) {
  const main = el.closest("main") as HTMLElement | null;
  if (main) {
    const mainRect = main.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const delta = elRect.top - mainRect.top - 12;
    if (Math.abs(delta) > 2) {
      main.scrollBy({ top: delta, behavior: "smooth" });
    }
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

interface SpellRect {
  key: string;
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * Measure misspelled words from the LIVE editor DOM using Range#getClientRects().
 * A cloned HTML overlay reflows differently under RTL/BIDI (especially when
 * misspell <span>s get unicode-bidi:isolate), which left red squiggles floating
 * on the empty side of dual-language notes. Positioning from real glyph boxes
 * always tracks the painted text.
 */
function collectMisspellRects(
  editor: HTMLElement,
  misspelled: Set<string>
): SpellRect[] {
  if (!misspelled.size) return [];
  const editorBox = editor.getBoundingClientRect();
  const out: SpellRect[] = [];
  let keySeq = 0;

  const pushRangeRects = (range: Range) => {
    let list: DOMRectList | DOMRect[];
    try {
      list = range.getClientRects();
    } catch {
      return;
    }
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      if (!r || r.width < 1 || r.height < 1) continue;
      // Skip rects clearly outside the editor (collapsed off-screen fragments)
      if (r.bottom < editorBox.top - 2 || r.top > editorBox.bottom + 2) continue;
      out.push({
        key: `u${keySeq++}`,
        top: r.top - editorBox.top,
        left: r.left - editorBox.left,
        width: r.width,
        height: Math.max(2, r.height),
      });
    }
  };

  const walkText = (node: Text) => {
    const text = node.nodeValue || "";
    if (!text) return;

    type Seg = { start: number; end: number; raw: string };
    const segs: Seg[] = [];
    try {
      const segmenter = new Intl.Segmenter(["en", "ar"], { granularity: "word" });
      for (const s of segmenter.segment(text)) {
        if (!s.isWordLike) continue;
        segs.push({
          start: s.index,
          end: s.index + s.segment.length,
          raw: s.segment,
        });
      }
    } catch {
      for (const m of text.matchAll(new RegExp(SPELL_WORD_RE.source, "g"))) {
        const start = m.index ?? 0;
        segs.push({ start, end: start + m[0].length, raw: m[0] });
      }
    }

    for (const seg of segs) {
      const clean = sanitizeToken(seg.raw);
      if (!clean || clean.length <= 1) continue;
      if (!(isArabicToken(clean) || isLatinToken(clean))) continue;
      if (!misspelled.has(clean)) continue;
      try {
        const range = document.createRange();
        range.setStart(node, seg.start);
        range.setEnd(node, Math.min(seg.end, text.length));
        pushRangeRects(range);
      } catch {
        /* range may fail if node detaches mid-measure */
      }
    }
  };

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    walkText(n as Text);
  }
  return out;
}

export const ScratchpadTab: React.FC<{ settings: Settings | null }> = ({ settings }) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const initial = useRef(loadTabs());
  const [tabs, setTabs] = useState<ScratchTab[]>(initial.current);
  const [activeId, setActiveId] = useState<string>(
    initial.current && initial.current.length > 0 ? initial.current[0].id : "default"
  );
  const [detections, setDetections] = useState<Record<string, Detection>>({});
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState<RewriteStyle>("professional");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [bidiMode, setBidiMode] = useState<NoteBidiMode>("auto");
  // Long-note jump controls: shown whenever the editor content overflows.
  const [noteOverflows, setNoteOverflows] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  // Listen for "Reopen in Scratchpad" event from Library or Command Palette
  useEffect(() => {
    const handleReopenEvent = () => {
      try {
        const raw = localStorage.getItem("indexarc-reopen-note");
        if (!raw) return;
        localStorage.removeItem("indexarc-reopen-note");
        const parsed = JSON.parse(raw);
        if (parsed && parsed.title && parsed.html) {
          const newId = `note-${Date.now()}`;
          const newTab = { id: newId, title: parsed.title, content: parsed.html, archived: false };
          setTabs((prev) => [...prev, newTab]);
          setActiveId(newId);
        }
      } catch (_) {}
    };
    window.addEventListener("indexarc-reopen-note", handleReopenEvent);
    handleReopenEvent();
    return () => window.removeEventListener("indexarc-reopen-note", handleReopenEvent);
  }, []);
  const shellRef = useRef<HTMLDivElement>(null);
  const scratchRootRef = useRef<HTMLDivElement>(null);
  // Per-tab undo stack for rephrase: each entry is a previous version of the
  // content, so the user can step back through their edits.
  const [rephraseUndo, setRephraseUndo] = useState<Record<string, string[]>>({});
  const titleTouched = useRef<Record<string, boolean>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);

  const reorderTab = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((x) => x.id === fromId);
      const to = prev.findIndex((x) => x.id === toId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const pasteFlag = useRef<Record<string, boolean>>({});
  const serverLoaded = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Live content buffer keyed by tab id. The editor DOM is authoritative
  // while editing; this ref mirrors it for persistence without triggering a
  // React re-render (which would destroy the selection / undo stack).
  const contentRef = useRef<Record<string, string>>({});
  const activeIdRef = useRef<string>(activeId);
  activeIdRef.current = activeId;

  // Dual-language spellcheck: red underlines are positioned from live
  // getClientRects() of misspelled ranges (not a cloned HTML overlay).
  const editorRef = useRef<HTMLDivElement>(null);
  const [misspelledWords, setMisspelledWords] = useState<Set<string>>(new Set());
  const [spellRects, setSpellRects] = useState<SpellRect[]>([]);
  const [highlightColor, setHighlightColor] = useState<string>("#fef08a");
  const [textColor, setTextColor] = useState<string>("#ffffff");
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [ignoredWords, setIgnoredWords] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    word: string;
    range: Range | null;
    suggestions: string[];
    loading: boolean;
  } | null>(null);
  const [enablePredictions, setEnablePredictions] = useState<boolean>(() => {
    return localStorage.getItem("indexarc_enable_ghost") !== "false";
  });
  const [ghostCompletion, setGhostCompletion] = useState<string>("");
  const [caretPos, setCaretPos] = useState<{ top: number; left: number } | null>(null);
  const [pastePlain, setPastePlain] = useState(true);
  const misspelledRef = useRef(misspelledWords);
  misspelledRef.current = misspelledWords;

  // One size for dual-language notes: larger of EN/AR settings so neither
  // script is cramped, without per-script scaling that desyncs the overlay.
  const noteFontSize = Math.max(settings?.font_size_en || 14, settings?.font_size_ar || 16);

  // --- Owned undo/redo history -------------------------------------------
  // The browser's native undo stack is unreliable here (React reconciliation
  // + innerHTML reassignment fragment it), so we keep our own. Each entry is
  // an innerHTML snapshot plus the (start,end) character offsets of the
  // selection at that point. Undo/redo restore both content and caret.
  interface HistoryEntry {
    html: string;
    sel: [number, number];
  }
  const historyRef = useRef<HistoryEntry[]>([]);
  const historyIndexRef = useRef<number>(-1);
  const historyTimerRef = useRef<number | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0); // bumps to refresh canUndo/canRedo
  const seedHandledRef = useRef<Set<string>>(new Set()); // tracks which tab ids have been seeded

  // historyVersion exists only to trigger re-renders when the stack mutates so
  // the disabled state on the Undo/Redo buttons stays correct.
  void historyVersion;
  const historyCanUndo = historyIndexRef.current > 0;
  const historyCanRedo = historyIndexRef.current < historyRef.current.length - 1;

  const historyPushImmediate = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const entry: HistoryEntry = {
      html: editor.innerHTML,
      sel: getSelectionOffsets(editor),
    };
    // Drop any redo tail beyond the current index.
    historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
    const last = historyRef.current[historyRef.current.length - 1];
    if (last && last.html === entry.html) {
      last.sel = entry.sel; // just update caret position
    } else {
      historyRef.current.push(entry);
    }
    // Cap the stack to a sane size.
    if (historyRef.current.length > 200) {
      historyRef.current = historyRef.current.slice(-200);
    }
    historyIndexRef.current = historyRef.current.length - 1;
    setHistoryVersion((v) => v + 1);
  }, []);

  // Coalesce rapid edits (typing) into one history entry.
  const scheduleHistoryPush = useCallback(() => {
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
    }
    historyTimerRef.current = window.setTimeout(() => {
      historyTimerRef.current = null;
      historyPushImmediate();
    }, 350);
  }, [historyPushImmediate]);

  const historyApply = useCallback((entry: HistoryEntry) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.innerHTML = entry.html;
    setSelectionOffsets(editor, entry.sel[0], entry.sel[1]);
    editor.focus();
    // Keep the ref buffer in sync so persistence still fires.
    contentRef.current[activeIdRef.current] = entry.html;
    setTabs((prev) =>
      prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: entry.html } : x))
    );
  }, []);

  const historyUndo = useCallback(() => {
    if (historyIndexRef.current <= 0) return;
    // Push any pending edit before stepping back.
    if (historyTimerRef.current !== null) {
      window.clearTimeout(historyTimerRef.current);
      historyTimerRef.current = null;
      historyPushImmediate();
    }
    historyIndexRef.current -= 1;
    const entry = historyRef.current[historyIndexRef.current];
    if (entry) historyApply(entry);
    setHistoryVersion((v) => v + 1);
  }, [historyApply, historyPushImmediate]);

  const historyRedo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    historyIndexRef.current += 1;
    const entry = historyRef.current[historyIndexRef.current];
    if (entry) historyApply(entry);
    setHistoryVersion((v) => v + 1);
  }, [historyApply]);

  const historyInit = useCallback((html: string) => {
    const editor = editorRef.current;
    historyRef.current = [{ html, sel: [0, 0] }];
    historyIndexRef.current = 0;
    if (editor) {
      const sel = getSelectionOffsets(editor);
      historyRef.current[0].sel = sel;
    }
    setHistoryVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target as Node)) {
        setShowHighlightPicker(false);
        setShowTextColorPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Execute a document.execCommand formatting command against the LIVE
  // selection. The toolbar's onMouseDown preventDefault keeps focus in the
  // editor so the selection never collapses â€” no save/restore needed.
  const execFormat = useCallback((command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    editor.focus();
    // Formatting is a discrete edit â€” snapshot immediately.
    historyPushImmediate();
    contentRef.current[activeIdRef.current] = editor.innerHTML;
    setTabs((prev) =>
      prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: editor.innerHTML } : x))
    );
  }, [historyPushImmediate]);

  const htmlToPlainText = (html: string): string => {
    if (!html) return "";
    const d = document.createElement("div");
    d.innerHTML = html.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n</$1>");
    const text = d.textContent || d.innerText || "";
    return text.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, " ");
  };

  // Single entry point for any EXTERNAL content write (rephrase, clear,
  // undo-rephrase, etc.). Updates the DOM, the history stack, the ref buffer
  // and React state in one consistent step — no scattered innerHTML writes.
  const setEditorHtml = useCallback(
    (html: string) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.innerHTML = html;
      contentRef.current[activeIdRef.current] = html;
      setTabs((prev) =>
        prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: html } : x))
      );
      historyInit(html);
    },
    [historyInit]
  );

  const fallbackTab: ScratchTab = { id: activeId || "default", title: "Scratch", content: "" };
  const active = tabs.find((x) => x.id === activeId) || tabs[0] || fallbackTab;
  const b = busy[activeId] || {};
  const detection = detections[activeId];
  const hasSecret =
    !!detection &&
    (detection.families.includes("secret") || detection.families.includes("unknown"));

  // Seed the editor DOM imperatively on mount and on every tab switch (the
  // editor has key={activeId}, so it remounts). After this, React NEVER
  // re-applies innerHTML while editing — the editor is uncontrolled, which
  // is what keeps the selection and undo stack intact.
  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const html = contentRef.current[activeId] ?? active?.content ?? "";
    editor.innerHTML = html;
    historyInit(html);
    if (!seedHandledRef.current.has(activeId)) {
      seedHandledRef.current.add(activeId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const checkWords = useCallback(async (words: string[]): Promise<string[]> => {
    if (settings?.enable_live_spellcheck === false) return [];

    const filterWords = words.filter((w) => {
      if (!w) return false;
      const clean = sanitizeToken(w).trim();
      if (!clean || clean.length <= 1) return false;
      if (ignoredWords.has(clean) || ignoredWords.has(clean.toLowerCase())) return false;
      return true;
    });

    if (!filterWords.length) return [];

    let bad: string[] = [];
    if (typeof window !== "undefined" && window.electronAPI?.spellcheckWords) {
      bad = await window.electronAPI.spellcheckWords(filterWords);
    } else {
      try {
        const res = await fetch("/api/spellcheck-words", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words: filterWords }),
        });
        if (res.ok) {
          const data = await res.json();
          bad = Array.isArray(data.bad) ? data.bad : [];
        }
      } catch {}
    }

    return bad.filter((w) => !ignoredWords.has(w) && !ignoredWords.has(w.toLowerCase()));
  }, [settings?.enable_live_spellcheck, ignoredWords]);

  // Debounced bilingual spellcheck (custom nspell pipeline — Chromium has no
  // Arabic dict and would underline correct Arabic as English misspellings).
  useEffect(() => {
    const text = htmlToPlainText(active?.content || "");
    const words = extractSpellWords(text);
    if (!words.length) {
      setMisspelledWords((prev) => (prev.size ? new Set<string>() : prev));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const bad = await checkWords(words);
        if (!cancelled) setMisspelledWords(new Set(bad));
      } catch {
        /* ignore */
      }
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.content, checkWords]);

  // Paint underlines from live glyph boxes (BIDI-safe for dual-language notes).
  const recomputeSpellRects = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      setSpellRects([]);
      return;
    }
    const bad = misspelledRef.current;
    if (!bad.size) {
      setSpellRects((prev) => (prev.length ? [] : prev));
      return;
    }
    const next = collectMisspellRects(editor, bad);
    setSpellRects(next);
  }, []);

  // Load tabs from the server (portable, survives reinstall/update). The
  // server copy is authoritative when it has content; localStorage is a cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/scratchpad");
        if (!res.ok) return;
        const data = await res.json();
        const serverTabs: ScratchTab[] = Array.isArray(data.tabs)
          ? data.tabs
              .filter((x: any) => x && typeof x === "object")
              .map((x: any) => ({
                id: x.id || uid(),
                title: x.title || "Scratch",
                content: x.content || "",
                archived: !!x.archived,
              }))
          : [];
        if (cancelled) return;
        if (serverTabs.length) {
          // Server has the durable copy â€” it wins over the localStorage cache.
          setTabs(serverTabs);
          setActiveId(serverTabs[0].id);
        } else {
          // First run on this vault: migrate existing localStorage tabs up so
          // they become durable and survive future reinstalls.
          const local = initial.current;
          const hasContent = local.some((x) => x.content.trim() || x.title !== "Scratch 1");
          if (hasContent) {
            fetch("/api/scratchpad", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tabs: local }),
            }).catch(() => {});
          }
        }
      } catch {
        /* offline / locked â€” keep localStorage tabs */
      } finally {
        if (!cancelled) serverLoaded.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to localStorage (fast cache) + the server (durable) on change.
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tabs));
    if (!serverLoaded.current) return;
    const handle = setTimeout(() => {
      fetch("/api/scratchpad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabs }),
      }).catch(() => {
        /* best-effort; localStorage still holds the copy */
      });
    }, 600);
    return () => clearTimeout(handle);
  }, [tabs]);

  const setStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    if (msg) setTimeout(() => setStatusMsg(""), 3200);
  }, []);

  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    window.addEventListener("click", handleClick);
    return () => window.removeEventListener("click", handleClick);
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const editor = editorRef.current;
    if (!editor) return;

    const targetInfo = getWordAtPoint(editor, e.clientX, e.clientY);
    if (!targetInfo) {
      setContextMenu(null);
      return;
    }

    const { word, range } = targetInfo;
    const clean = sanitizeToken(word);
    if (!clean || clean.length <= 1) {
      setContextMenu(null);
      return;
    }

    e.preventDefault();

    // 1. Open context menu INSTANTLY at 0ms
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      word: clean,
      range,
      suggestions: [],
      loading: true,
    });

    // 2. Fetch suggestions asynchronously in background
    fetch("/api/spellcheck-suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: clean }),
    })
      .then((res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((data) => {
        setContextMenu((prev) => {
          if (!prev || prev.word !== clean) return prev;
          return {
            ...prev,
            suggestions: data.suggestions || [],
            loading: false,
          };
        });
      })
      .catch(() => {
        setContextMenu((prev) => (prev ? { ...prev, loading: false } : null));
      });
  }, []);

  const handleApplySuggestion = (replacement: string) => {
    if (!contextMenu || !contextMenu.range) {
      setContextMenu(null);
      return;
    }
    const { range } = contextMenu;
    range.deleteContents();
    const textNode = document.createTextNode(replacement);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    setContextMenu(null);
    onEditorInput();
  };

  const handleAddToDictionary = async (word: string) => {
    const clean = sanitizeToken(word).trim();
    if (!clean) return;
    setIgnoredWords((prev) => new Set(prev).add(clean).add(clean.toLowerCase()));
    setContextMenu(null);
    setStatus(`Added "${clean}" to dictionary`);
    requestAnimationFrame(recomputeSpellRects);

    if (typeof window !== "undefined" && window.electronAPI?.addCustomWord) {
      try {
        await window.electronAPI.addCustomWord(clean);
      } catch {}
    }

    try {
      await fetch("/api/spellcheck-add-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: clean }),
      });
    } catch {}
  };

  const handleIgnoreWord = async (word: string) => {
    const clean = sanitizeToken(word).trim();
    if (!clean) return;
    setIgnoredWords((prev) => new Set(prev).add(clean).add(clean.toLowerCase()));
    setContextMenu(null);
    setStatus(`Ignored "${clean}"`);
    requestAnimationFrame(recomputeSpellRects);

    if (typeof window !== "undefined" && window.electronAPI?.addCustomWord) {
      try {
        await window.electronAPI.addCustomWord(clean);
      } catch {}
    }

    try {
      await fetch("/api/spellcheck-ignore-word", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: clean }),
      });
    } catch {}
  };

  const togglePredictions = () => {
    setEnablePredictions((prev) => {
      const next = !prev;
      localStorage.setItem("indexarc_enable_ghost", String(next));
      if (!next) {
        setGhostCompletion("");
        setCaretPos(null);
      }
      return next;
    });
  };

  const autocompleteTimerRef = useRef<NodeJS.Timeout | null>(null);

  const updateCaretPos = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const pos = measureCaretPos(editor);
    setCaretPos(pos);
  }, []);

  const triggerAutocomplete = useCallback((prefixText: string) => {
    if (!enablePredictions) {
      setGhostCompletion("");
      setCaretPos(null);
      return;
    }
    if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current);
    const cleanPrefix = prefixText.trim();
    if (!cleanPrefix || cleanPrefix.length < 3) {
      setGhostCompletion("");
      setCaretPos(null);
      return;
    }
    autocompleteTimerRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/autocomplete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: cleanPrefix, maxTokens: 16 }),
        });
        const data = await res.json();
        if (data && data.completion && typeof data.completion === "string") {
          const comp = data.completion.trim();
          if (comp) {
            setGhostCompletion(comp);
            updateCaretPos();
          } else {
            setGhostCompletion("");
            setCaretPos(null);
          }
        } else {
          setGhostCompletion("");
          setCaretPos(null);
        }
      } catch {
        setGhostCompletion("");
        setCaretPos(null);
      }
    }, 220);
  }, [enablePredictions, updateCaretPos]);



  const analyze = useCallback(async (id: string, content: string) => {
    const text = content.trim();
    if (!text) {
      setDetections((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
      return;
    }
    setBusy((prev) => ({ ...prev, [id]: { ...prev[id], analyze: true } }));
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (res.ok) {
        const candidates: AnalyzeCandidate[] = data.candidates || [];
        const families = Array.from(new Set(candidates.map((c) => c.family)));
        setDetections((d) => ({ ...d, [id]: { families, candidates, provider: data.provider_used || "" } }));
      }
    } catch {
      /* ignore analysis errors */
    } finally {
      setBusy((prev) => ({ ...prev, [id]: { ...prev[id], analyze: false } }));
    }
  }, []);

  // setContent is used by external flows (rephrase, undo-rephrase) to replace
  // the whole editor body. Route through setEditorHtml so the DOM, history
  // stack and state all update together.
  const setContent = useCallback(
    (id: string, content: string) => {
      if (id === activeIdRef.current) {
        setEditorHtml(content);
      } else {
        setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, content } : x)));
        contentRef.current[id] = content;
      }
    },
    [setEditorHtml]
  );

  const onEditorInput = useCallback(() => {
    if (ghostCompletion) {
      setGhostCompletion("");
      setCaretPos(null);
    }
    const editor = editorRef.current;
    if (!editor) return;
    const html = editor.innerHTML;
    const id = activeIdRef.current;
    // The editor DOM is authoritative — mirror into the ref buffer.
    contentRef.current[id] = html;
    // Coalesce typing into discrete history entries.
    scheduleHistoryPush();
    if (pasteFlag.current[id]) {
      pasteFlag.current[id] = false;
      analyze(id, html);
    }
    // Auto-title from the first non-empty line.
    const plainText = htmlToPlainText(html);
    if (plainText.trim() && !titleTouched.current[id]) {
      const firstLine = plainText.split("\n").map((l) => l.trim()).find(Boolean) || "";
      const auto = firstLine.slice(0, 40) || (active?.title || "Scratch");
      setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, title: auto } : x)));
    }
    // Fire live text prediction trigger
    triggerAutocomplete(plainText);

    // Sync content into React state so persistence (localStorage + server)
    // and the Arabic overlay fire.
    setTabs((prev) => {
      const cur = prev.find((x) => x.id === id);
      if (cur && cur.content === html) return prev;
      return prev.map((x) => (x.id === id ? { ...x, content: html } : x));
    });
  }, [active?.title, analyze, ghostCompletion, scheduleHistoryPush, triggerAutocomplete]);

  const onPaste = (e: React.ClipboardEvent) => {
    pasteFlag.current[activeId] = true;
    if (!pastePlain) {
      requestAnimationFrame(updateScrollAffordances);
      return;
    }
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    const editor = editorRef.current;
    if (!editor) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !editor.contains(sel.anchorNode)) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    sel.removeAllRanges();
    sel.addRange(range);
    onEditorInput();
    requestAnimationFrame(updateScrollAffordances);
  };

  // Intercept Tab / ArrowRight to accept inline ghost text auto-complete,
  // and Ctrl/Cmd+Z/Y for undo/redo history.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === "Tab" || e.key === "ArrowRight") && ghostCompletion && enablePredictions) {
        e.preventDefault();
        const editor = editorRef.current;
        if (editor) {
          const textNode = document.createTextNode(" " + ghostCompletion);
          const sel = window.getSelection();
          if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
            const range = sel.getRangeAt(0);
            range.insertNode(textNode);
            range.setStartAfter(textNode);
            range.setEndAfter(textNode);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            editor.appendChild(textNode);
          }
          setGhostCompletion("");
          setCaretPos(null);
          onEditorInput();
        }
        return;
      }
      if ((e.key === "Escape" || e.key === "Backspace") && ghostCompletion) {
        setGhostCompletion("");
        setCaretPos(null);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        historyUndo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        historyRedo();
      }
    },
    [ghostCompletion, historyUndo, historyRedo, onEditorInput]
  );

  const nextTitle = useCallback((prev: ScratchTab[]) => {
    let n = prev.length + 1;
    const used = new Set(prev.map((x) => x.title));
    while (used.has(`Scratch ${n}`)) n++;
    return `Scratch ${n}`;
  }, []);

  const addTab = () => {
    const id = uid();
    setTabs((prev) => [...prev, { id, title: nextTitle(prev), content: "" }]);
    setActiveId(id);
  };

  // Archive soft-hides a tab (content preserved) instead of deleting it.
  const archiveTab = (id: string) => {
    const target = tabs.find((x) => x.id === id);
    if (!window.confirm(`Are you sure you want to archive note "${target?.title || "Scratch"}"?`)) return;
    setTabs((prev) => {
      const archived = prev.map((x) => (x.id === id ? { ...x, archived: true, archivedAt: Date.now() } : x));
      const remaining = archived.filter((x) => !x.archived);
      if (id === activeId) {
        if (remaining.length) {
          setActiveId(remaining[0].id);
        } else {
          const fresh = { id: uid(), title: "Scratch 1", content: "" };
          setTabs((cur) => [...cur, fresh]);
          setActiveId(fresh.id);
        }
      }
      return archived;
    });
  };

  const restoreTab = (id: string) => {
    setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, archived: false } : x)));
  };

  const closeTab = (id: string, skipConfirm: boolean = false) => {
    const target = tabs.find((x) => x.id === id);
    if (!skipConfirm && !window.confirm(`Are you sure you want to delete "${target?.title || "Scratch"}"?`)) return;
    if (tabs.length === 1) {
      const fresh = { id: uid(), title: "Scratch 1", content: "" };
      setTabs([fresh]);
      setActiveId(fresh.id);
      setDetections({});
      setRephraseUndo({});
      titleTouched.current = {};
      return;
    }
    setTabs((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
    delete titleTouched.current[id];
    setDetections((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    setRephraseUndo((u) => {
      const n = { ...u };
      delete n[id];
      return n;
    });
  };

  const commitRename = (id: string) => {
    const name = renameValue.trim();
    if (name) {
      titleTouched.current[id] = true;
      setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, title: name } : x)));
    }
    setRenameId(null);
    setRenameValue("");
  };

  const startRename = (id: string) => {
    const cur = tabs.find((x) => x.id === id);
    setRenameId(id);
    setRenameValue(cur?.title || "");
  };

  const handleSaveNote = async () => {
    const plainText = htmlToPlainText(active?.content || "").trim();
    if (!plainText) return;
    const items: Array<Partial<AnalyzeCandidate> & { notes?: string; source_file?: string }> = [
      {
        value: plainText,
        type: "note",
        name: active?.title || "Scratch",
        raw_fragment: active?.content || "",
        labels: [],
        type_aliases: ["note"],
        family: "note",
        notes: plainText,
      },
    ];
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: true } }));
    setStatus(t("scratchpad_saving"));
    try {
      const res = await fetch("/api/entries/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: items.map((c) => ({
            value: c.value,
            type: c.type,
            name: c.name,
            raw_fragment: c.raw_fragment,
            labels: c.labels,
            type_aliases: c.type_aliases,
            family: c.family,
            notes: c.notes,
            source_file: "scratchpad",
          })),
        }),
      });
      if (res.ok) {
        setStatus(t("scratchpad_saved_ok"));
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus(err.error || t("scratchpad_save_err"));
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_save_err"));
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: false } }));
    }
  };

  const handleSaveSecret = async () => {
    const plainText = htmlToPlainText(active?.content || "").trim();
    if (!plainText) return;
    const stripUrl = (v: string) => v.replace(/^https?:\/\//, "");
    const secretItems: Array<Partial<AnalyzeCandidate> & { notes?: string }> =
      detection?.candidates?.filter((c) => c.family === "secret" || c.family === "unknown") || [];
    const items: Array<Partial<AnalyzeCandidate> & { notes?: string; source_file?: string }> =
      secretItems.length > 0
        ? secretItems.map((c) => ({ ...c, value: stripUrl(c.value || "") }))
        : [
            {
              value: stripUrl(plainText),
              type: "note",
              name: active?.title || "Scratch",
              raw_fragment: plainText,
              labels: [],
              type_aliases: ["note"],
              family: "note",
              notes: plainText,
              source_file: "scratchpad",
            },
          ];
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: true } }));
    setStatus(t("scratchpad_saving"));
    try {
      const res = await fetch("/api/entries/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: items.map((c) => ({
            value: c.value,
            type: c.type,
            name: c.name,
            raw_fragment: c.raw_fragment,
            labels: c.labels,
            type_aliases: c.type_aliases,
            family: c.family,
            notes: c.notes,
            source_file: c.family === "note" ? "scratchpad" : c.source_file,
          })),
        }),
      });
      if (res.ok) {
        setStatus(t("scratchpad_saved_ok"));
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus(err.error || t("scratchpad_save_err"));
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_save_err"));
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: false } }));
    }
  };

  const handleRephrase = async () => {
    const original = active?.content || "";
    const text = htmlToPlainText(original).trim();
    if (!text) return;
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], rewrite: true } }));
    setStatus(t("scratchpad_rewriting"));
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, style }),
      });
      const data = await res.json();
      if (res.ok && data.rewritten) {
        setRephraseUndo((prev) => ({
          ...prev,
          [activeId]: [...(prev[activeId] || []), original],
        }));
        const newHtml = data.rewritten.replace(/\n/g, "<br>");
        // setContent routes through setEditorHtml for the active tab, which
        // updates DOM + history + state together â€” no direct innerHTML write.
        setContent(activeId, newHtml);
        setStatus(t("scratchpad_rephrased"));
        analyze(activeId, data.rewritten);
      } else {
        setStatus(data.error || t("scratchpad_rewrite_err"));
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_rewrite_err"));
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], rewrite: false } }));
    }
  };

  const handleProofread = async () => {
    const original = active?.content || "";
    const text = htmlToPlainText(original).trim();
    if (!text) return;
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], proofread: true } }));
    setStatus(t("scratchpad_proofreading" as any) || "Proofreading...");
    try {
      const res = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (res.ok && data.corrected) {
        setRephraseUndo((prev) => ({
          ...prev,
          [activeId]: [...(prev[activeId] || []), original],
        }));
        const newHtml = data.corrected.replace(/\n/g, "<br>");
        setContent(activeId, newHtml);
        setStatus(t("scratchpad_proofread_ok" as any) || "Proofread complete");
        analyze(activeId, data.corrected);
      } else {
        setStatus(data.error || t("scratchpad_proofread_err" as any) || "Proofread failed");
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_proofread_err" as any) || "Proofread failed");
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], proofread: false } }));
    }
  };

  const handleUndoRephrase = () => {
    const stack = rephraseUndo[activeId] || [];
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    setRephraseUndo((prev) => ({
      ...prev,
      [activeId]: stack.slice(0, -1),
    }));
    setContent(activeId, previous);
    setStatus(t("scratchpad_rephrase_undone"));
    analyze(activeId, previous);
  };

   const handleCopy = async () => {
     try {
       await navigator.clipboard.writeText(htmlToPlainText(active?.content || ""));
       setCopied(true);
       setTimeout(() => setCopied(false), 1500);
     } catch {}
   };

  const updateScrollAffordances = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) {
      setNoteOverflows(false);
      setCanScrollUp(false);
      setCanScrollDown(false);
      return;
    }
    // Use a small epsilon so sub-pixel layout doesn't hide the controls.
    const overflow = editor.scrollHeight > editor.clientHeight + 2;
    const top = editor.scrollTop;
    const maxScroll = Math.max(0, editor.scrollHeight - editor.clientHeight);
    setNoteOverflows(overflow);
    setCanScrollUp(overflow && top > 2);
    setCanScrollDown(overflow && top < maxScroll - 2);
  }, []);

  const scrollEditor = useCallback(
    (direction: "top" | "bottom") => {
      const editor = editorRef.current;
      if (!editor) return;
      if (direction === "top") {
        editor.scrollTop = 0;
        // Bring note + app chrome into view (no hand-scrolling the page).
        const reveal = scratchRootRef.current ?? shellRef.current ?? editor;
        scrollContainerToReveal(reveal);
      } else {
        editor.scrollTop = editor.scrollHeight;
        // Keep the editor frame on screen while jumping to the end.
        scrollContainerToReveal(shellRef.current ?? editor);
      }
      // Double rAF: layout settles after scroll, then remeasure FABs/underlines.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updateScrollAffordances();
          recomputeSpellRects();
        });
      });
    },
    [updateScrollAffordances, recomputeSpellRects]
  );

  const onEditorScroll = useCallback(() => {
    updateScrollAffordances();
    // Underlines are viewport-relative to the editor box — must refresh on scroll.
    recomputeSpellRects();
  }, [updateScrollAffordances, recomputeSpellRects]);

  // Re-measure scroll affordances + spell rects after content/tab/layout change.
  useLayoutEffect(() => {
    updateScrollAffordances();
    recomputeSpellRects();
  }, [active?.content, activeId, misspelledWords, bidiMode, noteFontSize, updateScrollAffordances, recomputeSpellRects]);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      updateScrollAffordances();
      recomputeSpellRects();
    });
    ro.observe(editor);
    return () => ro.disconnect();
  }, [activeId, updateScrollAffordances, recomputeSpellRects]);

  // Effective dir attribute for the editor + overlay.
  const noteDir: "auto" | "ltr" | "rtl" = bidiMode === "auto" ? "auto" : bidiMode;
  const detectedDir = detectBaseDir(htmlToPlainText(active?.content || ""));

  return (
    <div ref={scratchRootRef} className="space-y-4">
      {/* Internal tabs */}
      <div className="flex items-center gap-2 flex-wrap" style={{ background: "var(--bg-surface)", borderRadius: "0.75rem", padding: "4px", border: "1px solid var(--border)" }}>
        {tabs.filter((t) => !t.archived).map((tab) => {
          const isActive = tab.id === activeId;
          const renaming = renameId === tab.id;
          return (
            <div
              key={tab.id}
              draggable
              onClick={() => setActiveId(tab.id)}
              onDragStart={(e) => {
                setDragId(tab.id);
                e.dataTransfer.effectAllowed = "move";
                try { e.dataTransfer.setData("text/plain", tab.id); } catch {}
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overId !== tab.id) setOverId(tab.id);
              }}
              onDragLeave={() => {
                if (overId === tab.id) setOverId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = dragId ?? e.dataTransfer.getData("text/plain");
                if (fromId) reorderTab(fromId, tab.id);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
className="group relative flex h-8 w-[150px] items-center gap-1.5 px-3 py-0 rounded-lg cursor-pointer text-xs font-medium transition-all flex-shrink-0"
               style={{
                 background: isActive ? "var(--bg-surface)" : "var(--bg-base)",
                 color: isActive ? "var(--text)" : "var(--text-dim)",
                 border: `1px solid ${isActive ? "var(--border-glow)" : "var(--border)"}`,
               }}
              title={t("scratchpad_drag_to_reorder")}
            >
              {renaming ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename(tab.id);
                    if (e.key === "Escape") { setRenameId(null); setRenameValue(""); }
                  }}
                  onBlur={() => commitRename(tab.id)}
                  className="bg-transparent outline-none text-xs w-full truncate"
                  style={{ color: "var(--text)" }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(tab.id); }}
                  className="truncate flex-1 min-w-0"
                  title={tab.title}
                >
                  {tab.title}
                </span>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); startRename(tab.id); }}
                className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
                aria-label={t("scratchpad_rename")}
                title={t("scratchpad_rename")}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); archiveTab(tab.id); }}
                className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
                aria-label={t("scratchpad_archive")}
                title={t("scratchpad_archive")}
              >
                <Archive className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
                className="opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity flex-shrink-0"
                aria-label="Close tab"
                title="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addTab}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-all flex-shrink-0"
          style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}
          title={t("scratchpad_add")}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Editor + actions */}
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => analyze(activeId, htmlToPlainText(active?.content || ""))}
            disabled={b.analyze || !htmlToPlainText(active?.content || "").trim()}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
            style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            {b.analyze ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {b.analyze ? t("scratchpad_detecting") : t("scratchpad_detect")}
          </button>

          {hasSecret ? (
            <button
              type="button"
              onClick={handleSaveSecret}
              disabled={b.save}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
              style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52, 211, 153, 0.2)" }}
            >
              {b.save ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
              {b.save ? t("scratchpad_saving") : t("scratchpad_save_secret")}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSaveNote}
              disabled={b.save}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
              style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
            >
              {b.save ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              {b.save ? t("scratchpad_saving") : t("scratchpad_save_note")}
            </button>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
            style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? t("scratchpad_copied") : t("scratchpad_copy")}
          </button>

           <button
             type="button"
            onClick={() => {
              if (window.confirm("Are you sure you want to clear this note's content?")) {
                setContent(activeId, "");
              }
            }}
             className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
             style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
           >
            <Trash2 className="w-3.5 h-3.5" />
              {t("scratchpad_clear")}
            </button>

            {settings?.enable_ai_proofreader !== false && (
              <button
                type="button"
                onClick={handleProofread}
                disabled={b.proofread || !(active?.content || "").trim()}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
                style={{ background: "transparent", color: "var(--amber)", border: "1px solid rgba(245, 158, 11, 0.2)" }}
                title={t("scratchpad_proofread")}
              >
                {b.proofread ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
                {t("scratchpad_proofread")}
              </button>
            )}

            <button
              type="button"
              onClick={togglePredictions}
              title={enablePredictions ? "AI Predictions Enabled (Click to Disable)" : "AI Predictions Disabled (Click to Enable)"}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              style={{
                background: enablePredictions ? "rgba(99, 102, 241, 0.15)" : "transparent",
                color: enablePredictions ? "var(--accent-bright)" : "var(--text-muted)",
                border: `1px solid ${enablePredictions ? "rgba(99, 102, 241, 0.4)" : "var(--border)"}`,
              }}
            >
              {enablePredictions ? <Zap className="w-3.5 h-3.5" /> : <ZapOff className="w-3.5 h-3.5" />}
              <span>Predictions: <strong>{enablePredictions ? "ON" : "OFF"}</strong></span>
            </button>

           <div className="flex-1" />

          {/* Rephrase controls, moved to the right side. */}
          <div className="flex items-center gap-1">
            {(rephraseUndo[activeId]?.length ?? 0) > 0 && (
              <button
                type="button"
                onClick={handleUndoRephrase}
                disabled={b.rewrite}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
                style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                title={t("scratchpad_rephrase_undo")}
              >
                <Undo2 className="w-3.5 h-3.5" />
                {t("scratchpad_rephrase_undo")}
              </button>
            )}
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value as RewriteStyle)}
              className="rounded-lg px-2 py-1.5 text-xs focus:outline-none"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
            >
              {REWRITE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {t(REWRITE_STYLE_KEYS[s] as Parameters<typeof getTranslation>[1])}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRephrase}
              disabled={b.rewrite || !(active?.content || "").trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
              style={{ background: "var(--bg-active)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
            >
              {b.rewrite ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
              {b.rewrite ? t("scratchpad_rewriting") : t("scratchpad_rephrase")}
            </button>
          </div>
        </div>

        {statusMsg && (
          <p className="text-xs" style={{ color: "var(--accent-bright)" }}>
            {statusMsg}
          </p>
        )}

        <div
          ref={shellRef}
          className="note-editor-shell"
          style={
            {
              ["--note-font-size" as string]: `${noteFontSize}px`,
              background: "var(--bg-input)",
              borderRadius: "0.75rem",
            } as React.CSSProperties
          }
        >
          {/* Frame is height-locked to the viewport. Jump FABs pin to its
              top/bottom corners so they stay reachable on very long notes. */}
          <div className="note-editor-frame">
            <div
              ref={editorRef}
              key={activeId}
              contentEditable
              suppressContentEditableWarning
              dir={noteDir}
              data-bidi={bidiMode}
              lang={bidiMode === "rtl" ? "ar" : bidiMode === "ltr" ? "en" : undefined}
              spellCheck={false}
              onInput={() => {
                onEditorInput();
                requestAnimationFrame(() => {
                  updateScrollAffordances();
                  recomputeSpellRects();
                });
              }}
              onPaste={onPaste}
              onKeyDown={onKeyDown}
              onContextMenu={onContextMenu}
              onScroll={onEditorScroll}
              className="note-editor relative z-10 w-full rounded-xl px-3 py-2 focus:outline-none transition-colors"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border-input)",
                color: "var(--text)",
              }}
            />
            {spellRects.length > 0 && (
              <div
                aria-hidden="true"
                className="spell-rect-layer"
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 15,
                  pointerEvents: "none",
                  overflow: "hidden",
                  borderRadius: "0.75rem",
                }}
              >
                {spellRects.map((r) => (
                  <span
                    key={r.key}
                    className="spell-rect-underline"
                    style={{
                      position: "absolute",
                      top: r.top + r.height - 3,
                      left: r.left,
                      width: r.width,
                      height: 3,
                    }}
                  />
                ))}
              </div>
            )}

            {/* Non-intrusive floating prediction overlay badge (Zero DOM mutations) */}
            {ghostCompletion && enablePredictions && (
              <div
                className="absolute bottom-3 right-4 z-30 flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs backdrop-blur-md shadow-2xl animate-in fade-in zoom-in-95 pointer-events-auto"
                style={{
                  background: "rgba(15, 23, 42, 0.92)",
                  border: "1px solid rgba(99, 102, 241, 0.4)",
                  boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.6)",
                }}
              >
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-muted">Prediction:</span>
                <span className="font-medium text-white italic">{ghostCompletion}</span>
                <button
                  type="button"
                  onClick={() => {
                    const editor = editorRef.current;
                    if (editor) {
                      const textNode = document.createTextNode(" " + ghostCompletion);
                      const sel = window.getSelection();
                      if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
                        const range = sel.getRangeAt(0);
                        range.insertNode(textNode);
                        range.setStartAfter(textNode);
                        range.setEndAfter(textNode);
                        sel.removeAllRanges();
                        sel.addRange(range);
                      } else {
                        editor.appendChild(textNode);
                      }
                      setGhostCompletion("");
                      onEditorInput();
                    }
                  }}
                  className="ml-1 px-2 py-0.5 rounded font-mono text-[10px] font-bold hover:brightness-125 transition-all cursor-pointer"
                  style={{
                    background: "rgba(99, 102, 241, 0.25)",
                    border: "1px solid rgba(99, 102, 241, 0.5)",
                    color: "var(--accent-bright)",
                  }}
                >
                  Tab ↹ Accept
                </button>
                <button
                  type="button"
                  onClick={() => setGhostCompletion("")}
                  className="text-muted hover:text-white text-xs px-1 cursor-pointer"
                  title="Dismiss"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Custom Spelling Context Menu Popup */}
            {contextMenu && (
              <div
                className="fixed z-50 rounded-xl shadow-2xl p-2 w-64 space-y-1 text-xs backdrop-blur-md animate-in fade-in zoom-in-95"
                style={{
                  top: Math.min(contextMenu.y, window.innerHeight - 280),
                  left: Math.min(contextMenu.x, window.innerWidth - 270),
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-glow)",
                  boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)",
                }}
              >
                <div className="px-2 py-1 font-semibold text-muted border-b border-border flex items-center justify-between">
                  <span>Spelling: <strong className="text-white">{contextMenu.word}</strong></span>
                  <button onClick={() => setContextMenu(null)} className="opacity-60 hover:opacity-100">✕</button>
                </div>

                {contextMenu.loading ? (
                  <div className="flex items-center gap-2 px-2 py-2 text-muted italic">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-bright" />
                    <span>Finding suggestions...</span>
                  </div>
                ) : contextMenu.suggestions.length > 0 ? (
                  <div className="space-y-0.5 max-h-40 overflow-y-auto">
                    {contextMenu.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => handleApplySuggestion(s)}
                        className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg hover:text-accent-bright font-medium transition-colors flex items-center gap-1.5"
                      >
                        <Sparkles className="w-3 h-3 text-amber" />
                        {s}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="px-2 py-1 text-muted italic">No suggestions</p>
                )}

                <div className="border-t border-border pt-1 space-y-0.5">
                  <button
                    onClick={() => handleAddToDictionary(contextMenu.word)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface-highlight hover:text-emerald font-medium transition-colors flex items-center gap-1.5"
                  >
                    <BookPlus className="w-3.5 h-3.5 text-emerald" />
                    Add "{contextMenu.word}" to Dictionary
                  </button>

                  <button
                    onClick={() => handleIgnoreWord(contextMenu.word)}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-surface-highlight hover:text-muted font-medium transition-colors flex items-center gap-1.5"
                  >
                    <EyeOff className="w-3.5 h-3.5 text-muted" />
                    Ignore "{contextMenu.word}"
                  </button>
                </div>
              </div>
            )}
            {/* Always-visible corners of the editor frame (not mid-document). */}
            {noteOverflows && (
              <>
                <button
                  type="button"
                  onClick={() => scrollEditor("top")}
                  className={`note-jump-btn note-jump-btn--top p-2 transition-all hover:opacity-100 ${
                    canScrollUp ? "opacity-95" : "opacity-50"
                  }`}
                  style={{
                    background: "var(--bg-surface-solid)",
                    color: "var(--accent-bright)",
                    border: "1px solid var(--border-glow)",
                  }}
                  title={t("scratchpad_go_to_top")}
                  aria-label={t("scratchpad_go_to_top")}
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollEditor("bottom")}
                  className={`note-jump-btn note-jump-btn--bottom p-2 transition-all hover:opacity-100 ${
                    canScrollDown ? "opacity-95" : "opacity-50"
                  }`}
                  style={{
                    background: "var(--bg-surface-solid)",
                    color: "var(--accent-bright)",
                    border: "1px solid var(--border-glow)",
                  }}
                  title={t("scratchpad_go_to_bottom")}
                  aria-label={t("scratchpad_go_to_bottom")}
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        </div>

         {/* Formatting toolbar */}
        <div
          ref={toolbarRef}
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center gap-0.5 flex-wrap"
          style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}
        >
          {/* Dual-language BIDI base direction */}
          <div
            className="flex items-center rounded-lg overflow-hidden me-1"
            style={{ border: "1px solid var(--border)" }}
            title={t("scratchpad_bidi_hint")}
          >
            {(
              [
                { mode: "auto" as const, icon: Languages, labelKey: "scratchpad_bidi_auto" as const },
                { mode: "ltr" as const, icon: AlignLeft, labelKey: "scratchpad_bidi_ltr" as const },
                { mode: "rtl" as const, icon: AlignRight, labelKey: "scratchpad_bidi_rtl" as const },
              ]
            ).map(({ mode, icon: Icon, labelKey }) => {
              const activeBidi = bidiMode === mode;
              const title =
                mode === "auto"
                  ? `${t(labelKey)} (${detectedDir.toUpperCase()})`
                  : t(labelKey);
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setBidiMode(mode)}
                  className="p-1.5 transition-all"
                  style={{
                    color: activeBidi ? "var(--accent-bright)" : "var(--text-dim)",
                    background: activeBidi ? "var(--accent-bg)" : "transparent",
                  }}
                  title={title}
                  aria-label={title}
                  aria-pressed={activeBidi}
                >
                  <Icon className="w-3.5 h-3.5" />
                </button>
              );
            })}
          </div>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Jump top/bottom — always in the toolbar so long notes never hide them */}
          <button
            type="button"
            onClick={() => scrollEditor("top")}
            disabled={!noteOverflows && !canScrollUp}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_go_to_top")}
            aria-label={t("scratchpad_go_to_top")}
          >
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => scrollEditor("bottom")}
            disabled={!noteOverflows && !canScrollDown}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_go_to_bottom")}
            aria-label={t("scratchpad_go_to_bottom")}
          >
            <ArrowDown className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Undo / Redo */}
          <button
            type="button"
            onClick={historyUndo}
            disabled={!historyCanUndo}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_undo")}
          >
            <Undo className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={historyRedo}
            disabled={!historyCanRedo}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70 disabled:opacity-30 disabled:cursor-not-allowed"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_redo")}
          >
            <Redo className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Bold / Italic / Underline */}
          <button
            type="button"
            onClick={() => execFormat("bold")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_bold")}
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => execFormat("italic")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_italic")}
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => execFormat("underline")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_underline")}
          >
            <Underline className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Text color */}
          <div className="relative">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => execFormat("foreColor", textColor)}
                
                className="p-1.5 rounded-l-lg transition-all hover:opacity-100 opacity-70"
                style={{ color: "var(--text-dim)" }}
                title={t("scratchpad_text_color")}
              >
                <Palette className="w-3.5 h-3.5" />
                <span
                  className="absolute bottom-0.5 left-2 w-2 h-0.5 rounded-full"
                  style={{ background: textColor }}
                />
              </button>
              <button
                type="button"
                onClick={() => { setShowTextColorPicker((s) => !s); setShowHighlightPicker(false); }}
                
                className="px-0.5 py-1.5 rounded-r-lg transition-all hover:opacity-100 opacity-70 text-[8px]"
                style={{ color: "var(--text-dim)" }}
              >
                â–¾
              </button>
            </div>
            {showTextColorPicker && (
              <div
                className="absolute bottom-full left-0 mb-1 flex gap-1 p-1.5 rounded-lg z-50"
                style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border)" }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {TEXT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => { setTextColor(c.hex); execFormat("foreColor", c.hex); }}
                    
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{
                      background: c.hex,
                      borderColor: textColor === c.hex ? "var(--accent-bright)" : "transparent",
                    }}
                    title={t(c.key as Parameters<typeof getTranslation>[1])}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Highlight color */}
          <div className="relative">
            <div className="flex items-center">
              <button
                type="button"
                onClick={() => execFormat("hiliteColor", highlightColor)}
                
                className="p-1.5 rounded-l-lg transition-all hover:opacity-100 opacity-70"
                style={{ color: "var(--text-dim)" }}
                title={t("scratchpad_highlight")}
              >
                <Highlighter className="w-3.5 h-3.5" />
                <span
                  className="absolute bottom-0.5 left-2 w-2 h-0.5 rounded-full"
                  style={{ background: highlightColor }}
                />
              </button>
              <button
                type="button"
                onClick={() => { setShowHighlightPicker((s) => !s); setShowTextColorPicker(false); }}
                
                className="px-0.5 py-1.5 rounded-r-lg transition-all hover:opacity-100 opacity-70 text-[8px]"
                style={{ color: "var(--text-dim)" }}
              >
                â–¾
              </button>
            </div>
            {showHighlightPicker && (
              <div
                className="absolute bottom-full left-0 mb-1 flex gap-1 p-1.5 rounded-lg z-50"
                style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border)" }}
                onMouseDown={(e) => e.preventDefault()}
              >
                {HIGHLIGHT_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => { setHighlightColor(c.hex); execFormat("hiliteColor", c.hex); }}
                    
                    className="w-5 h-5 rounded-full border-2 transition-all"
                    style={{
                      background: c.hex,
                      borderColor: highlightColor === c.hex ? "var(--accent-bright)" : "transparent",
                    }}
                    title={t(c.key as Parameters<typeof getTranslation>[1])}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Clear formatting */}
          <button
            type="button"
            onClick={() => execFormat("removeFormat")}
            
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{ color: "var(--text-dim)" }}
            title={t("scratchpad_clear_format")}
          >
            <Eraser className="w-3.5 h-3.5" />
          </button>

          <div className="w-px h-4 mx-0.5" style={{ background: "var(--border)" }} />

          {/* Paste mode toggle */}
          <button
            type="button"
            onClick={() => setPastePlain((v) => !v)}
            className="p-1.5 rounded-lg transition-all hover:opacity-100 opacity-70"
            style={{
              color: pastePlain ? "var(--accent-bright)" : "var(--text-dim)",
              background: pastePlain ? "var(--accent-bg)" : "transparent",
              border: pastePlain ? "1px solid var(--border-glow)" : "1px solid transparent",
            }}
            title={pastePlain ? t("paste_plain_on") : t("paste_plain_off")}
          >
            <ClipboardPaste className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Detection status, moved to underneath the text box. */}
        {detection ? (
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {t("scratchpad_ai_detected")}: {detection.families.join(", ")}
            {detection.provider ? ` Â· ${detection.provider}` : ""}
          </span>
        ) : (
          <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
            {t("scratchpad_no_detection")}
          </span>
        )}
      </div>

      {/* Archived tabs */}
      {tabs.some((x) => x.archived) && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <button
            type="button"
            onClick={() => setShowArchived((s) => !s)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold"
            style={{ color: "var(--text-dim)" }}
          >
            <span className="flex items-center gap-2">
              <Archive className="w-3.5 h-3.5" />
              {t("scratchpad_archived")} ({tabs.filter((x) => x.archived).length})
            </span>
            <span>{showArchived ? "â–¾" : "â–¸"}</span>
          </button>
          {showArchived && (
            <div className="px-4 pb-3 flex flex-col gap-1.5">
              {tabs
                .filter((x) => x.archived)
                .sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
                .map((tab) => (
                  <div
                    key={tab.id}
                    className="flex items-center gap-2 py-1.5 px-2 rounded-lg"
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
                  >
                    <span
                      className="flex-1 truncate text-xs cursor-pointer"
                      style={{ color: "var(--text-muted)" }}
                      onClick={() => {
                        restoreTab(tab.id);
                        setActiveId(tab.id);
                      }}
                      title={t("scratchpad_restore")}
                    >
                      {tab.title || "Untitled"}
                    </span>
                    <button
                      type="button"
                      onClick={() => restoreTab(tab.id)}
                      className="opacity-70 hover:opacity-100 transition-opacity"
                      aria-label={t("scratchpad_restore")}
                      title={t("scratchpad_restore")}
                    >
                      <ArchiveRestore className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Are you sure you want to permanently delete "${tab.title || "Untitled"}"?`)) {
                          closeTab(tab.id, true);
                        }
                      }}
                      className="opacity-70 hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
                      aria-label={t("scratchpad_delete")}
                      title={t("scratchpad_delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ScratchpadTab;
