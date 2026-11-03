import { useCallback, useEffect } from "react";
import { ensureHtmlParagraphs } from "../../lib/noteHtml";
import type { Dispatch, SetStateAction, RefObject } from "react";
import type { ScratchTab } from "../../types";
import type { Editor } from "@tiptap/react";

export interface UseEditorCommandsArgs {
  activeIdRef: RefObject<string>;
  contentRef: RefObject<Record<string, string>>;
  editorHtmlRef: RefObject<Record<string, string>>;
  editorRef: RefObject<HTMLDivElement | null>;
  setShowHighlightPicker: Dispatch<SetStateAction<boolean>>;
  setShowTextColorPicker: Dispatch<SetStateAction<boolean>>;
  setTabs: Dispatch<SetStateAction<ScratchTab[]>>;
  tiptap: Editor;
  toolbarRef: RefObject<HTMLDivElement | null>;
}

// Formatting commands, undo/redo, and the single entry point for external content writes.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useEditorCommands({ activeIdRef, contentRef, editorHtmlRef, editorRef, setShowHighlightPicker, setShowTextColorPicker, setTabs, tiptap, toolbarRef }: UseEditorCommandsArgs) {
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

  return { execFormat, historyRedo, historyUndo, setEditorHtml };
}
