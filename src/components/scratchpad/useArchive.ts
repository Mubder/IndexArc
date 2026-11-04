import { useState, useCallback } from "react";
import { ScratchTab } from "../../types";
import { normalizeServerTab } from "../../lib/serverTabs";
import { uid } from "./noteTabs";
import { setSyncedScratchpadTabs } from "../../scratchpadSaveQueue";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";

export interface UseArchiveArgs {
  activeId: string;
  setActiveId: Dispatch<SetStateAction<string>>;
  setStatus: (msg: string) => void;
  setTabs: Dispatch<SetStateAction<ScratchTab[]>>;
  t: (key: keyof TranslationDict) => string;
  tabs: ScratchTab[];
}

// Archived notes: the cold-storage list, its count, and archive/restore/delete.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useArchive({ activeId, setActiveId, setStatus, setTabs, t, tabs }: UseArchiveArgs) {
  const [showArchived, setShowArchived] = useState(false);
  const [archivedCount, setArchivedCount] = useState<number>(0);
  const [archivedTabs, setArchivedTabs] = useState<ScratchTab[] | null>(null);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [previewArchivedTab, setPreviewArchivedTab] = useState<ScratchTab | null>(null);

  // Toggle archive section with lazy on-demand fetch
  const toggleShowArchived = useCallback(() => {
    setShowArchived((prev) => {
      const next = !prev;
      if (next && archivedTabs === null) {
        setLoadingArchived(true);
        fetch("/api/scratchpad/archive")
          .then((r) => r.json())
          .then((d) => {
            if (Array.isArray(d.tabs)) {
              setArchivedTabs(d.tabs);
              setArchivedCount(d.tabs.length);
            }
          })
          .catch(() => {})
          .finally(() => setLoadingArchived(false));
      }
      return next;
    });
  }, [archivedTabs]);

  // Archive soft-hides a tab into cold storage
  const archiveTab = async (id: string) => {
    const target = tabs.find((x) => x.id === id);
    if (!window.confirm(fill(t("confirm_archive_note"), { title: target?.title || "Scratch" }))) return;

    // SERVER FIRST: the server decides (it refuses protected notes). Local
    // state only changes after a confirmed success — an optimistic removal
    // followed by a refusal made the note "disappear then reappear".
    let data: any = null;
    try {
      const res = await fetch("/api/scratchpad/archive-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: id, tab: target }),
      });
      data = await res.json().catch(() => null);
      if (!res.ok || !data || data.success === false) {
        setStatus(t("scratchpad_archive_protected" as any) || "This note is protected — unprotect it before archiving.");
        return;
      }
    } catch {
      setStatus(t("scratchpad_archive_failed" as any) || "Archive failed — nothing was changed.");
      return;
    }

    // Server confirmed: adopt its authoritative active-tab list.
    const activeTabs: ScratchTab[] = Array.isArray(data.activeTabs)
      ? data.activeTabs.map((x: any) => normalizeServerTab(x))
      : tabs.filter((x) => x.id !== id);
    if (activeTabs.length === 0) {
      const fresh = { id: uid(), title: "Scratch 1", content: "", archived: false };
      setTabs([fresh]);
      setActiveId(fresh.id);
    } else {
      setTabs(activeTabs);
      if (id === activeId || !activeTabs.some((x) => x.id === activeId)) setActiveId(activeTabs[0].id);
    }
    setSyncedScratchpadTabs(activeTabs);
    setArchivedCount(typeof data.archivedCount === "number" ? data.archivedCount : (c) => c + 1);
    if (archivedTabs !== null && target) {
      setArchivedTabs((prev) => [{ ...target, archived: true, archivedAt: Date.now() }, ...(prev || [])]);
    }
  };

  const restoreTab = async (id: string) => {
    let target = archivedTabs?.find((x) => x.id === id);
    if (archivedTabs !== null) {
      setArchivedTabs((prev) => (prev ? prev.filter((x) => x.id !== id) : null));
    }
    setArchivedCount((c) => Math.max(0, c - 1));

    try {
      const res = await fetch("/api/scratchpad/restore-tab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: id }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.restoredTab) {
          target = data.restoredTab;
        }
      }
    } catch {}

    if (target) {
      const restored = { ...target, archived: false };
      setTabs((prev) => [...prev, restored]);
      setActiveId(target.id);
    }
    if (previewArchivedTab?.id === id) {
      setPreviewArchivedTab(null);
    }
  };

  const deleteArchivedTab = async (id: string, title?: string) => {
    if (!window.confirm(fill(t("confirm_delete_archived_note"), { title: title || t("untitled") }))) return;
    if (archivedTabs !== null) {
      setArchivedTabs((prev) => (prev ? prev.filter((x) => x.id !== id) : null));
    }
    setArchivedCount((c) => Math.max(0, c - 1));
    if (previewArchivedTab?.id === id) {
      setPreviewArchivedTab(null);
    }

    try {
      await fetch("/api/scratchpad/delete-archived", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tabId: id }),
      });
    } catch {}
  };

  return { archiveTab, archivedCount, archivedTabs, deleteArchivedTab, loadingArchived, previewArchivedTab, restoreTab, setArchivedCount, setPreviewArchivedTab, showArchived, toggleShowArchived };
}
