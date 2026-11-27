import { useEffect, useRef } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/classic-dark.css";

// The markdown string is the file. Crepe draws it and writes the same markdown back.
export function MarkdownEditor({ value, onChange, onReady }: { value: string; onChange: (markdown: string) => void; onReady?: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
    let ready = false;
    crepe.on((api) => {
      api.markdownUpdated((_ctx, markdown) => {
        if (ready) onChangeRef.current(markdown);
      });
    });
    void crepe.create().then(() => { ready = true; onReady?.(); }).catch(() => { onReady?.(); });
    return () => {
      ready = false;
      void crepe.destroy().catch(() => {});
    };
    // Mount once per file. The parent sets `key` to the path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} className="doc-markdown min-h-[60vh]" dir="auto" />;
}
