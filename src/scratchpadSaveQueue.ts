import type { ScratchTab } from "./types";

// Module-level scratchpad save queue — per-tab content saves (PR-12).
//
// Lives OUTSIDE React on purpose: ScratchpadTab unmounts on every tab switch,
// and the old component-scoped debounce cancelled its pending fetch in the
// effect cleanup — losing the last ~1.2s of edits. This queue survives
// unmount, keeps only the latest snapshot, and flushes after a quiet period.
//
// Each changed tab is saved individually via
// POST /api/scratchpad/tabs/:id/content with the base rev it was edited from;
// a 409 (changed elsewhere) is handed to the conflict handler instead of
// retrying. Structural changes (rename/delete/reorder) are immediate calls
// from the component, not queued.

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

let pending: ScratchTab[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// Serialize posts so saves can't land out of order.
let chain: Promise<void> = Promise.resolve();
// Mirror of the server's tab state (incl. server-managed revs).
let lastSynced: ScratchTab[] = [];
let conflictHandler: ((serverTab: any) => void) | null = null;

export function setScratchpadConflictHandler(fn: ((serverTab: any) => void) | null): void {
  conflictHandler = fn;
}

export function setSyncedScratchpadTabs(tabs: ScratchTab[]): void {
  lastSynced = (tabs || []).map((t) => ({ ...t }));
}

export function getSyncedScratchpadTabs(): ScratchTab[] {
  return lastSynced.map((t) => ({ ...t }));
}

async function postTabContent(t: ScratchTab, baseRev?: number, force?: boolean): Promise<boolean> {
  const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(t.id)}/content`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: t.content,
      base_rev: baseRev,
      force: force || undefined,
    }),
  });
  if (res.status === 409) {
    const data = await res.json().catch(() => null);
    conflictHandler?.(data?.server_tab ?? null);
    return false;
  }
  if (res.status === 423) {
    // Protected note: the server refuses, period. Drop the local divergence
    // instead of retrying forever.
    return false;
  }
  if (!res.ok) throw new Error(`scratchpad tab save failed: ${res.status}`);
  return true;
}

function mergeSynced(tabs: ScratchTab[]): void {
  const byId = new Map(lastSynced.map((t) => [t.id, t]));
  for (const t of tabs) byId.set(t.id, { ...t });
  lastSynced = [...byId.values()];
}

function doFlush(): void {
  const save = pending;
  console.log("[q] doFlush save:", JSON.stringify(save));
  pending = null;
  chain = chain
    .then(async () => {
      if (!save) return;
      const changed = save.filter((t) => {
        const s = lastSynced.find((x) => x.id === t.id);
        return !s || s.content !== t.content;
      });
      for (const t of changed) {
        const s = lastSynced.find((x) => x.id === t.id);
        const ok = await postTabContent(t, s?.rev);
        if (!ok) return; // conflict surfaced to the handler; stop this flush
      }
      mergeSynced(save);
    })
    .catch(() => {
      pending = save; // try again later (network/server hiccup)
      if (timer === null) timer = setTimeout(fire, RETRY_MS);
    });
}

function fire(): void {
  timer = null;
  if (pending) doFlush();
}

/** Record the latest tab state; changed tabs are saved after the quiet period. */
export function enqueueScratchpadSave(tabs: ScratchTab[]): void {
  pending = tabs;
  if (timer === null) timer = setTimeout(fire, DEBOUNCE_MS);
}

/** Save one tab's content immediately, overriding any conflict (user choice). */
export function forceSaveScratchpadTab(tab: ScratchTab): Promise<void> {
  chain = chain
    .then(async () => {
      if (await postTabContent(tab, undefined, true)) {
        mergeSynced([tab]);
      }
    })
    .catch(() => {});
  return chain;
}

/**
 * Force any queued (or in-flight) save to post NOW and wait for it. Used
 * before loading from the server so the durable copy is never older than
 * what the user actually typed.
 */
export async function drainScratchpadSaves(): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending) doFlush();
  await chain.catch(() => {});
}

/** Test hook: reset module state between tests. */
export function __resetScratchpadSaveQueueForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = null;
  chain = Promise.resolve();
  lastSynced = [];
  conflictHandler = null;
}
