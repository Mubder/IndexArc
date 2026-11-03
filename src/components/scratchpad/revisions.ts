export interface NoteRevision {
  id: string;
  tabId: string;
  timestamp: number;
  title: string;
  content: string;
  charCount: number;
  wordCount: number;
  reason?: string;
}

// Revisions live on the SERVER (data/note_revisions.json) — the durable,
// encrypted store. The browser keeps no copy (the old idb-keyval/localStorage
// revisions died with the client-persistence cleanup).
export async function getNoteRevisions(tabId: string): Promise<NoteRevision[]> {
  try {
    const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(tabId)}/revisions`);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.revisions)) return data.revisions;
    }
  } catch {}
  return [];
}

export async function saveNoteRevision(rev: NoteRevision, _maxKeep = 30): Promise<void> {
  try {
    const existing = await getNoteRevisions(rev.tabId);
    if (existing.length > 0 && existing[0].content === rev.content) return;
    await fetch(`/api/scratchpad/tabs/${encodeURIComponent(rev.tabId)}/revisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rev),
    });
  } catch {}
}
