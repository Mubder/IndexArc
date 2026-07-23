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
} from "lucide-react";
import { AnalyzeCandidate, Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface ScratchTab {
  id: string;
  title: string;
  content: string;
  archived?: boolean;
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

export const ScratchpadTab: React.FC<{ settings: Settings | null }> = ({ settings }) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const initial = useRef(loadTabs());
  const [tabs, setTabs] = useState<ScratchTab[]>(initial.current);
  const [activeId, setActiveId] = useState<string>(initial.current[0].id);
  const [detections, setDetections] = useState<Record<string, Detection>>({});
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState<RewriteStyle>("professional");
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [showArchived, setShowArchived] = useState(false);
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

  // Arabic spellcheck overlay (Electron only): set of misspelled Arabic words
  const editorRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [misspelledAr, setMisspelledAr] = useState<Set<string>>(new Set());
  const [highlightColor, setHighlightColor] = useState<string>("#fef08a");
  const [textColor, setTextColor] = useState<string>("#ffffff");
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);

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
  // editor so the selection never collapses — no save/restore needed.
  const execFormat = useCallback((command: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    editor.focus();
    // Formatting is a discrete edit — snapshot immediately.
    historyPushImmediate();
    contentRef.current[activeIdRef.current] = editor.innerHTML;
    setTabs((prev) =>
      prev.map((x) => (x.id === activeIdRef.current ? { ...x, content: editor.innerHTML } : x))
    );
  }, [historyPushImmediate]);

  const htmlToPlainText = (html: string): string => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return d.textContent || d.innerText || "";
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

  const active = tabs.find((x) => x.id === activeId) || tabs[0];
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

  const spellApi =
    typeof window !== "undefined" ? window.electronAPI?.spellcheckArabic : undefined;

  // Debounced Arabic spellcheck of the active tab's content. Runs regardless of
  // the UI language — it is driven by the CONTENT (any Arabic text), so writing
  // Arabic while the interface is English still gets red-underline marking.
  useEffect(() => {
    if (!spellApi) {
      setMisspelledAr((prev) => (prev.size ? new Set<string>() : prev));
      return;
    }
    const text = htmlToPlainText(active?.content || "");
    const matches: string[] = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g) || [];
    const words: string[] = Array.from(new Set(matches));
    if (!words.length) {
      setMisspelledAr((prev) => (prev.size ? new Set<string>() : prev));
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const bad = await spellApi(words);
        if (!cancelled) setMisspelledAr(new Set(bad));
      } catch {
        /* ignore */
      }
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [active?.content, spellApi]);

  const syncOverlayScroll = useCallback(() => {
    if (overlayRef.current && editorRef.current) {
      overlayRef.current.scrollTop = editorRef.current.scrollTop;
      overlayRef.current.scrollLeft = editorRef.current.scrollLeft;
    }
  }, []);

  // Build the highlighted HTML for the overlay: misspelled Arabic words get a
  // red wavy underline; everything else is transparent so the editor shows.
  const overlayHtml = React.useMemo(() => {
    const text = htmlToPlainText(active?.content || "");
    if (!misspelledAr.size) return "";
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return esc(text).replace(
      /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]+/g,
      (w) => (misspelledAr.has(w) ? `<span class="ar-misspell">${w}</span>` : w)
    );
  }, [active?.content, misspelledAr]);

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
          // Server has the durable copy — it wins over the localStorage cache.
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
        /* offline / locked — keep localStorage tabs */
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
      const auto = firstLine.slice(0, 40) || active.title;
      setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, title: auto } : x)));
    }
    // Sync content into React state so persistence (localStorage + server)
    // and the Arabic overlay fire. This is SAFE now because the editor is
    // uncontrolled — React no longer re-applies innerHTML to it (we removed
    // dangerouslySetInnerHTML), so this re-render cannot destroy the
    // selection or corrupt the undo stack.
    setTabs((prev) => {
      const cur = prev.find((x) => x.id === id);
      if (cur && cur.content === html) return prev;
      return prev.map((x) => (x.id === id ? { ...x, content: html } : x));
    });
  }, [active?.title, analyze, scheduleHistoryPush]);

  const [pastePlain, setPastePlain] = useState(true);

  const onPaste = (e: React.ClipboardEvent) => {
    pasteFlag.current[activeId] = true;
    if (!pastePlain) return;
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  // Intercept Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (or Ctrl+Y) so they drive OUR
  // history stack instead of the browser's native execCommand undo, which is
  // unreliable under React reconciliation.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
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
    [historyUndo, historyRedo]
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
    setTabs((prev) => {
      const archived = prev.map((x) => (x.id === id ? { ...x, archived: true } : x));
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

  const closeTab = (id: string) => {
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

  const handleSaveSecret = async () => {
    const plainText = htmlToPlainText(active.content).trim();
    if (!plainText) return;
    const stripUrl = (v: string) => v.replace(/^https?:\/\//, "");
    const secretItems: Array<Partial<AnalyzeCandidate> & { notes?: string }> =
      detection?.candidates?.filter((c) => c.family === "secret" || c.family === "unknown") || [];
    const items: Array<Partial<AnalyzeCandidate> & { notes?: string }> =
      secretItems.length > 0
        ? secretItems.map((c) => ({ ...c, value: stripUrl(c.value || "") }))
        : [
            {
              value: stripUrl(plainText),
              type: "note",
              name: active.title,
              raw_fragment: plainText,
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
    const original = active.content;
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
      await navigator.clipboard.writeText(htmlToPlainText(active.content));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* Internal tabs */}
      <div className="flex items-center gap-1 flex-wrap">
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
              className="group flex items-center gap-1 pl-3 pr-1.5 py-1.5 rounded-xl cursor-pointer text-xs font-medium transition-all"
              style={{
                background: isActive ? "var(--bg-active)" : "transparent",
                color: isActive ? "var(--accent-bright)" : "var(--text-dim)",
                border: `1px solid ${isActive ? "var(--border-glow)" : "var(--border)"}`,
                opacity: dragId === tab.id ? 0.4 : 1,
                boxShadow: overId === tab.id && dragId && dragId !== tab.id ? "0 -2px 0 var(--accent-bright)" : undefined,
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
                  className="bg-transparent outline-none w-28"
                  style={{ color: "var(--text)" }}
                />
              ) : (
                <span onDoubleClick={(e) => { e.stopPropagation(); startRename(tab.id); }}>{tab.title}</span>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  startRename(tab.id);
                }}
                className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                aria-label={t("scratchpad_rename")}
                title={t("scratchpad_rename")}
              >
                <Pencil className="w-3 h-3" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  archiveTab(tab.id);
                }}
                className="opacity-50 hover:opacity-100 transition-opacity"
                aria-label={t("scratchpad_archive")}
                title={t("scratchpad_archive")}
              >
                <Archive className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className="opacity-50 hover:opacity-100 transition-opacity"
                aria-label="Close tab"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          onClick={addTab}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all"
          style={{ color: "var(--text-muted)", border: "1px dashed var(--border)" }}
          title={t("scratchpad_add")}
        >
          <Plus className="w-3.5 h-3.5" /> {t("scratchpad_add")}
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
            onClick={() => analyze(activeId, htmlToPlainText(active.content))}
            disabled={b.analyze || !htmlToPlainText(active.content).trim()}
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
              onClick={handleSaveSecret}
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
              setContent(activeId, "");
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
            style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("scratchpad_clear")}
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
              disabled={b.rewrite || !active.content.trim()}
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

        <div className="relative">
          {overlayHtml && (
            <div
              ref={overlayRef}
              aria-hidden="true"
              dir="auto"
              className="ar-spell-overlay absolute inset-0 z-0 w-full rounded-xl px-3 py-2 text-sm overflow-auto pointer-events-none whitespace-pre-wrap break-words"
              style={{
                border: "1px solid var(--border-input)",
                color: "transparent",
                fontFamily: "var(--font-mono)",
              }}
              dangerouslySetInnerHTML={{ __html: overlayHtml + "\n" }}
            />
          )}
          <div
            ref={editorRef}
            key={activeId}
            contentEditable
            suppressContentEditableWarning
            dir="auto"
            spellCheck={true}
            onInput={onEditorInput}
            onPaste={onPaste}
            onKeyDown={onKeyDown}
            onScroll={syncOverlayScroll}
            className="relative z-10 w-full rounded-xl px-3 py-2 text-sm focus:outline-none transition-colors min-h-[200px] max-h-[60vh] overflow-auto"
            style={{
              background: overlayHtml ? "transparent" : "var(--bg-input)",
              border: "1px solid var(--border-input)",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          />
        </div>

        {/* Formatting toolbar */}
        <div
          ref={toolbarRef}
          onMouseDown={(e) => e.preventDefault()}
          className="flex items-center gap-0.5 flex-wrap"
          style={{ borderTop: "1px solid var(--border)", paddingTop: "8px" }}
        >
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
                ▾
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
                ▾
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
            {detection.provider ? ` · ${detection.provider}` : ""}
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
            <span>{showArchived ? "▾" : "▸"}</span>
          </button>
          {showArchived && (
            <div className="px-4 pb-3 flex flex-col gap-1.5">
              {tabs
                .filter((x) => x.archived)
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
                      onClick={() => closeTab(tab.id)}
                      className="opacity-70 hover:opacity-100 transition-opacity"
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
