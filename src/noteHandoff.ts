// In-memory handoff for "Reopen in Scratchpad" (App → ScratchpadTab).
// Replaces the old localStorage channel so note content never gets written to
// browser storage; both components live in the same page, so a module
// variable + a window event is enough.
export interface HandoffNote {
  title: string;
  html: string;
}

export const noteHandoff: { pending: HandoffNote | null } = { pending: null };

export const REOPEN_NOTE_EVENT = "indexarc-reopen-note";

export function offerNoteToScratchpad(note: HandoffNote): void {
  noteHandoff.pending = note;
  window.dispatchEvent(new Event(REOPEN_NOTE_EVENT));
}

export function takeHandoffNote(): HandoffNote | null {
  const n = noteHandoff.pending;
  noteHandoff.pending = null;
  return n;
}

// "Open in Scratchpad" from the Applications page: which existing note to
// show. Kept until the Scratchpad has loaded that note from the server.
export const FOCUS_NOTE_EVENT = "indexarc-focus-note";
let pendingFocus: string | null = null;

export function focusScratchpadNote(id: string): void {
  pendingFocus = id;
  window.dispatchEvent(new Event(FOCUS_NOTE_EVENT));
}

export function peekFocusNote(): string | null {
  return pendingFocus;
}

export function clearFocusNote(): void {
  pendingFocus = null;
}
