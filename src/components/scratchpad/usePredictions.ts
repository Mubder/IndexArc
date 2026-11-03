import { useState, useRef, useCallback } from "react";
import { measureCaretPos } from "./domText";
import type { RefObject } from "react";

export interface UsePredictionsArgs {
  activeIdRef: RefObject<string>;
  editorRef: RefObject<HTMLDivElement | null>;
  protectedIdsRef: RefObject<Set<string>>;
}

// Inline AI predictions (ghost completion) and the caret position they render at.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function usePredictions({ activeIdRef, editorRef, protectedIdsRef }: UsePredictionsArgs) {
  const [enablePredictions, setEnablePredictions] = useState<boolean>(() => {
    return localStorage.getItem("indexarc_enable_ghost") !== "false";
  });
  const [ghostCompletion, setGhostCompletion] = useState<string>("");
  const [caretPos, setCaretPos] = useState<{ top: number; left: number } | null>(null);
  const autocompleteTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  return { enablePredictions, ghostCompletion, setCaretPos, setGhostCompletion, togglePredictions, triggerAutocomplete };
}
