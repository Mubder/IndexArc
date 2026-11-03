import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { copyTextToClipboard } from "../lib/clipboard";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import { DOMParser } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
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
  ArrowLeftRight,
  LifeBuoy,
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
import { enqueueScratchpadSave, drainScratchpadSaves, setScratchpadConflictHandler, setScratchpadFailureHandler, setSyncedScratchpadTabs, forceSaveScratchpadTab, mergeSyncedScratchpadTab } from "../scratchpadSaveQueue";
import { takeHandoffNote, REOPEN_NOTE_EVENT } from "../noteHandoff";
import { ensureHtmlParagraphs, htmlToPlainText } from "../lib/noteHtml";
import { buildCompareRows, compareStats, noteToLines } from "../lib/noteDiff";
import { registerFlushHook, enqueueTabsSnapshot } from "../lib/flushOnExit";
import { normalizeServerTab } from "../lib/serverTabs";
import { isArabicText, findDuplicateHits } from "../utils";

import { type NoteRevision, getNoteRevisions, saveNoteRevision } from "./scratchpad/revisions";
import { REWRITE_STYLES, REWRITE_STYLE_KEYS, HIGHLIGHT_COLORS, TEXT_COLORS } from "./scratchpad/constants";
import { smartFormatParagraphs, uid, dropLegacyLocalTabs, loadTabs } from "./scratchpad/noteTabs";
import {
  getSelectionOffsets,
  setSelectionOffsets,
  extractSpellWords,
  getWordAtPoint,
  measureCaretPos,
  detectBaseDir,
  scrollContainerToReveal,
  type SpellRect,
  collectMisspellRects,
  safeGetHTML,
  sanitizeToken,
} from "./scratchpad/domText";
import { NoteTabStrip } from "./scratchpad/NoteTabStrip";
import { EditorPanel } from "./scratchpad/EditorPanel";
import { FormattingToolbar } from "./scratchpad/FormattingToolbar";
import { ArchiveSection } from "./scratchpad/ArchiveSection";
import { ArchivedNotePreview } from "./scratchpad/ArchivedNotePreview";
import { RevisionHistoryModal } from "./scratchpad/RevisionHistoryModal";
import { ProtectModal } from "./scratchpad/ProtectModal";
import { RescueModal } from "./scratchpad/RescueModal";
import { CompareModal } from "./scratchpad/CompareModal";

// Re-exported: these used to live here.
export { type NoteRevision, getNoteRevisions, saveNoteRevision, smartFormatParagraphs };

export const ScratchpadTab: React.FC<{ settings: Settings | null }> = ({ settings }) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const initial = useRef(loadTabs());
  const [tabs, setTabs] = useState<ScratchTab[]>(initial.current);
  // Live mirrors for the exit-flush hook (registered once, must never go
  // stale): the tab list and the TipTap instance.
  const tabsRef = useRef<ScratchTab[]>(tabs);
  tabsRef.current = tabs;
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
  // Read inside ProseMirror's handlePaste (bound once at editor creation).
  const pastePlainRef = useRef(true);
  pastePlainRef.current = pastePlain;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [rephraseUndo, setRephraseUndo] = useState<Record<string, string[]>>({});
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisionsList, setRevisionsList] = useState<NoteRevision[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<NoteRevision | null>(null);
  // Compare-two-notes view: which tabs sit on the left/right of the diff.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  // Rescue view: orphaned revision snapshots (notes whose saves never landed).
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueList, setRescueList] = useState<any[]>([]);
  const [rescueLoading, setRescueLoading] = useState(false);
  const [rescueQuery, setRescueQuery] = useState("");
  // True while the save queue cannot reach the server — drives the
  // "changes exist only in this window" banner.
  const [saveFailing, setSaveFailing] = useState(false);
  const [clearedAlert, setClearedAlert] = useState<{ tabId: string; content: string; timestamp: number } | null>(null);
  // 409 conflict banner state: the server's current version of the tab whose
  // save conflicted, offered to the user when an autosave raced another window.
  const [conflictTab, setConflictTab] = useState<any>(null);
  // Live set of protected tab ids (read inside callbacks without re-binding deps)
  const protectedIdsRef = useRef<Set<string>>(new Set());
  protectedIdsRef.current = new Set(tabs.filter((t) => (t as any).protected).map((t) => t.id));
  // Protect/Pin UI state
  const [protectModal, setProtectModal] = useState<{ mode: "on" | "off"; tabId: string } | null>(null);
  const [protectConfirmInput, setProtectConfirmInput] = useState("");
  const [protectError, setProtectError] = useState("");
  const [protectShowInput, setProtectShowInput] = useState(true);
  const protectInputRef = useRef<HTMLInputElement | null>(null);

  // Force focus into the confirm field when the unprotect modal opens.
  // `autoFocus` alone can lose to the button that opened the modal (Chromium
  // re-focuses the clicked button after the click completes), which made the
  // field look inert.
  useEffect(() => {
    if (!protectModal || protectModal.mode !== "off") return;
    const focus = () => {
      const el = protectInputRef.current;
      if (el) {
        el.focus();
        el.select();
      }
    };
    focus();
    const t1 = setTimeout(focus, 0);
    const t2 = setTimeout(focus, 120);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [protectModal]);

  const togglePin = useCallback(async () => {
    if (!activeId) return;
    const wantPinned = !(tabs.find((x) => x.id === activeId) as any)?.pinned;
    try {
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(activeId)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: wantPinned }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.tab) {
          setTabs((prev) => prev.map((x) => (x.id === activeId ? { ...x, ...(data.tab as any) } : x)));
          setSyncedScratchpadTabs(tabs.map((x) => (x.id === activeId ? { ...(data.tab as any), title: x.title } : x)));
        }
      }
    } catch {}
  }, [activeId, tabs]);

  const submitProtect = useCallback(async () => {
    if (!protectModal) return;
    const wantProtected = protectModal.mode === "on";
    const body: any = wantProtected
      ? { protected: true }
      : { protected: false, confirm_word: protectConfirmInput.trim(), password: protectConfirmInput.trim() };
    try {
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(protectModal.tabId)}/protect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTabs((prev) => prev.map((x) => (x.id === protectModal.tabId ? { ...x, ...(data.tab as any) } : x)));
        setProtectModal(null);
        setProtectConfirmInput("");
        setProtectError("");
      } else {
        setProtectError(data.error || "Confirmation failed");
      }
    } catch (e: any) {
      setProtectError(e?.message || "Request failed");
    }
  }, [protectModal, protectConfirmInput]);

  const shellRef = useRef<HTMLDivElement>(null);
  const scratchRootRef = useRef<HTMLDivElement>(null);
  const titleTouched = useRef<Record<string, boolean>>({});
  const serverLoaded = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<Record<string, string>>({});
  // Last html the EDITOR itself held for each tab (written by onUpdate and by
  // every explicit setContent). The tabs-sync effect compares against this to
  // decide whether incoming state content is an EXTERNAL write that must be
  // applied, or the editor's own output echoed back — re-applying the editor's
  // own html replaces the whole doc and yanks the caret to the end.
  const editorHtmlRef = useRef<Record<string, string>>({});
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
  const autocompleteTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const openCompare = useCallback(() => {
    // Left defaults to the active note, right to the first other tab.
    const other = tabs.find((x) => x.id !== activeId);
    if (!other) return;
    setCompareA(activeId);
    setCompareB(other.id);
    setCompareOpen(true);
  }, [tabs, activeId]);

  // Diff of the two selected notes. Reads through contentRef so unsaved
  // keystrokes on the left note are included. Pure-local LCS — nothing leaves
  // the machine. eslint-disable for the ref reads is deliberate.
  const compareData = useMemo(() => {
    if (!compareOpen) return null;
    const tabA = tabs.find((x) => x.id === compareA);
    const tabB = tabs.find((x) => x.id === compareB);
    if (!tabA || !tabB || tabA.id === tabB.id) return null;
    const linesA = noteToLines(contentRef.current[tabA.id] ?? tabA.content ?? "");
    const linesB = noteToLines(contentRef.current[tabB.id] ?? tabB.content ?? "");
    const rows = buildCompareRows(linesA, linesB);
    return {
      rows,
      stats: compareStats(rows),
      dirA: detectBaseDir(linesA.join("\n")) as "ltr" | "rtl",
      dirB: detectBaseDir(linesB.join("\n")) as "ltr" | "rtl",
      titleA: tabA.title,
      titleB: tabB.title,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareOpen, compareA, compareB, tabs]);

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
      // Plain-text paste MUST be intercepted here, at the ProseMirror level.
      // The React onPaste on the wrapper div runs at bubble phase — AFTER
      // ProseMirror's own target-phase paste handler has already inserted the
      // clipboard slice. preventDefault() there could no longer stop it, so
      // the manual insertContent() ran on top and every paste appeared TWICE.
      // Returning true here tells ProseMirror the event is fully handled.
      handlePaste: (view, event) => {
        if (!pastePlainRef.current) return false;
        event.preventDefault();
        try {
          // Clipboards very often carry a trailing newline (copied links,
          // rows, chat lines). Keeping it appended an empty <p> after every
          // paste and left the caret parked on that blank line.
          const text = (event.clipboardData?.getData("text/plain") ?? "").replace(/[\r\n]+$/, "");
          if (!text) return true;
          const esc = (s: string) =>
            s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
          const div = document.createElement("div");
          div.innerHTML = text
            .replace(/\r\n/g, "\n")
            .split("\n")
            .map((l) => `<p>${l ? esc(l) : ""}</p>`)
            .join("");
          const slice = DOMParser.fromSchema(view.state.schema).parseSlice(div);
          view.dispatch(view.state.tr.replaceSelection(slice));
        } catch {}
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      const html = safeGetHTML(editor);
      const id = activeIdRef.current;
      contentRef.current[id] = html;
      editorHtmlRef.current[id] = html;

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
      // Auto-title from the first non-empty line. Read it straight off the
      // ProseMirror doc (the old detached-div innerHTML parse re-parsed the
      // WHOLE note on every keystroke) and — critically — return `prev`
      // unchanged when the title already matches: an unconditional new
      // object here turned setEditable's re-emitted "update" into an
      // infinite setTabs → effect → setEditable → update render loop.
      if (!titleTouched.current[id]) {
        let firstBlock = "";
        editor.state.doc.forEach((node) => {
          if (firstBlock) return;
          const t = node.textContent;
          if (t.trim()) firstBlock = t;
        });
        if (firstBlock) {
          const auto = firstBlock.trim().slice(0, 40) || "Scratch";
          setTabs((prev) => {
            const cur = prev.find((x) => x.id === id);
            if (cur && cur.title === auto) return prev;
            return prev.map((x) => (x.id === id ? { ...x, title: auto } : x));
          });
        }
      }
      // Slash palette trigger — show when line ends with "/"
      try {
        const { from } = editor.state.selection;
        const textBefore = editor.state.doc.textBetween(Math.max(0, from - 2), from, "\n");
        setSlashOpen(textBefore.endsWith("/"));
      } catch { setSlashOpen(false); }
    },
  });

  // Live mirror of the TipTap instance for the once-registered exit hook.
  const tiptapRef = useRef(tiptap);
  tiptapRef.current = tiptap;

  // Exit-flush: on quit (tray Exit, shutdown, uninstall-before-update) push
  // the LIVE editor content into the save queue synchronously — debounce
  // timers die with the renderer and must never outrank this snapshot. The
  // flush module then drains the queue to the server before the app exits.
  useEffect(() => {
    return registerFlushHook(() => {
      const ed = tiptapRef.current;
      const active = activeIdRef.current;
      if (ed && !ed.isDestroyed) {
        try {
          if ((ed as any)._debouncedSync) {
            window.clearTimeout((ed as any)._debouncedSync);
            (ed as any)._debouncedSync = null;
          }
          const html = safeGetHTML(ed);
          if (html) contentRef.current[active] = html;
        } catch {}
      }
      const live = ed && !ed.isDestroyed ? contentRef.current[active] : null;
      enqueueTabsSnapshot(
        tabsRef.current.map((x) => ({
          ...x,
          content: x.id === active && live != null ? live : (contentRef.current[x.id] ?? x.content),
        }))
      );
    });
  }, []);

  // Keep editorRef in sync with TipTap DOM for spellcheck/scroll
  useEffect(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    const rawContent = contentRef.current[activeId] ?? tabs.find((x) => x.id === activeId)?.content ?? "";
    const html = ensureHtmlParagraphs(rawContent);
    const isTabSwitch = lastActiveTabId.current !== activeId;

    if (isTabSwitch) {
      lastActiveTabId.current = activeId;
      // Tab switched: Set content so Ctrl+Z is strictly scoped to this note
      // Note: clearHistory() was removed — TipTap v3 UndoRedo extension no longer exposes it,
      // and the custom history stack (historyRef) already handles per-tab undo scoping.
      tiptap.commands.setContent(html || "<p></p>", { emitUpdate: false });
      contentRef.current[activeId] = html;
      editorHtmlRef.current[activeId] = html;
      if (html && html !== "<p></p>") {
        lastNonEmptyContentRef.current[activeId] = html;
        recordSnapshot(activeId, html, "Opened snapshot");
      }
    } else if (html !== "<p></p>" && rawContent !== editorHtmlRef.current[activeId]) {
      // EXTERNAL write only (conflict resolution, handoff, first server sync):
      // state holds content the editor never produced. The editor's own html
      // echoed back through tabs must NEVER be re-applied — setContent
      // replaces the whole document and throws the caret to the end of the
      // note (the "cursor always jumps to the last line" bug). emitUpdate
      // stays false so this can't re-fire onUpdate and feed back into tabs.
      tiptap.commands.setContent(html || "<p></p>", { emitUpdate: false });
      contentRef.current[activeId] = html;
      editorHtmlRef.current[activeId] = html;
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

  const historyUndo = useCallback(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    if (tiptap.can().undo()) tiptap.chain().focus().undo().run();
  }, [tiptap]);

  const historyRedo = useCallback(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    if (tiptap.can().redo()) tiptap.chain().focus().redo().run();
  }, [tiptap]);


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
    contentRef.current[activeIdRef.current] = editor.innerHTML;
    setTabs((prev) =>
      prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: editor.innerHTML } : x))
    );
  }, [tiptap]);

  // Single entry point for any EXTERNAL content write (rephrase, clear,
  // undo-rephrase, etc.). Updates the DOM, the history stack, the ref buffer
  // and React state in one consistent step — no scattered innerHTML writes.
  const setEditorHtml = useCallback(
    (rawContent: string) => {
      const html = ensureHtmlParagraphs(rawContent);
      contentRef.current[activeIdRef.current] = html;
      editorHtmlRef.current[activeIdRef.current] = html;
      setTabs((prev) =>
        prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: html } : x))
      );
      if (tiptap && !tiptap.isDestroyed) {
        try {
          tiptap.commands.setContent(html);
        } catch {}
      }
    },
    [tiptap]
  );

  const fallbackTab: ScratchTab = { id: activeId || "default", title: "Scratch", content: "" };
  const active = tabs.find((x) => x.id === activeId) || tabs[0] || fallbackTab;
  const activeIsProtected = protectedIdsRef.current.has(activeId);
  const activeIsPinned = !!(active as any)?.pinned;
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
      // The spell-rect walk segments every text node and measures a Range per
      // misspelling — expensive on large link-heavy notes (URL tokens read as
      // misspelled words). Trailing-throttle instead of per-scroll-frame.
      if ((onScroll as any)._t) return;
      (onScroll as any)._t = window.setTimeout(() => {
        (onScroll as any)._t = null;
        (onScroll as any)._rec?.();
      }, 120);
    };
    (onScroll as any)._up = updateScrollAffordancesRef.current;
    (onScroll as any)._rec = recomputeSpellRectsRef.current;
    dom.addEventListener("scroll", onScroll);
    return () => {
      if ((onScroll as any)._t) window.clearTimeout((onScroll as any)._t);
      dom.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiptap]);

  // Seed the editor content imperatively on every tab switch (the TipTap
  // setContent in the tabs-sync effect above). After this, React NEVER
  // re-applies content while editing — the editor is uncontrolled, which
  // is what keeps the selection and undo stack intact.
  // Protected notes are read-only at the editor level (server still enforces).
  useEffect(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    try {
      // setEditable() re-emits "update" even when the flag didn't change
      // (TipTap v3), so calling it on every tabs change fed an infinite
      // setEditable → onUpdate → setTabs → setEditable render loop that
      // pegged the CPU on large notes. Only touch it on an actual change.
      const want = !protectedIdsRef.current.has(activeId);
      if (tiptap.isEditable !== want) tiptap.setEditable(want, false);
    } catch {}
  }, [tiptap, activeId, tabs]);

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
        // Retry through the pre-unlock window: the very first fetch can land
        // while the vault is still locked (server up, password not yet
        // entered) and used to give up for the whole session — the editor
        // then ran on stale tabs with no visible error.
        let res: Response | null = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            res = await fetch("/api/scratchpad");
          } catch {
            res = null;
          }
          if (cancelled) return;
          if (res && res.ok) break;
          res = null;
          await new Promise((r) => setTimeout(r, 3000));
          if (cancelled) return;
        }
        if (!res || !res.ok) return;
        const data = await res.json();
        // normalizeServerTab PRESERVES rev + pinned/protected flags — stripping
        // them here made protection invisible after every restart.
        const serverTabs: ScratchTab[] = Array.isArray(data.tabs)
          ? data.tabs
              .filter((x: any) => x && typeof x === "object" && !x.archived)
              .map((x: any) => normalizeServerTab(x))
          : [];
        if (cancelled) return;
        // Prime the save queue's mirror so it knows each tab's server rev.
        setSyncedScratchpadTabs(serverTabs);
        if (serverTabs.length) {
          // Server has the durable copy — it wins over the localStorage cache.
          setTabs(serverTabs);
          setActiveId(serverTabs[0].id);
          dropLegacyLocalTabs();
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
            })
              .then((r) => {
                if (r.ok) dropLegacyLocalTabs();
              })
              .catch(() => {});
          } else {
            dropLegacyLocalTabs();
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

  // Save-health banner: the queue reports when saves stop landing. Without
  // this the editor happily takes typing that exists only in window memory
  // and dies with the process (the "lost a day of notes" failure mode).
  useEffect(() => {
    setScratchpadFailureHandler((failing) => setSaveFailing(failing));
    return () => setScratchpadFailureHandler(null);
  }, []);

  // ── Rescue: orphaned revision snapshots ──
  const openRescue = useCallback(async () => {
    setRescueOpen(true);
    setRescueLoading(true);
    setRescueQuery("");
    try {
      const res = await fetch("/api/scratchpad/revisions/orphaned");
      if (res.ok) {
        const data = await res.json();
        setRescueList(Array.isArray(data.orphans) ? data.orphans : []);
      } else {
        setRescueList([]);
      }
    } catch {
      setRescueList([]);
    } finally {
      setRescueLoading(false);
    }
  }, []);

  const restoreOrphan = useCallback(async (tabId: string, content: string) => {
    try {
      // POST /tabs/:id/content upserts unknown ids — saving the latest
      // snapshot back under its original id revives the note (and keeps its
      // revision history attached).
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(tabId)}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) return;
      const refresh = await fetch("/api/scratchpad");
      if (refresh.ok) {
        const data = await refresh.json();
        const serverTabs: ScratchTab[] = Array.isArray(data.tabs)
          ? data.tabs.filter((x: any) => x && !x.archived).map((x: any) => normalizeServerTab(x))
          : [];
        setSyncedScratchpadTabs(serverTabs);
        setTabs(serverTabs);
        delete contentRef.current[tabId];
        delete editorHtmlRef.current[tabId];
        setActiveId(tabId);
      }
      setRescueList((prev) => prev.filter((x) => x.tabId !== tabId));
      const msg = t("scratchpad_rescue_restored");
      setStatusMsg(msg);
      if (msg) setTimeout(() => setStatusMsg(""), 3200);
    } catch {}
  }, [t]);

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
    setContextMenu(null);
    // Apply through a ProseMirror transaction. The old code did raw Range
    // surgery (deleteContents + insertNode) directly on the editor DOM;
    // ProseMirror's DOM observer then re-read the split text nodes as a
    // plain insertion and duplicated the replacement plus the node's tail
    // ("I want a rotation botrotation bot"). posAtDOM maps the captured
    // word range to doc positions and insertText replaces them in one step.
    const view = tiptap && !tiptap.isDestroyed ? tiptap.view : null;
    if (!view || !range.startContainer || !view.dom.contains(range.startContainer)) return;
    try {
      view.focus();
      const from = view.posAtDOM(range.startContainer, range.startOffset);
      const to = view.posAtDOM(range.endContainer, range.endOffset);
      // insertText only MAPS the existing selection through the step — with the
      // caret resting elsewhere (e.g. end of the note) it stayed there and the
      // caret visibly jumped a few lines down. Place it right after the fix.
      const tr = view.state.tr.insertText(replacement, from, to);
      tr.setSelection(TextSelection.create(tr.doc, from + replacement.length));
      tr.scrollIntoView();
      view.dispatch(tr);
      // PM's onUpdate (fired by dispatch) already synced content/tabs/saves.
      // Do NOT call the legacy onEditorInput here: it stores raw innerHTML,
      // where every empty paragraph carries a <br class="ProseMirror-
      // trailingBreak">. That diverges from getHTML() and makes the tabs-sync
      // effect treat the editor's own output as an EXTERNAL write — the
      // setContent() re-parse then injects a hard break into each empty
      // paragraph (blank lines multiply) and throws the caret to the end.
      triggerAutocomplete(tiptap.getText());
    } catch {}
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
    if (protectedIdsRef.current.has(activeIdRef.current)) return;
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
          body: JSON.stringify({ prefix: cleanPrefix, maxTokens: 16, tab_id: activeIdRef.current }),
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



  // Analyze runs the WHOLE note through the detection pipeline (LLM-backed
  // server-side). Pasting several items in quick succession used to fire one
  // full-note request per paste — collapse bursts: while a request for a tab
  // is in flight, remember only the latest content and analyze that once.
  const analyzePendingRef = useRef<Record<string, string | null>>({});
  const analyze = useCallback(async (id: string, content: string) => {
    const text = content.trim();
    if (!text) {
      analyzePendingRef.current[id] = null;
      setDetections((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
      return;
    }
    if (analyzePendingRef.current[id]) {
      analyzePendingRef.current[id] = content;
      return;
    }
    analyzePendingRef.current[id] = content;
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
      const queued = analyzePendingRef.current[id];
      analyzePendingRef.current[id] = null;
      if (typeof queued === "string" && queued.trim() && queued !== content) {
        analyze(id, queued);
      }
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
      setStatusMsg("Restored multiline paragraph formatting!");
      setTimeout(() => setStatusMsg(""), 3000);
    }
  }, [tiptap, activeId, recordSnapshot]);

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

  // Intercept Tab / ArrowRight to accept inline ghost text auto-complete,
  // and Ctrl/Cmd+Z/Y for undo/redo history.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === "Tab" || e.key === "ArrowRight") && ghostCompletion && enablePredictions) {
        e.preventDefault();
        // Insert as a ProseMirror text transaction — raw DOM insertNode on the
        // editor fights the DOM observer and can duplicate text. No legacy
        // onEditorInput afterwards: raw innerHTML into contentRef diverges
        // from getHTML() on empty paragraphs and triggers a destructive
        // setContent() re-parse (see handleApplySuggestion).
        const view = tiptap && !tiptap.isDestroyed ? tiptap.view : null;
        if (view) {
          try {
            view.dispatch(view.state.tr.insertText(" " + ghostCompletion));
            triggerAutocomplete(tiptap.getText());
          } catch {}
          setGhostCompletion("");
          setCaretPos(null);
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
    [ghostCompletion, enablePredictions, tiptap, historyUndo, historyRedo]
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

    // SERVER FIRST: the server decides (it refuses protected notes). Local
    // state only changes after a confirmed success — an optimistic removal
    // followed by a refusal made the note "disappear then reappear".
    let data: any = null;
    try {
      const res = await fetch("/api/scratchpad/archive-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: id, tab: target }),
      });
      data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        setStatus(t("scratchpad_archive_protected" as any) || "This note is protected — unprotect it before archiving.");
        return;
      }
    } catch {
      setStatus(t("scratchpad_archive_failed" as any) || "Archive failed — nothing was changed.");
      return;
    }

    // Server confirmed: adopt its authoritative active-tab list.
    const activeTabs: ScratchTab[] = Array.isArray(data.activeTabs)
      ? data.activeTabs.map((x: any) => normalizeServerTab(x))
      : tabs.filter((x) => x.id !== id);
    if (activeTabs.length === 0) {
      const fresh = { id: uid(), title: "Scratch 1", content: "", archived: false };
      setTabs([fresh]);
      setActiveId(fresh.id);
    } else {
      setTabs(activeTabs);
      if (id === activeId || !activeTabs.some((x) => x.id === activeId)) setActiveId(activeTabs[0].id);
    }
    setSyncedScratchpadTabs(activeTabs);
    setArchivedCount(typeof data.archivedCount === "number" ? data.archivedCount : (c) => c + 1);
    if (archivedTabs !== null && target) {
      setArchivedTabs((prev) => [{ ...target, archived: true, archivedAt: Date.now() }, ...(prev || [])]);
    }
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

  const closeTab = async (id: string, skipConfirm: boolean = false) => {
    const target = tabs.find((x) => x.id === id);
    if (!skipConfirm && !window.confirm(`Are you sure you want to delete "${target?.title || "Scratch"}"?`)) return;

    // SERVER FIRST: only remove the note locally once the server confirms the
    // delete. A protected note (423) stays exactly where it is.
    try {
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 423) {
        setStatus(t("scratchpad_close_protected" as any) || "This note is protected — unprotect it before deleting.");
        return;
      }
      if (!res.ok && res.status !== 404) {
        setStatus(t("scratchpad_close_failed" as any) || "Delete failed — nothing was changed.");
        return;
      }
    } catch {
      setStatus(t("scratchpad_close_failed" as any) || "Delete failed — nothing was changed.");
      return;
    }

    // Server confirmed the deletion. Replace an emptied notebook with a fresh
    // note (the old one is already gone server-side, so no resurrection).
    const remainingTabs = tabs.filter((x) => x.id !== id);
    if (remainingTabs.length === 0) {
      const fresh = { id: uid(), title: "Scratch 1", content: "" };
      setTabs([fresh]);
      setActiveId(fresh.id);
      setSyncedScratchpadTabs([]);
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
    setSyncedScratchpadTabs(remainingTabs);
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
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          // The rename bumped the server-side rev — adopt it so the next
          // content save doesn't 409 against our own rename.
          if (data?.tab) mergeSyncedScratchpadTab(data.tab as ScratchTab);
        })
        .catch(() => {});
    }
    setRenameId(null);
    setRenameValue("");
  };

  const startRename = (id: string) => {
    const cur = tabs.find((x) => x.id === id);
    setRenameId(id);
    setRenameValue(cur?.title || "");
  };

  // Stable callback ref: runs ONCE when the rename input mounts (an inline
  // ref re-runs every render, and re-selecting the text after each keystroke
  // makes the next letter replace the whole field). useCallback keeps the
  // identity stable so React treats it as attached.
  const renameInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      try { el.select(); } catch {}
    }
  }, []);

  // Two-click force-save for duplicates: the first save attempt only warns
  // (remembering the items' signature); an immediate second attempt with the
  // same items proceeds. Re-save on purpose without needing a modal.
  const dupAckRef = useRef<string | null>(null);
  const checkDupAck = async (items: { value?: string; name?: string }[]): Promise<boolean> => {
    const sig = JSON.stringify(items.map((i) => String(i.value ?? "")));
    let hits: Awaited<ReturnType<typeof findDuplicateHits>> = [];
    try {
      hits = await findDuplicateHits(items);
    } catch {
      return true;
    }
    if (!hits.length) return true;
    if (dupAckRef.current === sig) {
      dupAckRef.current = null;
      return true;
    }
    dupAckRef.current = sig;
    const names = hits
      .map((h) => `"${h.existing_name}"`)
      .slice(0, 3)
      .join(", ");
    const more = hits.length > 3 ? ` +${hits.length - 3}` : "";
    setStatus(`Already in vault: ${names}${more} — click Save again to save anyway / موجود مسبقاً في الخزنة`);
    return false;
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
    // Duplicate screen: warn on first attempt, save on repeat (two-click force).
    if (!(await checkDupAck(items))) return;
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
    // Duplicate screen: warn on first attempt, save on repeat (two-click force).
    if (!(await checkDupAck(items))) return;
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
    if (protectedIdsRef.current.has(activeId)) return;
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
        body: JSON.stringify({ text, style, tab_id: activeId }),
      });
      const data = await res.json();
      if (res.ok && data.rewritten) {
        setRephraseUndo((prev) => ({
          ...prev,
          [activeId]: [...(prev[activeId] || []), original],
        }));
        const newHtml = textToNoteHtml(data.rewritten);
        // setContent routes through setEditorHtml for the active tab, which
        // updates DOM + history + state together — no direct innerHTML write.
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
    if (protectedIdsRef.current.has(activeId)) return;
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
        body: JSON.stringify({ text, tab_id: activeId }),
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
       await copyTextToClipboard(htmlToPlainText(active?.content || ""));
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
  const activePlainText = useMemo(() => htmlToPlainText(active?.content || ""), [active?.content]);
  // htmlToPlainText sanitizes + DOM-parses the whole note — memoize it and the
  // direction scan instead of re-running both on every render.
  const detectedDir = useMemo(() => detectBaseDir(activePlainText), [activePlainText]);
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
      <NoteTabStrip
        activeId={activeId}
        addTab={addTab}
        archiveTab={archiveTab}
        closeTab={closeTab}
        commitRename={commitRename}
        dragId={dragId}
        overId={overId}
        renameId={renameId}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        reorderTab={reorderTab}
        setActiveId={setActiveId}
        setDragId={setDragId}
        setOverId={setOverId}
        setRenameId={setRenameId}
        setRenameValue={setRenameValue}
        startRename={startRename}
        t={t}
        tabs={tabs}
      />

      {/* Save-health alarm — saves are NOT landing; typing exists only in
          this window. Never let this fail silently again. */}
      {saveFailing && (
        <div
          className="rounded-2xl px-4 py-3 flex items-center gap-3 text-xs font-semibold"
          style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.45)", color: "#fca5a5" }}
        >
          <span className="text-base leading-none">⚠</span>
          <span className="flex-1">{t("scratchpad_save_failed")}</span>
          <button
            type="button"
            onClick={() => { void drainScratchpadSaves(); }}
            className="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer"
            style={{ background: "rgba(248,113,113,0.25)", color: "#fecaca", border: "1px solid rgba(248,113,113,0.5)" }}
          >
            Retry now
          </button>
        </div>
      )}

      {/* Editor + actions */}
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <EditorPanel
          active={active}
          activeCharCount={activeCharCount}
          activeId={activeId}
          activeIsPinned={activeIsPinned}
          activeIsProtected={activeIsProtected}
          activeReadingTime={activeReadingTime}
          activeWordCount={activeWordCount}
          analyze={analyze}
          b={b}
          bidiMode={bidiMode}
          canScrollDown={canScrollDown}
          canScrollUp={canScrollUp}
          contextMenu={contextMenu}
          copied={copied}
          detectedDir={detectedDir}
          enablePredictions={enablePredictions}
          ghostCompletion={ghostCompletion}
          handleAddToDictionary={handleAddToDictionary}
          handleApplySuggestion={handleApplySuggestion}
          handleCopy={handleCopy}
          handleIgnoreWord={handleIgnoreWord}
          handleOpenRevisions={handleOpenRevisions}
          handleProofread={handleProofread}
          handleRephrase={handleRephrase}
          handleSaveNote={handleSaveNote}
          handleSaveSecret={handleSaveSecret}
          handleSmartSplitParagraphs={handleSmartSplitParagraphs}
          handleUndoRephrase={handleUndoRephrase}
          hasSecret={hasSecret}
          highlightColor={highlightColor}
          noteFontSize={noteFontSize}
          noteOverflows={noteOverflows}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          openCompare={openCompare}
          openRescue={openRescue}
          recordSnapshot={recordSnapshot}
          rephraseUndo={rephraseUndo}
          scrollEditor={scrollEditor}
          setContent={setContent}
          setContextMenu={setContextMenu}
          setGhostCompletion={setGhostCompletion}
          setProtectConfirmInput={setProtectConfirmInput}
          setProtectError={setProtectError}
          setProtectModal={setProtectModal}
          setSlashOpen={setSlashOpen}
          setStyle={setStyle}
          settings={settings}
          shellRef={shellRef}
          slashOpen={slashOpen}
          spellRects={spellRects}
          statusMsg={statusMsg}
          style={style}
          t={t}
          tabs={tabs}
          tiptap={tiptap}
          togglePin={togglePin}
          togglePredictions={togglePredictions}
          triggerAutocomplete={triggerAutocomplete}
        />

        <FormattingToolbar
          bidiMode={bidiMode}
          canScrollDown={canScrollDown}
          canScrollUp={canScrollUp}
          detectedDir={detectedDir}
          execFormat={execFormat}
          highlightColor={highlightColor}
          historyRedo={historyRedo}
          historyUndo={historyUndo}
          noteOverflows={noteOverflows}
          pastePlain={pastePlain}
          scrollEditor={scrollEditor}
          setBidiMode={setBidiMode}
          setHighlightColor={setHighlightColor}
          setPastePlain={setPastePlain}
          setShowHighlightPicker={setShowHighlightPicker}
          setShowTextColorPicker={setShowTextColorPicker}
          setTextColor={setTextColor}
          showHighlightPicker={showHighlightPicker}
          showTextColorPicker={showTextColorPicker}
          t={t}
          textColor={textColor}
          tiptap={tiptap}
          toolbarRef={toolbarRef}
        />

        {/* Detection status, moved to underneath the text box. */}
        {detection ? (
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {t("scratchpad_ai_detected")}: {detection.families.join(", ")}
            {detection.provider ? ` · ${detection.provider}` : ""}
          </span>
        ) : (
          <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
            {t("scratchpad_no_detection")}
          </span>
        )}
      </div>

      <ArchiveSection
        archivedCount={archivedCount}
        archivedTabs={archivedTabs}
        deleteArchivedTab={deleteArchivedTab}
        loadingArchived={loadingArchived}
        restoreTab={restoreTab}
        setPreviewArchivedTab={setPreviewArchivedTab}
        showArchived={showArchived}
        t={t}
        toggleShowArchived={toggleShowArchived}
      />

      <ArchivedNotePreview
        deleteArchivedTab={deleteArchivedTab}
        previewArchivedTab={previewArchivedTab}
        restoreTab={restoreTab}
        setPreviewArchivedTab={setPreviewArchivedTab}
        setStatus={setStatus}
      />

      <RevisionHistoryModal
        active={active}
        handleRestoreRevision={handleRestoreRevision}
        revisionsList={revisionsList}
        selectedRevision={selectedRevision}
        setSelectedRevision={setSelectedRevision}
        setShowRevisions={setShowRevisions}
        showRevisions={showRevisions}
        t={t}
      />

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

      <ProtectModal
        protectConfirmInput={protectConfirmInput}
        protectError={protectError}
        protectInputRef={protectInputRef}
        protectModal={protectModal}
        protectShowInput={protectShowInput}
        setProtectConfirmInput={setProtectConfirmInput}
        setProtectError={setProtectError}
        setProtectModal={setProtectModal}
        setProtectShowInput={setProtectShowInput}
        submitProtect={submitProtect}
        t={t}
      />

      <RescueModal
        rescueList={rescueList}
        rescueLoading={rescueLoading}
        rescueOpen={rescueOpen}
        rescueQuery={rescueQuery}
        restoreOrphan={restoreOrphan}
        setRescueOpen={setRescueOpen}
        setRescueQuery={setRescueQuery}
        t={t}
      />

      <CompareModal
        compareA={compareA}
        compareB={compareB}
        compareData={compareData}
        compareOpen={compareOpen}
        setCompareA={setCompareA}
        setCompareB={setCompareB}
        setCompareOpen={setCompareOpen}
        t={t}
        tabs={tabs}
      />
    </div>
  );
};

export default ScratchpadTab;
