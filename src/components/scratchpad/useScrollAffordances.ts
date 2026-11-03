import { useState, useCallback, useLayoutEffect, useEffect } from "react";
import { scrollContainerToReveal } from "./domText";
import type { RefObject } from "react";
import type { ScratchTab, NoteBidiMode } from "../../types";

export interface UseScrollAffordancesArgs {
  active: ScratchTab;
  activeId: string;
  bidiMode: NoteBidiMode;
  editorRef: RefObject<HTMLDivElement | null>;
  misspelledWords: Set<string>;
  noteFontSize: number;
  recomputeSpellRects: () => void;
  scratchRootRef: RefObject<HTMLDivElement | null>;
  shellRef: RefObject<HTMLDivElement | null>;
  updateScrollAffordancesRef: RefObject<() => void>;
}

// Scroll state of the note (overflow, can scroll up/down) and jump to top/bottom.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useScrollAffordances({ active, activeId, bidiMode, editorRef, misspelledWords, noteFontSize, recomputeSpellRects, scratchRootRef, shellRef, updateScrollAffordancesRef }: UseScrollAffordancesArgs) {
  const [noteOverflows, setNoteOverflows] = useState(false);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

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

  return { canScrollDown, canScrollUp, noteOverflows, scrollEditor };
}
