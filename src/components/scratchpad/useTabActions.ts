import { useState, useCallback } from "react";
import { setSyncedScratchpadTabs, mergeSyncedScratchpadTab, forgetScratchpadTab } from "../../scratchpadSaveQueue";
import { ScratchTab } from "../../types";
import { uid } from "./noteTabs";
import type { Dispatch, SetStateAction, RefObject } from "react";
import type { Detection } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";

export interface UseTabActionsArgs {
  activeId: string;
  setActiveId: Dispatch<SetStateAction<string>>;
  setDetections: Dispatch<SetStateAction<Record<string, Detection>>>;
  setRephraseUndo: Dispatch<SetStateAction<Record<string, string[]>>>;
  setStatus: (msg: string) => void;
  setTabs: Dispatch<SetStateAction<ScratchTab[]>>;
  t: (key: keyof TranslationDict) => string;
  tabs: ScratchTab[];
  titleTouched: RefObject<Record<string, boolean>>;
}

// Note tab lifecycle: add, close, rename, and drag reorder.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useTabActions({ activeId, setActiveId, setDetections, setRephraseUndo, setStatus, setTabs, t, tabs, titleTouched }: UseTabActionsArgs) {
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const reorderTab = useCallback((fromId: string, toId: string) => {
    if (fromId === toId) return;
    setTabs((prev) => {
      const from = prev.findIndex((x) => x.id === fromId);
      const to = prev.findIndex((x) => x.id === toId);
      if (from === -1 || to === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      // Persist the order explicitly (ids only) and resync the save queue's mirror.
      fetch("/api/scratchpad/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: next.filter((x) => !x.archived).map((x) => x.id) }),
      })
        .then(() => setSyncedScratchpadTabs(next))
        .catch(() => {});
      return next;
    });
  }, []);

  const nextTitle = useCallback((prev: ScratchTab[]) => {
    let n = prev.length + 1;
    const used = new Set(prev.map((x) => x.title));
    while (used.has(`Scratch ${n}`)) n++;
    return `Scratch ${n}`;
  }, []);

  /** New note; `app` links it to an application (the Scratchpad filter's). */
  const addTab = (app?: string) => {
    const id = uid();
    setTabs((prev) => [...prev, { id, title: nextTitle(prev), content: "", ...(app ? { app } : {}) }]);
    setActiveId(id);
  };

  const closeTab = async (id: string, skipConfirm: boolean = false) => {
    const target = tabs.find((x) => x.id === id);
    if (!skipConfirm && !window.confirm(fill(t("confirm_delete_note"), { title: target?.title || "Scratch" }))) return;

    // SERVER FIRST: only remove the note locally once the server confirms the
    // delete. A protected note (423) stays exactly where it is.
    try {
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (res.status === 423) {
        setStatus(t("scratchpad_close_protected" as any) || "This note is protected — unprotect it before deleting.");
        return;
      }
      if (!res.ok && res.status !== 404) {
        setStatus(t("scratchpad_close_failed" as any) || "Delete failed — nothing was changed.");
        return;
      }
    } catch {
      setStatus(t("scratchpad_close_failed" as any) || "Delete failed — nothing was changed.");
      return;
    }

    forgetScratchpadTab(id);
    // Server confirmed the deletion. Replace an emptied notebook with a fresh
    // note (the old one is already gone server-side, so no resurrection).
    const remainingTabs = tabs.filter((x) => x.id !== id);
    if (remainingTabs.length === 0) {
      const fresh = { id: uid(), title: "Scratch 1", content: "" };
      setTabs([fresh]);
      setActiveId(fresh.id);
      setSyncedScratchpadTabs([]);
      setDetections({});
      setRephraseUndo({});
      titleTouched.current = {};
      return;
    }
    setTabs((prev) => {
      const next = prev.filter((x) => x.id !== id);
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
    setSyncedScratchpadTabs(remainingTabs);
    delete titleTouched.current[id];
    setDetections((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
    setRephraseUndo((u) => {
      const n = { ...u };
      delete n[id];
      return n;
    });
  };

  const commitRename = (id: string) => {
    const name = renameValue.trim();
    if (name) {
      titleTouched.current[id] = true;
      // title_custom travels with the note (and its first content save, if the
      // rename beat it to the server), so a remount can't auto-title it again.
      setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, title: name, title_custom: true } : x)));
      fetch(`/api/scratchpad/tabs/${encodeURIComponent(id)}/meta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: name }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          // The rename bumped the server-side rev — adopt it so the next
          // content save doesn't 409 against our own rename.
          if (data?.tab) mergeSyncedScratchpadTab(data.tab as ScratchTab);
        })
        .catch(() => {});
    }
    setRenameId(null);
    setRenameValue("");
  };

  const startRename = (id: string) => {
    const cur = tabs.find((x) => x.id === id);
    setRenameId(id);
    setRenameValue(cur?.title || "");
  };

  // Stable callback ref: runs ONCE when the rename input mounts (an inline
  // ref re-runs every render, and re-selecting the text after each keystroke
  // makes the next letter replace the whole field). useCallback keeps the
  // identity stable so React treats it as attached.
  const renameInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) {
      el.focus();
      try { el.select(); } catch {}
    }
  }, []);

  return { addTab, closeTab, commitRename, renameId, renameInputRef, renameValue, reorderTab, setRenameId, setRenameValue, startRename };
}
