import { useState, useCallback, useMemo } from "react";
import { type NoteRevision, getNoteRevisions } from "./revisions";
import { noteToLines, buildCompareRows, compareStats } from "../../lib/noteDiff";
import { detectBaseDir } from "./domText";
import { ScratchTab } from "../../types";
import { normalizeServerTab } from "../../lib/serverTabs";
import { setSyncedScratchpadTabs } from "../../scratchpadSaveQueue";
import type { Dispatch, SetStateAction, RefObject } from "react";
import type { TranslationDict } from "../../utils/i18n";

export interface UseNoteHistoryArgs {
  activeId: string;
  contentRef: RefObject<Record<string, string>>;
  editorHtmlRef: RefObject<Record<string, string>>;
  setActiveId: Dispatch<SetStateAction<string>>;
  setStatusMsg: Dispatch<SetStateAction<string>>;
  setTabs: Dispatch<SetStateAction<ScratchTab[]>>;
  t: (key: keyof TranslationDict) => string;
  tabs: ScratchTab[];
}

// Revision history, the compare-two-notes view, and rescue of orphaned snapshots.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useNoteHistory({ activeId, contentRef, editorHtmlRef, setActiveId, setStatusMsg, setTabs, t, tabs }: UseNoteHistoryArgs) {
  const [showRevisions, setShowRevisions] = useState(false);
  const [revisionsList, setRevisionsList] = useState<NoteRevision[]>([]);
  const [selectedRevision, setSelectedRevision] = useState<NoteRevision | null>(null);
  // Compare-two-notes view: which tabs sit on the left/right of the diff.
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  // Rescue view: orphaned revision snapshots (notes whose saves never landed).
  const [rescueOpen, setRescueOpen] = useState(false);
  const [rescueList, setRescueList] = useState<any[]>([]);
  const [rescueLoading, setRescueLoading] = useState(false);
  const [rescueQuery, setRescueQuery] = useState("");

  const handleOpenRevisions = useCallback(async () => {
    const list = await getNoteRevisions(activeId);
    setRevisionsList(list);
    setSelectedRevision(list.length > 0 ? list[0] : null);
    setShowRevisions(true);
  }, [activeId]);

  const openCompare = useCallback(() => {
    // Left defaults to the active note, right to the first other tab.
    const other = tabs.find((x) => x.id !== activeId);
    if (!other) return;
    setCompareA(activeId);
    setCompareB(other.id);
    setCompareOpen(true);
  }, [tabs, activeId]);

  // Diff of the two selected notes. Reads through contentRef so unsaved
  // keystrokes on the left note are included. Pure-local LCS — nothing leaves
  // the machine. eslint-disable for the ref reads is deliberate.
  const compareData = useMemo(() => {
    if (!compareOpen) return null;
    const tabA = tabs.find((x) => x.id === compareA);
    const tabB = tabs.find((x) => x.id === compareB);
    if (!tabA || !tabB || tabA.id === tabB.id) return null;
    const linesA = noteToLines(contentRef.current[tabA.id] ?? tabA.content ?? "");
    const linesB = noteToLines(contentRef.current[tabB.id] ?? tabB.content ?? "");
    const rows = buildCompareRows(linesA, linesB);
    return {
      rows,
      stats: compareStats(rows),
      dirA: detectBaseDir(linesA.join("\n")) as "ltr" | "rtl",
      dirB: detectBaseDir(linesB.join("\n")) as "ltr" | "rtl",
      titleA: tabA.title,
      titleB: tabB.title,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareOpen, compareA, compareB, tabs]);

  // ── Rescue: orphaned revision snapshots ──
  const openRescue = useCallback(async () => {
    setRescueOpen(true);
    setRescueLoading(true);
    setRescueQuery("");
    try {
      const res = await fetch("/api/scratchpad/revisions/orphaned");
      if (res.ok) {
        const data = await res.json();
        setRescueList(Array.isArray(data.orphans) ? data.orphans : []);
      } else {
        setRescueList([]);
      }
    } catch {
      setRescueList([]);
    } finally {
      setRescueLoading(false);
    }
  }, []);

  const restoreOrphan = useCallback(async (tabId: string, content: string) => {
    try {
      // POST /tabs/:id/content upserts unknown ids — saving the latest
      // snapshot back under its original id revives the note (and keeps its
      // revision history attached).
      const res = await fetch(`/api/scratchpad/tabs/${encodeURIComponent(tabId)}/content`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) return;
      const refresh = await fetch("/api/scratchpad");
      if (refresh.ok) {
        const data = await refresh.json();
        const serverTabs: ScratchTab[] = Array.isArray(data.tabs)
          ? data.tabs.filter((x: any) => x && !x.archived).map((x: any) => normalizeServerTab(x))
          : [];
        setSyncedScratchpadTabs(serverTabs);
        setTabs(serverTabs);
        delete contentRef.current[tabId];
        delete editorHtmlRef.current[tabId];
        setActiveId(tabId);
      }
      setRescueList((prev) => prev.filter((x) => x.tabId !== tabId));
      const msg = t("scratchpad_rescue_restored");
      setStatusMsg(msg);
      if (msg) setTimeout(() => setStatusMsg(""), 3200);
    } catch {}
  }, [t]);

  return { compareA, compareB, compareData, compareOpen, handleOpenRevisions, openCompare, openRescue, rescueList, rescueLoading, rescueOpen, rescueQuery, restoreOrphan, revisionsList, selectedRevision, setCompareA, setCompareB, setCompareOpen, setRescueOpen, setRescueQuery, setSelectedRevision, setShowRevisions, showRevisions };
}
