import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Highlight from "@tiptap/extension-highlight";
import TiptapUnderline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
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
  AlignJustify,
  Languages,
  BookPlus,
  EyeOff,
  Zap,
  ZapOff,
  History,
  Clock,
  RotateCcw,
} from "lucide-react";
import {
  VaultEntry,
  Settings,
  RewriteStyle,
  Detection,
  AnalyzeCandidate,
  Busy,
  ScratchTab,
  NoteBidiMode,
} from "../types";
import { getTranslation } from "../utils/i18n";
import { sanitizeNoteHtml, textToNoteHtml } from "../sanitize";
import { enqueueScratchpadSave, drainScratchpadSaves, setScratchpadConflictHandler, setSyncedScratchpadTabs, forceSaveScratchpadTab } from "../scratchpadSaveQueue";
import { takeHandoffNote, REOPEN_NOTE_EVENT } from "../noteHandoff";
import { isArabicText } from "../utils";

export interface NoteRevision {
  id: string;
  tabId: string;
  timestamp: number;
  title: string;
  content: string;
  charCount: number;
  wordCount: number;
  reason?: string;
}

const STORAGE_KEY = "indexarc_scratchpad_tabs";
const REVISIONS_KEY_PREFIX = "indexarc_note_revisions_";

// Revisions live on the SERVER (data/note_revisions.json) — the durable,
// encrypted store. The browser keeps no copy (the old idb-keyval/localStorage
// revisions died with the client-persistence cleanup).
export async function getNoteRevisions(tabId: string): Promise<NoteRevision[]> {
  try {
    const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(tabId)}/revisions`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.revisions)) return data.revisions;
    }
  } catch {}
  return [];
}

export async function saveNoteRevision(rev: NoteRevision, _maxKeep = 30): Promise<void> {
  try {
    const existing = await getNoteRevisions(rev.tabId);
    if (existing.length > 0 && existing[0].content === rev.content) return;
    await fetch(`/api/scratchpad/tabs/${encodeURIComponent(rev.tabId)}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rev),
    });
  } catch {}
}
const REWRITE_STYLES: RewriteStyle[] = ["professional", "casual", "human", "technical", "concise", "formal"];
const REWRITE_STYLE_KEYS: Record<RewriteStyle, Parameters<typeof getTranslation>[1]> = {
  professional: "rewrite_style_professional",
  casual: "rewrite_style_casual",
  human: "rewrite_style_human",
  technical: "rewrite_style_technical",
  concise: "rewrite_style_concise",
  formal: "rewrite_style_formal",
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

export function ensureHtmlParagraphs(content: string): string {
  if (!content) return "<p></p>";
  // If it already has block-level HTML tags (<p>, <div>, <h1>-<h6>, <ul>, <ol>, <li>, <blockquote>, <pre>), preserve structure
  if (/<(p|div|h[1-6]|ul|ol|li|blockquote|pre|table)\b/i.test(content)) {
    return content.replace(/<br\s*\/?>/gi, "</p><p>");
  }
  // Plain text with newlines (\r\n or \n) -> convert to <p> tags
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const html = lines
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return "<p></p>";
      const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<p>${escaped}</p>`;
    })
    .join("");
  return html || "<p></p>";
}

export function smartFormatParagraphs(content: string): string {
  if (!content || !content.trim()) return "<p></p>";

  // 1. Convert block closers and <br> tags to newlines
  let text = content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|article|section)>/gi, "\n\n")
    .replace(/<[^>]+>/g, ""); // Strip remaining HTML tags

  // 2. Decode HTML entities
  text = text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 3. Normalize line breaks and spaces
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // 4. Intelligently insert breaks for combined single-block text:
  // (a) Split on bullet characters and numbered list items (e.g., " 1. ", " 2) ", " - ", " • ")
  text = text
    .replace(/(\s+)(\d+[\.\)]\s+)/g, "\n\n$2")
    .replace(/(\s+)(\(\d+\)\s+)/g, "\n\n$2")
    .replace(/(\s+)([-*•–—]\s+)/g, "\n\n$2");

  // (b) Split on header/field colons (e.g. " Note: ", " Title: ", " ملاحظة: ")
  text = text
    .replace(/(\s+)([A-Za-z\u0600-\u06FF\s]{2,25}:(?:\s+))/g, "\n\n$2");

  // (c) Split after sentence terminators (. ! ? ؟ ؛ ;) followed by space
  text = text
    .replace(/([\.\!\?؟؛](\s+))/g, "$1\n\n");

  // 5. Build clean HTML <p> tags from the resulting lines
  const paragraphs = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (paragraphs.length === 0) return "<p></p>";

  return paragraphs
    .map((p) => {
      const escaped = p
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      return `<p>${escaped}</p>`;
    })
    .join("");
}

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
        return parsed
          .filter((x: any) => !x.archived)
          .map((x: any) => ({
            id: x.id || uid(),
            title: x.title || "Scratch",
            content: ensureHtmlParagraphs(x.content || ""),
            archived: false,
          }));
      }
    }
  } catch {}
  return [{ id: uid(), title: "Scratch 1", content: "<p></p>" }];
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
function scrollContainerToReveal(el: HTMLElement) {  const main = el.closest("main") as HTMLElement | null;
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

/** Safely read HTML from a TipTap editor. Returns "" if the editor is
 *  destroyed/null (e.g. during React StrictMode remount or editor
 *  recreation) — `getHTML()` on a destroyed editor throws internally. */
function safeGetHTML(editor: any): string {
  try {
    if (!editor || editor.isDestroyed) return "";
    return editor.getHTML();
  } catch {
    return "";
  }
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
  const [archivedCount, setArchivedCount] = useState<number>(0);
  const [archivedTabs, setArchivedTabs] = useState<ScratchTab[] | null>(null);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [previewArchivedTab, setPreviewArchivedTab] = useState<ScratchTab | null>(null);
  const [bidiMode, setBidiMode] = useState<NoteBidiMode>("auto");
  const [noteOverflows, setNoteOverflows] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [rephraseUndo, setRephraseUndo] = useState<Record<string, string[]>>({});
  const [historyVersion, setHistoryVersion] = useState(0);
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisionsList, setRevisionsList] = useState<NoteRevision[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<NoteRevision | null>(null);
  const [clearedAlert, setClearedAlert] = useState<{ tabId: string; content: string; timestamp: number } | null>(null);
  // 409 conflict banner state: the server's current version of the tab whose
  // save conflicted, offered to the user when an autosave raced another window.
  const [conflictTab, setConflictTab] = useState<any>(null);

  const shellRef = useRef<HTMLDivElement>(null);
  const scratchRootRef = useRef<HTMLDivElement>(null);
  const titleTouched = useRef<Record<string, boolean>>({});
  const pasteFlag = useRef<Record<string, boolean>>({});
  const serverLoaded = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<Record<string, string>>({});
  const activeIdRef = useRef<string>(activeId);
  activeIdRef.current = activeId;
  const editorRef = useRef<HTMLDivElement>(null);
  const lastActiveTabId = useRef<string>("");
  const lastNonEmptyContentRef = useRef<Record<string, string>>({});
  const lastSnapshotTimeRef = useRef<Record<string, number>>({});
  const updateScrollAffordancesRef = useRef<() => void>(() => {});
  const recomputeSpellRectsRef = useRef<() => void>(() => {});
  const spellWorkerRef = useRef<Worker | null>(null);
  const misspelledRef = useRef(misspelledWords);
  misspelledRef.current = misspelledWords;
  const htmlToTextDiv = useRef<HTMLDivElement | null>(null);
  const autocompleteTimerRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedTabsSync = useRef<number | null>(null);

  const recordSnapshot = useCallback(
    async (tabId: string, content: string, reason?: string) => {
      if (!content || content === "<p></p>") return;
      const plain = content.replace(/<[^>]+>/g, "").trim();
      if (!plain) return;
      const curTab = tabs.find((x) => x.id === tabId);
      const title = curTab?.title || "Note";
      const charCount = plain.length;
      const wordCount = plain.split(/\s+/).filter(Boolean).length;
      await saveNoteRevision({
        id: uid(),
        tabId,
        timestamp: Date.now(),
        title,
        content,
        charCount,
        wordCount,
        reason,
      });
    },
    [tabs]
  );

  const handleOpenRevisions = useCallback(async () => {
    const list = await getNoteRevisions(activeId);
    setRevisionsList(list);
    setSelectedRevision(list.length > 0 ? list[0] : null);
    setShowRevisions(true);
  }, [activeId]);

  // Listen for "Reopen in Scratchpad" event from Library or Command Palette
  useEffect(() => {
    const handleReopenEvent = () => {
      const note = takeHandoffNote();
      if (!note || !note.title || !note.html) return;
      const newId = `note-${Date.now()}`;
      const newTab = { id: newId, title: note.title, content: ensureHtmlParagraphs(note.html), archived: false };
      setTabs((prev) => [...prev, newTab]);
      setActiveId(newId);
    };
    window.addEventListener(REOPEN_NOTE_EVENT, handleReopenEvent);
    handleReopenEvent();
    return () => window.removeEventListener(REOPEN_NOTE_EVENT, handleReopenEvent);
  }, []);

  const reorderTab = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((x) => x.id === fromId);
      const to = prev.findIndex((x) => x.id === toId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Persist the order explicitly (ids only) and resync the save queue's mirror.
      fetch("/api/scratchpad/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.filter((x) => !x.archived).map((x) => x.id) }),
      })
        .then(() => setSyncedScratchpadTabs(next))
        .catch(() => {});
      return next;
    });
  }, []);

  // TipTap industry editor — stable, transactional, BIDI-aware
  const tiptap = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        dropcursor: { width: 2, color: "var(--accent)" },
        // TipTap's transactional undo/redo (Ctrl+Z / Ctrl+Y, toolbar buttons).
        // The legacy custom innerHTML snapshot stack below is dormant.
        undoRedo: {},
      }),
      TiptapUnderline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Typography,
      Placeholder.configure({
        placeholder: () => getTranslation(settings, "scratchpad_placeholder" as any) || "Start writing…",
        showOnlyWhenEditable: true,
      }),
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "note-editor prose max-w-none",
        spellcheck: "false",
      },
    },
    onUpdate: ({ editor }) => {
      const html = safeGetHTML(editor);
      const id = activeIdRef.current;
      contentRef.current[id] = html;

      const plainText = html.replace(/<[^>]+>/g, "").trim();
      const prevNonEmpty = lastNonEmptyContentRef.current[id] || "";
      const prevTextLength = prevNonEmpty.replace(/<[^>]+>/g, "").trim().length;

      if (plainText.length > 0) {
        lastNonEmptyContentRef.current[id] = html;
        setClearedAlert(null);
        // Periodic auto snapshot (every 25 seconds of active typing)
        const now = Date.now();
        const lastSnap = lastSnapshotTimeRef.current[id] || 0;
        if (now - lastSnap > 25000) {
          lastSnapshotTimeRef.current[id] = now;
          recordSnapshot(id, html, "Auto snapshot");
        }
      } else if (prevTextLength > 30 && plainText.length === 0) {
        // Accidental clear / empty Ctrl+Z detected!
        setClearedAlert({
          tabId: id,
          content: prevNonEmpty,
          timestamp: Date.now(),
        });
      }

      if ((tiptap as any)._debouncedSync) window.clearTimeout((tiptap as any)._debouncedSync);
      (tiptap as any)._debouncedSync = window.setTimeout(() => {
        setTabs((prev) => {
          const cur = prev.find((x) => x.id === id);
          if (cur && cur.content === html) return prev;
          return prev.map((x) => (x.id === id ? { ...x, content: html } : x));
        });
      }, 280);
      const d = document.createElement("div");
      d.innerHTML = html.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n</$1>");
      const t2 = d.textContent || d.innerText || "";
      const plain = t2.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, " ");
      if (plain.trim() && !titleTouched.current[id]) {
        const firstLine = plain.split("\n").map((l) => l.trim()).find(Boolean) || "";
        const auto = firstLine.slice(0, 40) || "Scratch";
        setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, title: auto } : x)));
      }
      // Slash palette trigger — show when line ends with "/"
      try {
        const { from } = editor.state.selection;
        const textBefore = editor.state.doc.textBetween(Math.max(0, from - 2), from, "\n");
        setSlashOpen(textBefore.endsWith("/"));
      } catch { setSlashOpen(false); }
    },
  });

  // Keep editorRef in sync with TipTap DOM for spellcheck/scroll
  useEffect(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    const rawContent = contentRef.current[activeId] ?? tabs.find((x) => x.id === activeId)?.content ?? "";
    const html = ensureHtmlParagraphs(rawContent);
    const current = safeGetHTML(tiptap);
    const isTabSwitch = lastActiveTabId.current !== activeId;

    if (isTabSwitch) {
      lastActiveTabId.current = activeId;
      // Tab switched: Set content so Ctrl+Z is strictly scoped to this note
      // Note: clearHistory() was removed — TipTap v3 UndoRedo extension no longer exposes it,
      // and the custom history stack (historyRef) already handles per-tab undo scoping.
      tiptap.commands.setContent(html || "<p></p>", { emitUpdate: false });
      if (html && html !== "<p></p>") {
        lastNonEmptyContentRef.current[activeId] = html;
        recordSnapshot(activeId, html, "Opened snapshot");
      }
    } else if (current !== html && html !== "<p></p>") {
      tiptap.commands.setContent(html || "<p></p>");
      lastNonEmptyContentRef.current[activeId] = html;
    }
    // BIDI sync
    const plainForDir = (() => {
      const d = document.createElement("div");
      d.innerHTML = (html || "").replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n</$1>");
      const t = d.textContent || "";
      return t;
    })();
    const dir = bidiMode === "auto" ? detectBaseDir(plainForDir) : bidiMode;
    try {
      if (tiptap.view?.dom) {
        tiptap.view.dom.setAttribute("dir", dir);
        tiptap.view.dom.setAttribute("data-bidi", bidiMode);
        (editorRef as any).current = tiptap.view.dom as unknown as HTMLDivElement;
      }
    } catch {}
  }, [activeId, tiptap, bidiMode, tabs, recordSnapshot]);

  // Spellcheck Web Worker — off main thread tokenization
  useEffect(() => {
    try {
      spellWorkerRef.current = new Worker(new URL("../workers/spellcheck.worker.ts", import.meta.url), { type: "module" });
    } catch {}
    return () => { try { spellWorkerRef.current?.terminate(); } catch {} };
  }, []);

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
  const seedHandledRef = useRef<Set<string>>(new Set()); // tracks which tab ids have been seeded

  void historyVersion;
  const historyCanUndo = (() => { try { return tiptap?.can?.().undo?.() ?? historyIndexRef.current > 0; } catch { return historyIndexRef.current > 0; } })();
  const historyCanRedo = (() => { try { return tiptap?.can?.().redo?.() ?? historyIndexRef.current < historyRef.current.length - 1; } catch { return historyIndexRef.current < historyRef.current.length - 1; } })();

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
    if (!tiptap || tiptap.isDestroyed) return;
    if (tiptap.can().undo()) tiptap.chain().focus().undo().run();
  }, [tiptap]);

  const historyRedo = useCallback(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    if (tiptap.can().redo()) tiptap.chain().focus().redo().run();
  }, [tiptap]);

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

  // Stable formatting — execCommand is deprecated but still the most
  // interoperable for contentEditable; wrap with try/catch and ensure
  // selection is preserved via focus retention.
  const execFormat = useCallback((command: string, value?: string) => {
    // TipTap path — stable, transactional, BIDI-safe
    if (tiptap) {
      const chain: any = tiptap.chain().focus();
      switch (command) {
        case "bold": chain.toggleBold().run(); break;
        case "italic": chain.toggleItalic().run(); break;
        case "underline": chain.toggleUnderline().run(); break;
        case "hiliteColor": if (value) chain.toggleHighlight({ color: value }).run(); break;
        case "foreColor": if (value) chain.setColor(value).run(); break;
        case "removeFormat": chain.unsetAllMarks().clearNodes().run(); break;
        default: chain.run(); break;
      }
      return;
    }
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    try {
      const ok = document.execCommand(command, false, value);
      if (!ok && command === "hiliteColor" && value) {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          const range = sel.getRangeAt(0);
          const mark = document.createElement("mark");
          mark.style.background = value;
          mark.style.color = "#1a1a2e";
          mark.style.padding = "0.1em 0.2em";
          mark.style.borderRadius = "0.25em";
          try { range.surroundContents(mark); } catch { document.execCommand("hiliteColor", false, value); }
        }
      }
    } catch {}
    editor.focus();
    historyPushImmediate();
    contentRef.current[activeIdRef.current] = editor.innerHTML;
    setTabs((prev) =>
      prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: editor.innerHTML } : x))
    );
  }, [historyPushImmediate, tiptap]);

  // Reuse one detached div for html->text (avoids GC thrash on every keystroke)
  const htmlToPlainText = useCallback((html: string): string => {
    if (!html) return "";
    const d = htmlToTextDiv.current ?? (htmlToTextDiv.current = document.createElement("div"));
    d.innerHTML = html.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n</$1>");
    const text = d.textContent || d.innerText || "";
    return text.replace(/[\u00A0\u1680\u180E\u2000-\u200B\u202F\u205F\u3000]/g, " ");
  }, []);

  // Single entry point for any EXTERNAL content write (rephrase, clear,
  // undo-rephrase, etc.). Updates the DOM, the history stack, the ref buffer
  // and React state in one consistent step — no scattered innerHTML writes.
  const setEditorHtml = useCallback(
    (rawContent: string) => {
      const html = ensureHtmlParagraphs(rawContent);
      contentRef.current[activeIdRef.current] = html;
      setTabs((prev) =>
        prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: html } : x))
      );
      if (tiptap && !tiptap.isDestroyed) {
        try {
          tiptap.commands.setContent(html);
        } catch {}
      }
      historyInit(html);
    },
    [tiptap, historyInit]
  );

  const fallbackTab: ScratchTab = { id: activeId || "default", title: "Scratch", content: "" };
  const active = tabs.find((x) => x.id === activeId) || tabs[0] || fallbackTab;
  const b = busy[activeId] || {};
  const detection = detections[activeId];
  const hasSecret =
    !!detection &&
    (detection.families.includes("secret") || detection.families.includes("unknown"));

  // Fix sticky selection: ensure ProseMirror is selectable and scroll syncs overlays
  useEffect(() => {
    if (!tiptap || tiptap.isDestroyed || !tiptap.view?.dom) return;
    const dom = tiptap.view.dom as HTMLElement;
    dom.style.userSelect = "text";
    (dom.style as any).webkitUserSelect = "text";
    dom.style.cursor = "text";
    const onScroll = () => {
      // These are declared later in the component; call through refs to avoid
      // stale closures without creating a TDZ crash in the deps array.
      (onScroll as any)._up?.();
      (onScroll as any)._rec?.();
    };
    (onScroll as any)._up = updateScrollAffordancesRef.current;
    (onScroll as any)._rec = recomputeSpellRectsRef.current;
    dom.addEventListener("scroll", onScroll);
    return () => dom.removeEventListener("scroll", onScroll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiptap]);

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

  // Debounced bilingual spellcheck — throttled + Web Worker off-thread
  useEffect(() => {
    const text = htmlToPlainText(active?.content || "");
    let cancelled = false;
    const runCheck = async (words: string[]) => {
      if (!words.length) {
        if (!cancelled) setMisspelledWords((prev) => (prev.size ? new Set<string>() : prev));
        return;
      }
      if (words.length > 120) words.splice(120);
      try {
        const bad = await checkWords(words);
        if (!cancelled) setMisspelledWords(new Set(bad));
      } catch {}
    };
    if (spellWorkerRef.current) {
      const id = Date.now() + Math.random();
      const handler = (e: MessageEvent<{ id: number; words: string[] }>) => {
        if (e.data.id !== id) return;
        spellWorkerRef.current?.removeEventListener("message", handler as any);
        runCheck(e.data.words);
      };
      spellWorkerRef.current.addEventListener("message", handler as any);
      const timer = window.setTimeout(() => {
        spellWorkerRef.current?.postMessage({ id, text });
      }, 700);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
        spellWorkerRef.current?.removeEventListener("message", handler as any);
      };
    } else {
      const words = extractSpellWords(text);
      const timer = window.setTimeout(() => runCheck(words), 700);
      return () => {
        cancelled = true;
        window.clearTimeout(timer);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.content, checkWords, htmlToPlainText]);

  // Paint underlines from live glyph boxes — rAF-throttled
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
    // throttle to one frame
    if ((recomputeSpellRects as any)._raf) cancelAnimationFrame((recomputeSpellRects as any)._raf);
    (recomputeSpellRects as any)._raf = requestAnimationFrame(() => {
      const next = collectMisspellRects(editor, bad);
      setSpellRects(next);
    });
  }, []);
  recomputeSpellRectsRef.current = recomputeSpellRects;

  // Load tabs from the server (portable, survives reinstall/update). The
  // server copy is authoritative when it has content; localStorage is a cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Land any save queued by a previous mount FIRST, so the server copy
        // we load is never older than what the user actually typed.
        await drainScratchpadSaves();
        const res = await fetch("/api/scratchpad");
        if (!res.ok) return;
        const data = await res.json();
        const serverTabs: ScratchTab[] = Array.isArray(data.tabs)
          ? data.tabs
              .filter((x: any) => x && typeof x === "object" && !x.archived)
              .map((x: any) => ({
                id: x.id || uid(),
                title: x.title || "Scratch",
                content: x.content || "",
                archived: false,
              }))
          : [];
        if (cancelled) return;
        // Prime the save queue's mirror so it knows each tab's server rev.
        setSyncedScratchpadTabs(serverTabs);
        if (serverTabs.length) {
          // Server has the durable copy — it wins over the localStorage cache.
          setTabs(serverTabs);
          setActiveId(serverTabs[0].id);
        } else {
          // First run on this vault: migrate existing localStorage tabs up so
          // they become durable and survive future reinstalls.
          const local = initial.current.filter((x) => !x.archived);
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
        /* offline / locked — keep localStorage tabs */
      } finally {
        if (!cancelled) serverLoaded.current = true;
      }
    })();

    // Fetch archive count from cold storage
    fetch("/api/scratchpad/archive/count")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && typeof d.count === "number") setArchivedCount(d.count);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to the server (the ONLY durable store) on change. localStorage is
  // no longer written — notes must not live in browser storage (plaintext
  // secrets at rest). loadTabs() above stays as a one-way migration source.
  useEffect(() => {
    if (!serverLoaded.current) return;
    // The queue lives outside React: it survives unmount/tab-switch, so the
    // last keystrokes always reach the server (the old in-effect debounce was
    // cancelled by cleanup and dropped them).
    enqueueScratchpadSave(tabs);
  }, [tabs]);

  // Surface save conflicts from the queue (server 409) as a user choice.
  useEffect(() => {
    setScratchpadConflictHandler((serverTab) => setConflictTab(serverTab));
    return () => setScratchpadConflictHandler(null);
  }, []);

  const resolveConflict = useCallback((keepMine: boolean) => {
    if (!conflictTab) return;
    if (keepMine) {
      const mine = tabs.find((x) => x.id === conflictTab.id);
      if (mine) forceSaveScratchpadTab(mine);
    } else {
      // Adopt the server version.
      setTabs((prev) => prev.map((x) => (x.id === conflictTab.id ? { ...x, content: conflictTab.content, rev: conflictTab.rev } : x)));
      setSyncedScratchpadTabs(tabs.map((x) => (x.id === conflictTab.id ? { ...conflictTab, title: x.title } : x)));
      if (activeId === conflictTab.id) setContent(conflictTab.id, conflictTab.content);
    }
    setConflictTab(null);
  }, [conflictTab, tabs, activeId]);

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

    // 2. Fetch suggestions asynchronously in background via IPC bridge or HTTP
    const fetchSuggestions = async () => {
      let list: string[] = [];
      try {
        if (typeof window !== "undefined" && (window as any).electronAPI?.spellcheckSuggest) {
          const res = await (window as any).electronAPI.spellcheckSuggest(clean);
          list = Array.isArray(res) ? res : (res?.suggestions || []);
        } else {
          const res = await fetch("/api/spellcheck-suggest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ word: clean }),
          });
          if (res.ok) {
            const data = await res.json();
            list = Array.isArray(data.suggestions) ? data.suggestions : (Array.isArray(data) ? data : []);
          }
        }
      } catch (_) {}

      setContextMenu((prev) => {
        if (!prev || prev.word !== clean) return prev;
        return {
          ...prev,
          suggestions: list,
          loading: false,
        };
      });
    };

    fetchSuggestions();
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
    setMisspelledWords((prev) => {
      const next = new Set(prev);
      next.delete(clean);
      next.delete(clean.toLowerCase());
      return next;
    });
    setContextMenu(null);
    setStatus(`Added "${clean}" to dictionary`);
    requestAnimationFrame(recomputeSpellRects);

    if (typeof window !== "undefined" && (window as any).electronAPI?.addCustomWord) {
      try {
        await (window as any).electronAPI.addCustomWord(clean);
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
    setMisspelledWords((prev) => {
      const next = new Set(prev);
      next.delete(clean);
      next.delete(clean.toLowerCase());
      return next;
    });
    setContextMenu(null);
    setStatus(`Ignored "${clean}"`);
    requestAnimationFrame(recomputeSpellRects);

    if (typeof window !== "undefined" && (window as any).electronAPI?.addCustomWord) {
      try {
        await (window as any).electronAPI.addCustomWord(clean);
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

  const handleSmartSplitParagraphs = useCallback(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    const currentHtml = safeGetHTML(tiptap);
    recordSnapshot(activeId, currentHtml, "Before Format");
    const restored = smartFormatParagraphs(currentHtml);
    if (restored && restored !== "<p></p>") {
      contentRef.current[activeId] = restored;
      lastNonEmptyContentRef.current[activeId] = restored;
      setTabs((prev) =>
        prev.map((x) => (x.id === activeId ? { ...x, content: restored } : x))
      );
      try {
        tiptap.commands.setContent(restored, { emitUpdate: true });
        tiptap.chain().focus().run();
      } catch {}
      historyInit(restored);
      setStatusMsg("Restored multiline paragraph formatting!");
      setTimeout(() => setStatusMsg(""), 3000);
    }
  }, [tiptap, activeId, historyInit, recordSnapshot]);

  const handleRestoreRevision = useCallback(
    (rev: NoteRevision) => {
      if (!tiptap || tiptap.isDestroyed) return;
      const html = ensureHtmlParagraphs(rev.content);
      tiptap.chain().setContent(html, { emitUpdate: true }).run();
      contentRef.current[activeId] = html;
      lastNonEmptyContentRef.current[activeId] = html;
      setTabs((prev) => prev.map((x) => (x.id === activeId ? { ...x, content: html } : x)));
      setStatus(getTranslation(settings, "scratchpad_history_restored" as any) || "Version restored!");
      setShowRevisions(false);
      setClearedAlert(null);
    },
    [activeId, settings, setStatus, tiptap]
  );

  const handleRestoreCleared = useCallback(() => {
    if (!clearedAlert || !tiptap || tiptap.isDestroyed) return;
    const html = ensureHtmlParagraphs(clearedAlert.content);
    tiptap.chain().setContent(html, { emitUpdate: true }).run();
    contentRef.current[clearedAlert.tabId] = html;
    lastNonEmptyContentRef.current[clearedAlert.tabId] = html;
    setTabs((prev) => prev.map((x) => (x.id === clearedAlert.tabId ? { ...x, content: html } : x)));
    setClearedAlert(null);
    setStatus("Note content restored!");
  }, [clearedAlert, setStatus, tiptap]);
  const onEditorInput = useCallback(() => {
    if (ghostCompletion) {
      setGhostCompletion("");
      setCaretPos(null);
    }
    const editor = editorRef.current;
    if (!editor) return;
    const html = editor.innerHTML;
    const id = activeIdRef.current;
    contentRef.current[id] = html;
    scheduleHistoryPush();
    if (pasteFlag.current[id]) {
      pasteFlag.current[id] = false;
      analyze(id, html);
    }
    const plainText = htmlToPlainText(html);
    if (plainText.trim() && !titleTouched.current[id]) {
      const firstLine = plainText.split("\n").map((l) => l.trim()).find(Boolean) || "";
      const auto = firstLine.slice(0, 40) || (active?.title || "Scratch");
      setTabs((prev) => {
        const cur = prev.find((x) => x.id === id);
        if (cur && cur.title === auto) return prev;
        return prev.map((x) => (x.id === id ? { ...x, title: auto } : x));
      });
    }
    triggerAutocomplete(plainText);
    // Debounce React state sync — keeps typing at 60fps, contentRef is source of truth
    if (debouncedTabsSync.current) window.clearTimeout(debouncedTabsSync.current);
    debouncedTabsSync.current = window.setTimeout(() => {
      setTabs((prev) => {
        const cur = prev.find((x) => x.id === id);
        if (cur && cur.content === html) return prev;
        return prev.map((x) => (x.id === id ? { ...x, content: html } : x));
      });
    }, 320);
  }, [active?.title, analyze, ghostCompletion, scheduleHistoryPush, triggerAutocomplete, htmlToPlainText]);

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

  // Toggle archive section with lazy on-demand fetch
  const toggleShowArchived = useCallback(() => {
    setShowArchived((prev) => {
      const next = !prev;
      if (next && archivedTabs === null) {
        setLoadingArchived(true);
        fetch("/api/scratchpad/archive")
          .then((r) => r.json())
          .then((d) => {
            if (Array.isArray(d.tabs)) {
              setArchivedTabs(d.tabs);
              setArchivedCount(d.tabs.length);
            }
          })
          .catch(() => {})
          .finally(() => setLoadingArchived(false));
      }
      return next;
    });
  }, [archivedTabs]);

  // Archive soft-hides a tab into cold storage
  const archiveTab = async (id: string) => {
    const target = tabs.find((x) => x.id === id);
    if (!window.confirm(`Are you sure you want to archive note "${target?.title || "Scratch"}"?`)) return;

    // Optimistic UI update
    const remaining = tabs.filter((x) => x.id !== id);
    if (remaining.length === 0) {
      const fresh = { id: uid(), title: "Scratch 1", content: "", archived: false };
      setTabs([fresh]);
      setActiveId(fresh.id);
    } else {
      setTabs(remaining);
      if (id === activeId) setActiveId(remaining[0].id);
    }
    setArchivedCount((c) => c + 1);
    if (archivedTabs !== null && target) {
      setArchivedTabs((prev) => [{ ...target, archived: true, archivedAt: Date.now() }, ...(prev || [])]);
    }

    try {
      await fetch("/api/scratchpad/archive-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: id, tab: target }),
      });
    } catch {}
  };

  const restoreTab = async (id: string) => {
    let target = archivedTabs?.find((x) => x.id === id);
    if (archivedTabs !== null) {
      setArchivedTabs((prev) => (prev ? prev.filter((x) => x.id !== id) : null));
    }
    setArchivedCount((c) => Math.max(0, c - 1));

    try {
      const res = await fetch("/api/scratchpad/restore-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.restoredTab) {
          target = data.restoredTab;
        }
      }
    } catch {}

    if (target) {
      const restored = { ...target, archived: false };
      setTabs((prev) => [...prev, restored]);
      setActiveId(target.id);
    }
    if (previewArchivedTab?.id === id) {
      setPreviewArchivedTab(null);
    }
  };

  const deleteArchivedTab = async (id: string, title?: string) => {
    if (!window.confirm(`Are you sure you want to permanently delete "${title || "Untitled"}"?`)) return;
    if (archivedTabs !== null) {
      setArchivedTabs((prev) => (prev ? prev.filter((x) => x.id !== id) : null));
    }
    setArchivedCount((c) => Math.max(0, c - 1));
    if (previewArchivedTab?.id === id) {
      setPreviewArchivedTab(null);
    }

    try {
      await fetch("/api/scratchpad/delete-archived", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: id }),
      });
    } catch {}
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
    // Explicit delete endpoint — whole-array saves can no longer remove tabs.
    fetch(`/api/scratchpad/tabs/${encodeURIComponent(id)}`, { method: "DELETE" })
      .then(() => setSyncedScratchpadTabs(tabs.filter((x) => x.id !== id)))
      .catch(() => {});
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
      fetch(`/api/scratchpad/tabs/${encodeURIComponent(id)}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      }).catch(() => {});
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
    const secretItems: Array<Partial<AnalyzeCandidate> & { notes?: string }> =
      detection?.candidates?.filter((c) => c.family === "secret" || c.family === "unknown") || [];
    const items: Array<Partial<AnalyzeCandidate> & { notes?: string; source_file?: string }> =
      secretItems.length > 0
        ? secretItems.map((c) => ({ ...c, value: c.value || "" }))
        : [
            {
              value: plainText,
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
    recordSnapshot(activeId, original, "Before AI Rewrite");
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
        const newHtml = textToNoteHtml(data.rewritten);
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
    recordSnapshot(activeId, original, "Before Proofread");
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
        const newHtml = textToNoteHtml(data.corrected);
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
  updateScrollAffordancesRef.current = updateScrollAffordances;

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
  const activePlainText = useMemo(() => htmlToPlainText(active?.content || ""), [active?.content]);
  const activeCharCount = activePlainText.length;
  const activeWordCount = useMemo(() => activePlainText.trim().split(/\s+/).filter(Boolean).length, [activePlainText]);
  const activeReadingTime = Math.max(1, Math.ceil(activeWordCount / 200));

    return (
    <div ref={scratchRootRef} className="space-y-4">
      {conflictTab && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "var(--amber-bg, rgba(251,191,36,0.08))", border: "1px solid rgba(251,191,36,0.35)", color: "var(--text)" }}>
          <span>{t("scratchpad_conflict_msg" as any) || "This note was changed in another window. Whose version should win?"}</span>
          <span className="flex items-center gap-2 shrink-0">
            <button onClick={() => resolveConflict(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}>
              {t("scratchpad_conflict_load" as any) || "Load saved version"}
            </button>
            <button onClick={() => resolveConflict(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--bg-input)", color: "var(--text)", border: "1px solid var(--border-input)" }}>
              {t("scratchpad_conflict_keep" as any) || "Keep mine"}
            </button>
          </span>
        </div>
      )}
      {/* Internal tabs — unified pill strip */}
      <div className="scratchpad-tab-strip flex items-center gap-1.5 flex-wrap">
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
className="scratchpad-tab group cursor-pointer"
               data-active={isActive}
               style={{
                 opacity: dragId === tab.id ? 0.5 : 1,
                 transform: overId === tab.id ? "translateY(-1px)" : undefined,
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
                  recordSnapshot(activeId, active?.content || "", "Before Clear");
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
              onClick={handleSmartSplitParagraphs}
              disabled={!(active?.content || "").trim()}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
              style={{ background: "rgba(56, 189, 248, 0.1)", color: "#38bdf8", border: "1px solid rgba(56, 189, 248, 0.3)" }}
              title="Restore multi-line paragraphs & auto-format structure"
            >
              <AlignJustify className="w-3.5 h-3.5" />
              <span>Format Paragraphs</span>
            </button>

            <button
              type="button"
              onClick={handleOpenRevisions}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
              style={{ background: "rgba(245, 158, 11, 0.12)", color: "#fbbf24", border: "1px solid rgba(245, 158, 11, 0.3)" }}
              title={t("scratchpad_history_title")}
            >
              <History className="w-3.5 h-3.5" />
              <span>{t("scratchpad_history")}</span>
            </button>

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
              className="rounded-lg px-2.5 py-1.5 text-xs font-medium focus:outline-none cursor-pointer"
              style={{
                background: "var(--bg-input, #18181b)",
                border: "1px solid var(--border, #3f3f46)",
                color: "var(--text, #ffffff)",
              }}
            >
              {REWRITE_STYLES.map((s) => (
                <option
                  key={s}
                  value={s}
                  style={{
                    backgroundColor: "#18181b",
                    color: "#ffffff",
                  }}
                >
                  {t(REWRITE_STYLE_KEYS[s] as Parameters<typeof getTranslation>[1]) || s}
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
            } as React.CSSProperties
          }
        >
          {/* Frame is height-locked to the viewport. Jump FABs pin to its
              top/bottom corners so they stay reachable on very long notes. */}
          <div className="note-editor-frame">
            {tiptap ? (
              <div
                onContextMenu={onContextMenu}
                onKeyDown={onKeyDown}
                onPaste={(e) => {
                  pasteFlag.current[activeId] = true;
                  setTimeout(() => { try { analyze(activeId, safeGetHTML(tiptap)); } catch {} }, 80);
                }}
                className="relative w-full"
              >
                <EditorContent editor={tiptap} className="note-editor-wrap" />
                {tiptap && !tiptap.state.selection.empty && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-0.5 p-1 rounded-full" style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border-glow)", boxShadow: "0 8px 24px rgba(0,0,0,0.22)" }}>
                    <button type="button" onClick={() => tiptap.chain().focus().toggleBold().run()} className="p-1.5 rounded-full" style={{ background: tiptap.isActive("bold") ? "var(--accent)" : "transparent", color: tiptap.isActive("bold") ? "#fff" : "var(--text-muted)" }} title="Bold"><Bold className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => tiptap.chain().focus().toggleItalic().run()} className="p-1.5 rounded-full" style={{ background: tiptap.isActive("italic") ? "var(--accent)" : "transparent", color: tiptap.isActive("italic") ? "#fff" : "var(--text-muted)" }} title="Italic"><Italic className="w-3.5 h-3.5" /></button>
                    <button type="button" onClick={() => tiptap.chain().focus().toggleUnderline().run()} className="p-1.5 rounded-full" style={{ background: tiptap.isActive("underline") ? "var(--accent)" : "transparent", color: tiptap.isActive("underline") ? "#fff" : "var(--text-muted)" }} title="Underline"><Underline className="w-3.5 h-3.5" /></button>
                    <span className="w-px h-4 mx-1" style={{ background: "var(--border)" }} />
                    <button type="button" onClick={() => tiptap.chain().focus().toggleHighlight({ color: highlightColor }).run()} className="p-1.5 rounded-full" style={{ color: "var(--text-dim)" }} title="Highlight"><Highlighter className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                {slashOpen && (
                  <div className="absolute left-3 bottom-14 z-20 flex flex-col gap-1 p-1.5 rounded-xl shadow-2xl" style={{ background: "var(--bg-surface-solid)", border: "1px solid var(--border-glow)", minWidth: 180 }}>
                    <div className="px-2 py-1 text-[10px] font-semibold" style={{ color: "var(--text-muted)" }}>Slash commands — type "/"</div>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleHeading({ level: 1 }).run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs flex items-center gap-2" style={{ color: "var(--text)" }}><span className="font-bold">H1</span> Heading 1</button>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleHeading({ level: 2 }).run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs flex items-center gap-2" style={{ color: "var(--text)" }}><span className="font-bold">H2</span> Heading 2</button>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleBulletList().run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs" style={{ color: "var(--text)" }}>• Bullet list</button>
                    <button type="button" onClick={() => { const from = tiptap.state.selection.from; tiptap.chain().focus().deleteRange({ from: from - 1, to: from }).toggleBlockquote().run(); setSlashOpen(false); }} className="text-left px-2 py-1.5 rounded-lg hover:bg-accent-bg text-xs" style={{ color: "var(--text)" }}>❝ Quote</button>
                  </div>
                )}
              </div>
            ) : (
              <div className="note-editor relative z-10 w-full p-4 text-sm" style={{ color: "var(--text-muted)" }}>
                Loading editor…
              </div>
            )}
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

          {/* Pro Status Bar */}
          <div className="editor-status-bar select-none">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <strong className="text-white tabular-nums">{activeWordCount}</strong>
                <span className="opacity-75">{settings?.ui_language === "ar" ? "كلمة" : "words"}</span>
              </span>
              <span className="opacity-30">•</span>
              <span className="flex items-center gap-1">
                <strong className="text-white tabular-nums">{activeCharCount}</strong>
                <span className="opacity-75">{settings?.ui_language === "ar" ? "حرف" : "chars"}</span>
              </span>
              <span className="opacity-30">•</span>
              <span className="flex items-center gap-1">
                <span>~</span>
                <strong className="text-white tabular-nums">{activeReadingTime}</strong>
                <span className="opacity-75">{settings?.ui_language === "ar" ? "دقيقة قراءة" : "min read"}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="opacity-30">•</span>
              <span className="uppercase text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded" style={{ background: "var(--accent-bg)", color: "var(--accent-bright)" }}>
                {bidiMode === "auto" ? `AUTO (${detectedDir.toUpperCase()})` : bidiMode.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Formatting toolbar — unified pill */}
        <div
          ref={toolbarRef}
          onMouseDown={(e) => e.preventDefault()}
          className="scratchpad-toolbar"
        >
          {/* Dual-language BIDI */}
          <div
            className="scratchpad-toolbar-group"
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

      {/* Archived tabs — Cold Reference Archive */}
      {(archivedCount > 0 || (archivedTabs && archivedTabs.length > 0)) && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <button
            type="button"
            onClick={toggleShowArchived}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold"
            style={{ color: "var(--text-dim)" }}
          >
            <span className="flex items-center gap-2">
              <Archive className="w-3.5 h-3.5 text-amber-400/80" />
              <span>{t("scratchpad_archived")} ({archivedCount})</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 font-mono text-zinc-400">Cold Storage</span>
            </span>
            <span className="text-zinc-500">{showArchived ? "▾" : "▸"}</span>
          </button>
          {showArchived && (
            <div className="px-4 pb-3 flex flex-col gap-1.5">
              {loadingArchived && (
                <div className="py-4 flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading archive...</span>
                </div>
              )}
              {!loadingArchived && archivedTabs && archivedTabs.length === 0 && (
                <div className="py-2 text-center text-xs text-zinc-500">No archived notes</div>
              )}
              {!loadingArchived && archivedTabs && archivedTabs.map((tab) => (
                <div
                  key={tab.id}
                  className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg group transition-colors"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
                >
                  <span
                    className="flex-1 truncate text-xs cursor-pointer hover:underline"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => setPreviewArchivedTab(tab)}
                    title="Click to preview (read-only)"
                  >
                    {tab.title || "Untitled"}
                  </span>
                  {tab.archivedAt && (
                    <span className="text-[10px] text-zinc-500 hidden sm:inline">
                      {new Date(tab.archivedAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPreviewArchivedTab(tab)}
                    className="opacity-70 hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-zinc-300"
                    title="View note"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreTab(tab.id)}
                    className="opacity-70 hover:opacity-100 transition-opacity text-emerald-400 hover:text-emerald-300 p-1"
                    aria-label={t("scratchpad_restore")}
                    title={t("scratchpad_restore")}
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteArchivedTab(tab.id, tab.title)}
                    className="opacity-70 hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-1"
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

      {/* Archived Note Preview Modal (Passive Reference Viewer) */}
      {previewArchivedTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setPreviewArchivedTab(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
            style={{
              background: "#121214",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center gap-2.5">
                <Archive className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-zinc-100 truncate max-w-md">
                  {previewArchivedTab.title || "Archived Note"}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                  Reference Only
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewArchivedTab(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Note Meta */}
            <div
              className="px-5 py-2 border-b flex items-center justify-between text-[11px] text-zinc-400"
              style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-3">
                {previewArchivedTab.archivedAt && (
                  <span>Archived on {new Date(previewArchivedTab.archivedAt).toLocaleString()}</span>
                )}
                <span>•</span>
                <span>{htmlToPlainText(previewArchivedTab.content || "").length} characters</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(htmlToPlainText(previewArchivedTab.content || ""));
                    setStatus("Copied to clipboard");
                  }}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors flex items-center gap-1.5"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            {/* Read-Only Content Body */}
            <div
              className="flex-1 overflow-y-auto p-5 text-sm leading-[1.6] select-text"
              style={{ color: "#d4d4d8" }}
              dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(previewArchivedTab.content) || "<p class='text-zinc-500'>Empty note</p>" }}
            />

            {/* Footer Actions */}
            <div
              className="flex items-center justify-between px-5 py-3 border-t"
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)" }}
            >
              <button
                type="button"
                onClick={() => deleteArchivedTab(previewArchivedTab.id, previewArchivedTab.title)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Permanently</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewArchivedTab(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => restoreTab(previewArchivedTab.id)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  <span>Restore to Active Notes</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Revision History Modal */}
      {showRevisions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowRevisions(false)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
            style={{
              background: "#121214",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-5 py-4 flex items-center justify-between border-b"
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "#18181b" }}
            >
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">
                    {t("scratchpad_history_title")}
                  </h3>
                  <p className="text-xs text-neutral-400">
                    {active?.title || "Note"} &bull; {revisionsList.length} {revisionsList.length === 1 ? "version" : "versions"} saved
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRevisions(false)}
                className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 flex overflow-hidden min-h-[340px]">
              {/* Revision list sidebar */}
              <div
                className="w-64 border-r overflow-y-auto flex flex-col p-2 gap-1.5"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "#141416" }}
              >
                {revisionsList.length === 0 ? (
                  <div className="p-4 text-center text-xs text-neutral-500">
                    {t("scratchpad_history_empty")}
                  </div>
                ) : (
                  revisionsList.map((rev, idx) => {
                    const isSelected = selectedRevision?.id === rev.id;
                    const dateStr = new Date(rev.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                    const dateFull = new Date(rev.timestamp).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    });
                    return (
                      <button
                        key={rev.id}
                        type="button"
                        onClick={() => setSelectedRevision(rev)}
                        className={`text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1 cursor-pointer ${
                          isSelected
                            ? "bg-amber-500/15 border border-amber-500/40 text-white shadow-sm"
                            : "hover:bg-white/5 border border-transparent text-neutral-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-300">
                            {idx === 0 ? "Latest Snapshot" : `Version ${revisionsList.length - idx}`}
                          </span>
                          <span className="text-[10px] text-neutral-400">{dateStr}</span>
                        </div>
                        <div className="text-[10px] text-neutral-400 flex items-center justify-between">
                          <span>{dateFull}</span>
                          <span>{rev.charCount} chars</span>
                        </div>
                        {rev.reason && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 self-start font-mono">
                            {rev.reason}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Revision content preview */}
              <div className="flex-1 flex flex-col overflow-hidden bg-[#0e0e10]">
                {selectedRevision ? (
                  <>
                    <div
                      className="px-4 py-2 text-xs border-b flex items-center justify-between"
                      style={{ borderColor: "rgba(255,255,255,0.08)" }}
                    >
                      <span className="text-neutral-400">
                        Preview: <strong className="text-white">{selectedRevision.charCount} characters</strong>
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        {new Date(selectedRevision.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto font-sans text-xs text-neutral-200 leading-[1.6] select-text">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: sanitizeNoteHtml(selectedRevision.content) || "<em>Empty</em>",
                        }}
                        className="prose prose-invert max-w-none text-xs"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-neutral-500">
                    Select a version to preview
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              className="px-5 py-3 border-t flex items-center justify-between"
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "#18181b" }}
            >
              <span className="text-xs text-neutral-400">
                Auto-saved snapshots protect your work from accidental undos or wipes.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowRevisions(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  Close
                </button>
                {selectedRevision && (
                  <button
                    type="button"
                    onClick={() => handleRestoreRevision(selectedRevision)}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                    style={{
                      background: "#f59e0b",
                      color: "#000000",
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t("scratchpad_history_restore")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Accidental Clear / Undo Alert Toast */}
      {clearedAlert && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl animate-bounce"
          style={{
            background: "#27272a",
            border: "1px solid #ef4444",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          <div className="p-2 rounded-lg bg-red-500/15 text-red-400">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="text-xs">
            <div className="font-bold text-white">{t("scratchpad_content_cleared")}</div>
            <div className="text-[11px] text-neutral-400">Accidental Ctrl+Z or clear detected.</div>
          </div>
          <button
            type="button"
            onClick={handleRestoreCleared}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 text-white transition-colors cursor-pointer"
          >
            {t("scratchpad_restore_undo")}
          </button>
          <button
            type="button"
            onClick={() => setClearedAlert(null)}
            className="p-1 text-neutral-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

export default ScratchpadTab;
