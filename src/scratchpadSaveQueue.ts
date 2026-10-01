import type { ScratchTab } from "./types";
import { sanitizeNoteHtmlForStorage } from "./sanitize";

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
// Save-health signal for the UI. Saves failing silently is how users lose a
// whole session of typing: the editor keeps working while nothing reaches
// disk, and the text dies with the window. The banner this drives is the
// loud "do not close the app" warning.
let saveFailing = false;
let failureHandler: ((failing: boolean) => void) | null = null;

export function setScratchpadFailureHandler(fn: ((failing: boolean) => void) | null): void {
  failureHandler = fn;
}

export function setScratchpadConflictHandler(fn: ((serverTab: any) => void) | null): void {
  conflictHandler = fn;
}

function setSaveFailing(next: boolean): void {
  if (saveFailing === next) return;
  saveFailing = next;
  try {
    failureHandler?.(next);
  } catch {}
}

export function setSyncedScratchpadTabs(tabs: ScratchTab[]): void {
  lastSynced = (tabs || []).map((t) => ({ ...t }));
}

/**
 * POST one tab's content. Returns the SERVER's saved tab (carrying the new
 * rev) on success, or false when the save was refused (409 conflict surfaced
 * to the handler / 423 protected). The returned rev matters: the server
 * bumps it on every content change, and the queue MUST adopt it — a stale
 * mirror rev made every save after the first trip the 409 "changed in
 * another window" conflict against the app's own previous write.
 *
 * `keepalive` is reserved for the exit-time flush (it lets a request outlive
 * the page). It must NOT be set on steady-state saves: Chromium caps keepalive
 * bodies at 64 KiB and rejects larger ones with a TypeError before anything
 * reaches the network — a large note would then never save at all. Even on
 * the exit path a TypeError falls back to a plain fetch.
 */
async function postTabContent(
  t: ScratchTab,
  baseRev?: number,
  force?: boolean,
  opts: { keepalive?: boolean } = {}
): Promise<ScratchTab | false> {
  const url = `/api/scratchpad/tabs/${encodeURIComponent(t.id)}/content`;
  const body = JSON.stringify({
    // Sanitize-on-write: the durable store only ever receives allowlisted
    // rich text — no scripts, handlers, or foreign elements can persist.
    content: sanitizeNoteHtmlForStorage(t.content ?? ""),
    // Title is only used when this POST creates the tab server-side
    // (upsert); existing tabs keep their title — renames go through /meta.
    title: t.title || undefined,
    base_rev: baseRev,
    force: force || undefined,
  });
  const doFetch = (keepalive: boolean) =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive,
      body,
    });
  let res: Response;
  try {
    res = await doFetch(!!opts.keepalive);
  } catch (e) {
    if (opts.keepalive && e instanceof TypeError) {
      // Keepalive 64 KiB body cap (or the page dying mid-flush) — retry as a
      // plain request so large notes still save.
      res = await doFetch(false);
    } else {
      throw e;
    }
  }
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
  const data = await res.json().catch(() => null);
  return data?.tab ? (data.tab as ScratchTab) : ({ ...t } as ScratchTab);
}

function mergeSynced(tabs: ScratchTab[]): void {
  const byId = new Map(lastSynced.map((t) => [t.id, t]));
  for (const t of tabs) byId.set(t.id, { ...t });
  lastSynced = [...byId.values()];
}

function doFlush(keepalive: boolean): void {
  const save = pending;
  pending = null;
  chain = chain
    .then(async () => {
      if (!save) return;
      const changed = save.filter((t) => {
        const s = lastSynced.find((x) => x.id === t.id);
        return !s || s.content !== t.content;
      });
      const serverTabs: ScratchTab[] = [];
      for (const t of changed) {
        const s = lastSynced.find((x) => x.id === t.id);
        const saved = await postTabContent(t, s?.rev, undefined, { keepalive });
        if (!saved) continue; // 409 surfaced to the handler / 423 protected: this tab is not retryable — keep saving the others
        serverTabs.push(saved);
      }
      // Server tabs merged LAST so their fresh revs win over the client
      // copies — otherwise the next save 409s against our own write.
      mergeSynced([...save, ...serverTabs]);
      setSaveFailing(false);
    })
    .catch(() => {
      pending = save; // try again later (network/server hiccup)
      setSaveFailing(true);
      if (timer === null) timer = setTimeout(fire, RETRY_MS);
    });
}

function fire(): void {
  timer = null;
  if (pending) doFlush(false);
}

/** Record the latest tab state; changed tabs are saved after the quiet period. */
export function enqueueScratchpadSave(tabs: ScratchTab[]): void {
  pending = tabs;
  if (timer === null) timer = setTimeout(fire, DEBOUNCE_MS);
}

/** Merge one server-known tab (fresh rev from an API response) into the
 *  queue's mirror — used by rename/meta and other one-off writers so their
 *  rev bumps don't turn the next content save into a false 409. */
export function mergeSyncedScratchpadTab(tab: ScratchTab): void {
  mergeSynced([tab]);
}

/** Save one tab's content immediately, overriding any conflict (user choice). */
export function forceSaveScratchpadTab(tab: ScratchTab): Promise<void> {
  chain = chain
    .then(async () => {
      const saved = await postTabContent(tab, undefined, true);
      if (saved) {
        // Adopt the server's saved tab (fresh rev) — the client copy's rev
        // is stale the moment the server accepts the write.
        mergeSynced([tab, saved]);
      }
    })
    .catch(() => {});
  return chain;
}

/**
 * Force any queued (or in-flight) save to post NOW and wait for it. Used
 * before loading from the server so the durable copy is never older than
 * what the user actually typed. `keepalive: true` is for unload-time flushes
 * only (see postTabContent for the 64 KiB cap).
 */
export async function drainScratchpadSaves(opts: { keepalive?: boolean } = {}): Promise<void> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (pending) doFlush(!!opts.keepalive);
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
  saveFailing = false;
  failureHandler = null;
}
