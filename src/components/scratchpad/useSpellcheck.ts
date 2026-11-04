import React, { useState, useRef, useEffect, useCallback } from "react";
import { type SpellRect, sanitizeToken, extractSpellWords, collectMisspellRects, getWordAtPoint } from "./domText";
import { htmlToPlainText } from "../../lib/noteHtml";
import { TextSelection } from "@tiptap/pm/state";
import type { RefObject } from "react";
import type { ScratchTab, Settings } from "../../types";
import type { Editor } from "@tiptap/react";
import { getTranslation } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";

export interface UseSpellcheckArgs {
  active: ScratchTab;
  editorRef: RefObject<HTMLDivElement | null>;
  recomputeSpellRectsRef: RefObject<() => void>;
  setStatus: (msg: string) => void;
  settings: Settings | null;
  tiptap: Editor;
  triggerAutocomplete: (prefixText: string) => void;
}

// Live bilingual spellcheck: worker tokenizing, underline rects, and the suggestion menu.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useSpellcheck({ active, editorRef, recomputeSpellRectsRef, setStatus, settings, tiptap, triggerAutocomplete }: UseSpellcheckArgs) {
  const [misspelledWords, setMisspelledWords] = useState<Set<string>>(new Set());
  const [spellRects, setSpellRects] = useState<SpellRect[]>([]);
  const [ignoredWords, setIgnoredWords] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    word: string;
    range: Range | null;
    suggestions: string[];
    loading: boolean;
  } | null>(null);
  const spellWorkerRef = useRef<Worker | null>(null);
  const misspelledRef = useRef(misspelledWords);
  misspelledRef.current = misspelledWords;

  // Spellcheck Web Worker — off main thread tokenization
  useEffect(() => {
    try {
      spellWorkerRef.current = new Worker(new URL("../../workers/spellcheck.worker.ts", import.meta.url), { type: "module" });
    } catch {}
    return () => { try { spellWorkerRef.current?.terminate(); } catch {} };
  }, []);

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
    setStatus(fill(getTranslation(settings, "spell_added_to_dict"), { word: clean }));
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
    setStatus(fill(getTranslation(settings, "spell_ignored"), { word: clean }));
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

  return { contextMenu, handleAddToDictionary, handleApplySuggestion, handleIgnoreWord, misspelledWords, onContextMenu, recomputeSpellRects, setContextMenu, spellRects };
}
