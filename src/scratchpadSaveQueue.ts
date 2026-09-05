import type { ScratchTab } from "./types";

// Module-level scratchpad save queue.
//
// Lives OUTSIDE React on purpose: ScratchpadTab unmounts on every tab switch,
// and the old component-scoped debounce cancelled its pending fetch in the
// effect cleanup — losing the last ~1.2s of edits. This queue survives
// unmount, always keeps only the latest snapshot (last-writer-wins), and
// flushes after a short quiet period. Failed posts are re-queued and retried.

const DEBOUNCE_MS = 800;
const RETRY_MS = 5000;

let pending: ScratchTab[] | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// Serialize posts so an in-flight save and a queued save can't land out of order.
let chain: Promise<void> = Promise.resolve();

function post(tabs: ScratchTab[]): Promise<void> {
  return fetch("/api/scratchpad", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tabs }),
  }).then((res) => {
    if (!res.ok) throw new Error(`scratchpad save failed: ${res.status}`);
  });
}

function doFlush(): void {
  const payload = pending;
  pending = null;
  chain = chain
    .then(() => post(payload as ScratchTab[]))
    .catch(() => {
      pending = payload; // try again later
      if (timer === null) timer = setTimeout(fire, RETRY_MS);
    });
}

function fire(): void {
  timer = null;
  if (pending) doFlush();
}

/** Record the latest tab state; a flush happens after the quiet period. */
export function enqueueScratchpadSave(tabs: ScratchTab[]): void {
  pending = tabs;
  if (timer === null) timer = setTimeout(fire, DEBOUNCE_MS);
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
}
