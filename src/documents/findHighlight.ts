// A persistent find match highlight. Native ::selection fades when focus
// moves to the Find input; Custom Highlight API ranges stay visible.
const NAME = "indexarc-find-match";

// Injected at runtime: the CSS minifier does not understand ::highlight().
if (typeof document !== "undefined" && !document.getElementById("indexarc-find-style")) {
  const style = document.createElement("style");
  style.id = "indexarc-find-style";
  style.textContent = `::highlight(${NAME}){background:rgba(251,191,36,.6);color:#0a0f1e;border-radius:2px;}`;
  document.head.appendChild(style);
}

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): void;
  delete(name: string): void;
}

function registry(): HighlightRegistryLike | null {
  const css = CSS as unknown as { highlights?: HighlightRegistryLike };
  return css.highlights || null;
}

/** Highlight `range`, or clear the previous highlight when range is null. */
export function showFindHighlight(range: Range | null): void {
  const reg = registry();
  if (!reg) return;
  if (!range) {
    reg.delete(NAME);
    return;
  }
  const HighlightCtor = (window as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;
  if (!HighlightCtor) return;
  reg.set(NAME, new HighlightCtor(range));
}

/** Build a DOM range from editor positions and highlight it. */
export function highlightDomRange(
  domAtPos: (pos: number) => { node: Node; offset: number },
  from: number,
  to: number
): void {
  try {
    const start = domAtPos(from);
    const end = domAtPos(to);
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    showFindHighlight(range);
  } catch {
    showFindHighlight(null);
  }
}
