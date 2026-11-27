import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import { TextSelection } from "@milkdown/kit/prose/state";
import { undo, redo } from "@milkdown/kit/prose/history";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic-dark.css";
import { matchPositions, type FindOptions } from "./findText";

export type MarkdownEditorHandle = {
  /** Select the nth visible match. Returns how many matches exist. */
  selectMatch: (query: string, nth: number, opts?: FindOptions) => number;
  undo: () => void;
  redo: () => void;
};

// The markdown string is the file. Crepe draws it and writes the same markdown back.
export const MarkdownEditor = forwardRef<MarkdownEditorHandle, { value: string; onChange: (markdown: string) => void; onReady?: () => void }>(
function MarkdownEditor({ value, onChange, onReady }, ref) {
  const host = useRef<HTMLDivElement>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useImperativeHandle(ref, () => ({
    selectMatch(query, nth, opts) {
      const crepe = crepeRef.current;
      if (!crepe) return 0;
      let total = 0;
      try {
        crepe.editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const match = matchPositions(view.state.doc, query, nth, opts);
          if (!match || match.from < 0) {
            total = match?.total ?? 0;
            return;
          }
          total = match.total;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, match.from, match.to)));
          try {
            const coords = view.coordsAtPos(match.from);
            const marked = view.dom.closest("[data-doc-scroll]");
            const scroller = marked instanceof HTMLElement ? marked : null;
            if (scroller) {
              const box = scroller.getBoundingClientRect();
              scroller.scrollTop += coords.top - box.top - box.height / 3;
            }
          } catch { /* the selection is still set */ }
        });
      } catch {
        return 0;
      }
      return total;
    },
    undo() { runHistory(undo); },
    redo() { runHistory(redo); },
  }));

  const runHistory = (cmd: typeof undo) => {
    const crepe = crepeRef.current;
    if (!crepe) return;
    try {
      crepe.editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        cmd(view.state, (tr) => view.dispatch(tr.setMeta("addToHistory", true)));
      });
    } catch { /* editor not ready */ }
  };

  useEffect(() => {
    const root = host.current;
    if (!root) return;
    const crepe = new Crepe({
      root,
      defaultValue: value,
      features: {
        [Crepe.Feature.AI]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
        // A code editor inside every fenced block is what made Rich take
        // half a minute on a normal markdown file.
        [Crepe.Feature.CodeMirror]: false,
        [Crepe.Feature.BlockEdit]: false,
      },
    });
    crepeRef.current = crepe;
    let ready = false;
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        if (ready) onChangeRef.current(markdown);
      });
    });
    void crepe.create().then(() => { ready = true; onReady?.(); }).catch(() => { onReady?.(); });
    return () => {
      ready = false;
      crepeRef.current = null;
      void crepe.destroy().catch(() => {});
    };
    // Mount once per file. The parent sets `key` to the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="doc-markdown min-h-[60vh]" dir="auto" />;
});
