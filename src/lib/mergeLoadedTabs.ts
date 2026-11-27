import type { ScratchTab } from "../types";

/** Default names the scratchpad may replace with the first line. */
export function isDefaultNoteTitle(title: string | undefined): boolean {
  return /^Scratch( \d+)?$/.test(title || "");
}

/**
 * Server load must not throw away a name or a paragraph that exists only in
 * this window. Held tabs are unsaved edits (a conflict, a locked-out save,
 * or a save still waiting). A local title wins when the user named the note,
 * or when the server still has the default name.
 */
export function mergeLoadedTabs(server: ScratchTab[], local: ScratchTab[], held: ScratchTab[]): ScratchTab[] {
  const localBy = new Map(local.map((t) => [t.id, t]));
  const heldBy = new Map(held.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const merged = server.map((s) => {
    seen.add(s.id);
    const l = localBy.get(s.id);
    const h = heldBy.get(s.id);
    let next: ScratchTab = { ...s };
    if (l && l.title && l.title !== s.title && (l.title_custom || ( !isDefaultNoteTitle(l.title) && isDefaultNoteTitle(s.title)))) {
      next = { ...next, title: l.title, title_custom: l.title_custom || next.title_custom };
    }
    if (h && h.content !== s.content) next = { ...next, content: h.content };
    if (h && h.title && h.title !== next.title && (h.title_custom || isDefaultNoteTitle(s.title))) {
      next = { ...next, title: h.title, title_custom: h.title_custom || next.title_custom };
    }
    return next;
  });
  for (const h of held) {
    if (!seen.has(h.id)) merged.push(h);
  }
  return merged;
}
