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
// Saves the server refused because the VAULT WAS LOCKED (423 is_locked).
// Distinct from a protected note's 423: these are the user's newest words
// and must survive until the vault is unlocked. Treating them like the
// protected case (drop + mark synced) silently lost the last few words typed
// before an auto-lock / lock-on-minimize. Keyed by tab id; a newer queued
// snapshot of the same tab supersedes the held copy.
const lockedOut = new Map<string, ScratchTab>();
// A 409 is not a successful save. The unsaved note stays here until the user
// chooses, and a later flush must not pretend the server already has it.
const conflictHeld = new Map<string, ScratchTab>();
export interface ScratchpadConflict {
  id: string;
  title: string;
  serverTab: ScratchTab | null;
  mine: ScratchTab;
}
const conflicts = new Map<string, ScratchpadConflict>();
const conflictListeners = new Set<() => void>();
let failureHandler: ((failing: boolean) => void) | null = null;

function notifyConflicts(): void {
  for (const fn of conflictListeners) {
    try { fn(); } catch {}
  }
}

export function subscribeScratchpadConflicts(fn: () => void): () => void {
  conflictListeners.add(fn);
  return () => conflictListeners.delete(fn);
}

export function getScratchpadConflicts(): ScratchpadConflict[] {
  return [...conflicts.values()];
}

/** Edits that have not reached the server. The load path merges these in. */
export function getUnsyncedScratchpadTabs(): ScratchTab[] {
  const byId = new Map<string, ScratchTab>();
  for (const t of lockedOut.values()) byId.set(t.id, t);
  for (const t of conflictHeld.values()) byId.set(t.id, t);
  if (pending) {
    for (const t of pending) {
      const s = lastSynced.find((x) => x.id === t.id);
      if (!s || s.content !== t.content) byId.set(t.id, t);
    }
  }
  return [...byId.values()];
}

/**
 * User answered the conflict banner. Keep-mine force-saves. Load-server
 * adopts the server note and tells a mounted scratchpad to show it.
 */
export function resolveScratchpadConflict(id: string, keepMine: boolean): void {
  const held = conflictHeld.get(id);
  const view = conflicts.get(id);
  conflictHeld.delete(id);
  conflicts.delete(id);
  notifyConflicts();
  if (keepMine && held) {
    void forceSaveScratchpadTab(held);
    return;
  }
  if (view?.serverTab) {
    mergeSynced([view.serverTab]);
    try {
      window.dispatchEvent(new CustomEvent("indexarc-note-reverted", { detail: { id, serverTab: view.serverTab } }));
    } catch {}
  }
}

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

/**
 * The server only ever RAISES a tab's rev, so the mirror never lowers one.
 * Callers hand us client copies whose rev is whatever was loaded (React state
 * never learns the revs the queue's own saves produced); taking those at face
 * value rolled the mirror back, and the next keystroke 409'd against the
 * app's own earlier save — the "changed in another window" banner mid-typing.
 */
function keepNewestRev(t: ScratchTab, prev: ScratchTab | undefined): ScratchTab {
  const a = Number(prev?.rev);
  const b = Number(t.rev);
  if (!Number.isFinite(a) || (Number.isFinite(b) && b >= a)) return { ...t };
  return { ...t, rev: a };
}

export function setSyncedScratchpadTabs(tabs: ScratchTab[]): void {
  const byId = new Map(lastSynced.map((t) => [t.id, t]));
  lastSynced = (tabs || []).map((t) => keepNewestRev(t, byId.get(t.id)));
}

/**
 * Vault locked: drop the module-level mirror of note content so it doesn't
 * outlive the lock in renderer memory. Unsaved edits (`pending`) are kept —
 * they are the user's own work and flush after unlock; ScratchpadTab
 * re-baselines the mirror from the server when it remounts.
 */
export function purgeScratchpadMirrorOnLock(): void {
  if (!pending && lockedOut.size === 0) lastSynced = [];
}

/** A tab was deleted for good: never re-save a held (locked-out) copy of it —
 *  the content POST upserts and would resurrect the note. */
export function forgetScratchpadTab(id: string): void {
  lockedOut.delete(id);
  lastSynced = lastSynced.filter((t) => t.id !== id);
  if (pending) pending = pending.filter((t) => t.id !== id);
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
): Promise<ScratchTab | false | "locked" | { conflict: true; serverTab: ScratchTab | null }> {
  const url = `/api/scratchpad/tabs/${encodeURIComponent(t.id)}/content`;
  const body = JSON.stringify({
    // Sanitize-on-write: the durable store only ever receives allowlisted
    // rich text — no scripts, handlers, or foreign elements can persist.
    content: sanitizeNoteHtmlForStorage(t.content ?? ""),
    // Title is only used when this POST creates the tab server-side
    // (upsert); existing tabs keep their title — renames go through /meta.
    title: t.title || undefined,
    // Likewise the application (Applications page) a new note starts in.
    app: t.app || undefined,
    // ...and whether the user named it (stops auto-title after a reload).
    title_custom: t.title_custom || undefined,
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
    const serverTab = (data?.server_tab ?? null) as ScratchTab | null;
    return { conflict: true, serverTab };
  }
  if (res.status === 423) {
    const data = await res.json().catch(() => null);
    // Vault locked (the unlock gate answers 423 { is_locked: true }): the
    // save is NOT refused for good — hold it and retry after unlock.
    if (data?.is_locked || data?.locked) return "locked";
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
  for (const t of tabs) byId.set(t.id, keepNewestRev(t, byId.get(t.id)));
  lastSynced = [...byId.values()];
}

function doFlush(keepalive: boolean): void {
  // Held (locked-out) tabs ride along unless this snapshot has a newer copy.
  let save = pending;
  if (lockedOut.size) {
    const ids = new Set((save || []).map((t) => t.id));
    const held = [...lockedOut.values()].filter((t) => !ids.has(t.id));
    save = [...(save || []), ...held];
    lockedOut.clear();
  }
  pending = null;
  chain = chain
    .then(async () => {
      if (!save || !save.length) return;
      const changed = save.filter((t) => {
        const s = lastSynced.find((x) => x.id === t.id);
        if (s && s.content === t.content) {
          conflictHeld.delete(t.id);
          if (conflicts.delete(t.id)) notifyConflicts();
          return false;
        }
        // Already shown to the user. Wait for their choice instead of
        // posting the same text into another 409.
        const held = conflictHeld.get(t.id);
        if (held && held.content === t.content) return false;
        return true;
      });
      const serverTabs: ScratchTab[] = [];
      const locked: ScratchTab[] = [];
      const conflictIds = new Set<string>();
      for (const t of changed) {
        const s = lastSynced.find((x) => x.id === t.id);
        const saved = await postTabContent(t, s?.rev, undefined, { keepalive });
        if (saved === "locked") {
          locked.push(t);
          continue;
        }
        if (saved && typeof saved === "object" && "conflict" in saved) {
          // A title save bumps rev without changing the text. That is our own
          // write. Adopt the rev and send the text once more.
          const serverTab = saved.serverTab;
          const base = lastSynced.find((x) => x.id === t.id);
          if (serverTab && base && serverTab.content === base.content && serverTab.rev !== base.rev) {
            mergeSynced([serverTab]);
            const retried = await postTabContent(t, serverTab.rev, undefined, { keepalive });
            if (retried && typeof retried === "object" && !("conflict" in retried)) {
              serverTabs.push(retried);
              lockedOut.delete(t.id);
              conflictHeld.delete(t.id);
              if (conflicts.delete(t.id)) notifyConflicts();
              continue;
            }
            if (retried === "locked") {
              locked.push(t);
              continue;
            }
          }
          conflictIds.add(t.id);
          conflictHeld.set(t.id, t);
          conflicts.set(t.id, { id: t.id, title: t.title || "", serverTab, mine: t });
          conflictHandler?.(serverTab);
          notifyConflicts();
          continue;
        }
        if (!saved) continue; // 423 protected: this tab is not retryable — keep saving the others
        serverTabs.push(saved);
        lockedOut.delete(t.id);
        conflictHeld.delete(t.id);
        if (conflicts.delete(t.id)) notifyConflicts();
      }
      // Server tabs merged LAST so their fresh revs win over the client
      // copies — otherwise the next save 409s against our own write. Tabs
      // held by the lock or by a conflict are NOT merged: the mirror must
      // keep saying they differ from the server, or the retry would skip them
      // and a restart would load the older copy.
      const skipIds = new Set([...locked.map((t) => t.id), ...conflictIds]);
      mergeSynced([...save.filter((t) => !skipIds.has(t.id)), ...serverTabs]);
      if (locked.length) {
        // Flushes run serially, so this flush's copy is the newest one.
        for (const t of locked) lockedOut.set(t.id, t);
        if (timer === null) timer = setTimeout(fire, RETRY_MS);
      }
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
  if (pending || lockedOut.size) doFlush(false);
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
      if (saved === "locked") {
        // Vault locked mid-choice: hold it like any other locked-out save.
        lockedOut.set(tab.id, tab);
        if (timer === null) timer = setTimeout(fire, RETRY_MS);
      } else if (saved && typeof saved === "object" && !("conflict" in saved)) {
        // Adopt the server's saved tab (fresh rev) — the client copy's rev
        // is stale the moment the server accepts the write.
        mergeSynced([tab, saved]);
        lockedOut.delete(tab.id);
        conflictHeld.delete(tab.id);
        if (conflicts.delete(tab.id)) notifyConflicts();
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
  if (pending || lockedOut.size) doFlush(!!opts.keepalive);
  await chain.catch(() => {});
}

/** Test hook: reset module state between tests. */
export function __resetScratchpadSaveQueueForTests(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending = null;
  chain = Promise.resolve();
  lastSynced = [];
  lockedOut.clear();
  conflictHeld.clear();
  conflicts.clear();
  conflictListeners.clear();
  conflictHandler = null;
  saveFailing = false;
  failureHandler = null;
}
