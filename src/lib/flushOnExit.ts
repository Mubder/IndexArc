// Renderer side of the quit handshake (electron-main.cjs "before-quit"):
// the freshest note content lives in the EDITOR and in debounce timers that
// die with the renderer. Before the app is allowed to exit, push everything
// into the save queue and drain it to the embedded server (which writes each
// POST straight to disk). Also fires best-effort on pagehide for paths where
// nobody asks first (reload, some teardowns).
import { drainScratchpadSaves, enqueueScratchpadSave } from "../scratchpadSaveQueue";
import type { ScratchTab } from "../types";

type FlushHook = () => void;
const hooks = new Set<FlushHook>();

/** Register a hook that synchronously enqueues the freshest content.
 *  Returns an unregister function for React effects. */
export function registerFlushHook(fn: FlushHook): () => void {
  hooks.add(fn);
  return () => {
    hooks.delete(fn);
  };
}

/** Run every flush hook, then drain the save queue. Bounded by the queue's
 *  own failure handling — a dead server never blocks exit forever.
 *  keepalive lets the final POSTs outlive the renderer process. */
export async function flushEverything(): Promise<void> {
  for (const h of Array.from(hooks)) {
    try {
      h();
    } catch {}
  }
  try {
    await drainScratchpadSaves({ keepalive: true });
  } catch {}
}

/** Convenience for hooks: enqueue a tab snapshot with the latest content. */
export function enqueueTabsSnapshot(tabs: ScratchTab[]): void {
  enqueueScratchpadSave(tabs);
}

let wired = false;

/** Wire the quit handshake + pagehide best-effort flush. Call once at startup. */
export function wireFlushOnExit(): void {
  if (wired || typeof window === "undefined") return;
  wired = true;
  const ea = (window as any).electronAPI;
  if (typeof ea?.onFlushRequest === "function") {
    ea.onFlushRequest(async () => {
      await flushEverything();
      try {
        ea.flushComplete?.();
      } catch {}
    });
  }
  // Reload/navigation and unannounced teardowns: fire the same flush without
  // waiting (fetch keepalive gives the requests a chance to land).
  window.addEventListener("pagehide", () => {
    void flushEverything();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushEverything();
  });
}
