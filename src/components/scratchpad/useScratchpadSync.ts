import { useEffect } from "react";
import { drainScratchpadSaves, setSyncedScratchpadTabs, enqueueScratchpadSave, setScratchpadConflictHandler, setScratchpadFailureHandler } from "../../scratchpadSaveQueue";
import { ScratchTab } from "../../types";
import { normalizeServerTab } from "../../lib/serverTabs";
import { dropLegacyLocalTabs } from "./noteTabs";
import { clearFocusNote, peekFocusNote } from "../../noteHandoff";
import type { Dispatch, SetStateAction, RefObject } from "react";

export interface UseScratchpadSyncArgs {
  initial: RefObject<ScratchTab[]>;
  serverLoaded: RefObject<boolean>;
  setActiveId: Dispatch<SetStateAction<string>>;
  setArchivedCount: Dispatch<SetStateAction<number>>;
  setConflictTab: Dispatch<any>;
  setSaveFailing: Dispatch<SetStateAction<boolean>>;
  setTabs: Dispatch<SetStateAction<ScratchTab[]>>;
  tabs: ScratchTab[];
}

// Server load on mount, queued saves on change, and the save conflict/failure handlers.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useScratchpadSync({ initial, serverLoaded, setActiveId, setArchivedCount, setConflictTab, setSaveFailing, setTabs, tabs }: UseScratchpadSyncArgs) {
  // Load tabs from the server (portable, survives reinstall/update). The
  // server copy is authoritative when it has content; localStorage is a cache.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Land any save queued by a previous mount FIRST, so the server copy
        // we load is never older than what the user actually typed.
        await drainScratchpadSaves();
        // Retry through the pre-unlock window: the very first fetch can land
        // while the vault is still locked (server up, password not yet
        // entered) and used to give up for the whole session — the editor
        // then ran on stale tabs with no visible error.
        let res: Response | null = null;
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            res = await fetch("/api/scratchpad");
          } catch {
            res = null;
          }
          if (cancelled) return;
          if (res && res.ok) break;
          res = null;
          await new Promise((r) => setTimeout(r, 3000));
          if (cancelled) return;
        }
        if (!res || !res.ok) return;
        const data = await res.json();
        // normalizeServerTab PRESERVES rev + pinned/protected flags — stripping
        // them here made protection invisible after every restart.
        const serverTabs: ScratchTab[] = Array.isArray(data.tabs)
          ? data.tabs
              .filter((x: any) => x && typeof x === "object" && !x.archived)
              .map((x: any) => normalizeServerTab(x))
          : [];
        if (cancelled) return;
        // Prime the save queue's mirror so it knows each tab's server rev.
        setSyncedScratchpadTabs(serverTabs);
        if (serverTabs.length) {
          // Server has the durable copy — it wins over the localStorage cache.
          setTabs(serverTabs);
          // "Open in Scratchpad" from the Applications page picks the note.
          const focus = peekFocusNote();
          clearFocusNote();
          setActiveId(focus && serverTabs.some((x) => x.id === focus) ? focus : serverTabs[0].id);
          dropLegacyLocalTabs();
        } else {
          // First run on this vault: migrate existing localStorage tabs up so
          // they become durable and survive future reinstalls.
          const local = initial.current.filter((x) => !x.archived);
          const hasContent = local.some((x) => x.content.trim() || x.title !== "Scratch 1");
          if (hasContent) {
            fetch("/api/scratchpad", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ tabs: local }),
            })
              .then((r) => {
                if (r.ok) dropLegacyLocalTabs();
              })
              .catch(() => {});
          } else {
            dropLegacyLocalTabs();
          }
        }
      } catch {
        /* offline / locked — keep localStorage tabs */
      } finally {
        if (!cancelled) serverLoaded.current = true;
      }
    })();

    // Fetch archive count from cold storage
    fetch("/api/scratchpad/archive/count")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && typeof d.count === "number") setArchivedCount(d.count);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // Persist to the server (the ONLY durable store) on change. localStorage is
  // no longer written — notes must not live in browser storage (plaintext
  // secrets at rest). loadTabs() above stays as a one-way migration source.
  useEffect(() => {
    if (!serverLoaded.current) return;
    // The queue lives outside React: it survives unmount/tab-switch, so the
    // last keystrokes always reach the server (the old in-effect debounce was
    // cancelled by cleanup and dropped them).
    enqueueScratchpadSave(tabs);
  }, [tabs]);

  // Surface save conflicts from the queue (server 409) as a user choice.
  useEffect(() => {
    setScratchpadConflictHandler((serverTab) => setConflictTab(serverTab));
    return () => setScratchpadConflictHandler(null);
  }, []);

  // Save-health banner: the queue reports when saves stop landing. Without
  // this the editor happily takes typing that exists only in window memory
  // and dies with the process (the "lost a day of notes" failure mode).
  useEffect(() => {
    setScratchpadFailureHandler((failing) => setSaveFailing(failing));
    return () => setScratchpadFailureHandler(null);
  }, []);
}
