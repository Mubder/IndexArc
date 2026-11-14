import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { Settings, RewriteStyle, Detection, Busy, ScratchTab, NoteBidiMode, type AnalyzeCandidate } from "../types";
import { getTranslation } from "../utils/i18n";
import { fill } from "./home/DashboardCards";
import { drainScratchpadSaves, forceSaveScratchpadTab, mergeSyncedScratchpadTab } from "../scratchpadSaveQueue";
import { takeHandoffNote, REOPEN_NOTE_EVENT, FOCUS_NOTE_EVENT, peekFocusNote, clearFocusNote, takeFocusApp } from "../noteHandoff";
import { ensureHtmlParagraphs, htmlToPlainText } from "../lib/noteHtml";

import { type NoteRevision, getNoteRevisions, saveNoteRevision } from "./scratchpad/revisions";
import { smartFormatParagraphs, uid, loadTabs } from "./scratchpad/noteTabs";
import { detectBaseDir, safeGetHTML } from "./scratchpad/domText";
import { NoteTabStrip } from "./scratchpad/NoteTabStrip";
import { EditorPanel } from "./scratchpad/EditorPanel";
import { FormattingToolbar } from "./scratchpad/FormattingToolbar";
import { ArchiveSection } from "./scratchpad/ArchiveSection";
import { ArchivedNotePreview } from "./scratchpad/ArchivedNotePreview";
import { RevisionHistoryModal } from "./scratchpad/RevisionHistoryModal";
import { ProtectModal } from "./scratchpad/ProtectModal";
import { RescueModal } from "./scratchpad/RescueModal";
import { CompareModal } from "./scratchpad/CompareModal";
import { useArchive } from "./scratchpad/useArchive";
import { useNoteProtection } from "./scratchpad/useNoteProtection";
import { usePredictions } from "./scratchpad/usePredictions";
import { useNoteHistory } from "./scratchpad/useNoteHistory";
import { useTabActions } from "./scratchpad/useTabActions";
import { useScratchEditor } from "./scratchpad/useScratchEditor";
import { useEditorCommands } from "./scratchpad/useEditorCommands";
import { useSpellcheck } from "./scratchpad/useSpellcheck";
import { useScratchpadSync } from "./scratchpad/useScratchpadSync";
import { useNoteActions } from "./scratchpad/useNoteActions";
import { useScrollAffordances } from "./scratchpad/useScrollAffordances";
import { SaveToAppDialog, type CommandItem } from "./apps/SaveToAppDialog";
import { NoteAppPicker, NoteFilter, SHOW_ALL, SHOW_NONE, filterTabs, useAppNames } from "./scratchpad/NoteAppBar";
import { setNoteApp } from "./apps/appsApi";
import type { UpsertItem } from "./apps/appsApi";
import { keyNameFromFragment } from "../../shared/apps";

// Re-exported: these used to live here.
export { type NoteRevision, getNoteRevisions, saveNoteRevision, smartFormatParagraphs };

let lastShow: string = SHOW_ALL;

export const ScratchpadTab: React.FC<{ settings: Settings | null }> = ({ settings }) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const initial = useRef(loadTabs());
  const [tabs, setTabs] = useState<ScratchTab[]>(initial.current);
  // Live mirrors for the exit-flush hook (registered once, must never go
  // stale): the tab list and the TipTap instance.
  const tabsRef = useRef<ScratchTab[]>(tabs);
  tabsRef.current = tabs;
  const [activeId, setActiveId] = useState<string>(
    initial.current && initial.current.length > 0 ? initial.current[0].id : "default"
  );
  const [detections, setDetections] = useState<Record<string, Detection>>({});
  const [busy, setBusy] = useState<Record<string, Busy>>({});
  const [statusMsg, setStatusMsg] = useState("");
  const setStatus = useCallback((msg: string) => {
    setStatusMsg(msg);
    if (msg) setTimeout(() => setStatusMsg(""), 3200);
  }, []);
  const [copied, setCopied] = useState(false);
  const [style, setStyle] = useState<RewriteStyle>("professional");
  const { archiveTab, archivedCount, archivedTabs, deleteArchivedTab, loadingArchived, previewArchivedTab, restoreTab, setArchivedCount, setPreviewArchivedTab, showArchived, toggleShowArchived } = useArchive({ activeId, setActiveId, setStatus, setTabs, t, tabs });
  const [bidiMode, setBidiMode] = useState<NoteBidiMode>("auto");
  const [slashOpen, setSlashOpen] = useState(false);
  const [highlightColor, setHighlightColor] = useState<string>("#fef08a");
  const [textColor, setTextColor] = useState<string>("#ffffff");
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showTextColorPicker, setShowTextColorPicker] = useState(false);
  const [pastePlain, setPastePlain] = useState(true);
  // Read inside ProseMirror's handlePaste (bound once at editor creation).
  const pastePlainRef = useRef(true);
  pastePlainRef.current = pastePlain;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [rephraseUndo, setRephraseUndo] = useState<Record<string, string[]>>({});
  // True while the save queue cannot reach the server — drives the
  // "changes exist only in this window" banner.
  const [saveFailing, setSaveFailing] = useState(false);
  const [clearedAlert, setClearedAlert] = useState<{ tabId: string; content: string; timestamp: number } | null>(null);
  // 409 conflict banner state: the server's current version of the tab whose
  // save conflicted, offered to the user when an autosave raced another window.
  const [conflictTab, setConflictTab] = useState<any>(null);
  const { protectConfirmInput, protectError, protectInputRef, protectModal, protectShowInput, protectedIdsRef, setProtectConfirmInput, setProtectError, setProtectModal, setProtectShowInput, submitProtect, togglePin } = useNoteProtection({ activeId, setTabs, tabs, t });

  const shellRef = useRef<HTMLDivElement>(null);
  const scratchRootRef = useRef<HTMLDivElement>(null);
  const titleTouched = useRef<Record<string, boolean>>({});
  const serverLoaded = useRef(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<Record<string, string>>({});
  // Last html the EDITOR itself held for each tab (written by onUpdate and by
  // every explicit setContent). The tabs-sync effect compares against this to
  // decide whether incoming state content is an EXTERNAL write that must be
  // applied, or the editor's own output echoed back — re-applying the editor's
  // own html replaces the whole doc and yanks the caret to the end.
  const editorHtmlRef = useRef<Record<string, string>>({});
  const activeIdRef = useRef<string>(activeId);
  activeIdRef.current = activeId;
  const editorRef = useRef<HTMLDivElement>(null);
  const lastActiveTabId = useRef<string>("");
  const lastNonEmptyContentRef = useRef<Record<string, string>>({});
  const lastSnapshotTimeRef = useRef<Record<string, number>>({});
  const updateScrollAffordancesRef = useRef<() => void>(() => {});
  const recomputeSpellRectsRef = useRef<() => void>(() => {});
  const { enablePredictions, ghostCompletion, setCaretPos, setGhostCompletion, togglePredictions, triggerAutocomplete } = usePredictions({ activeIdRef, editorRef, protectedIdsRef });

  const recordSnapshot = useCallback(
    async (tabId: string, content: string, reason?: string) => {
      if (!content || content === "<p></p>") return;
      const plain = content.replace(/<[^>]+>/g, "").trim();
      if (!plain) return;
      const curTab = tabs.find((x) => x.id === tabId);
      const title = curTab?.title || "Note";
      const charCount = plain.length;
      const wordCount = plain.split(/\s+/).filter(Boolean).length;
      await saveNoteRevision({
        id: uid(),
        tabId,
        timestamp: Date.now(),
        title,
        content,
        charCount,
        wordCount,
        reason,
      });
    },
    [tabs]
  );
  const { compareA, compareB, compareData, compareOpen, handleOpenRevisions, openCompare, openRescue, rescueList, rescueLoading, rescueOpen, rescueQuery, restoreOrphan, revisionsList, selectedRevision, setCompareA, setCompareB, setCompareOpen, setRescueOpen, setRescueQuery, setSelectedRevision, setShowRevisions, showRevisions } = useNoteHistory({ activeId, contentRef, editorHtmlRef, setActiveId, setStatusMsg, setTabs, t, tabs });

  // Listen for "Reopen in Scratchpad" event from Library or Command Palette
  useEffect(() => {
    const handleReopenEvent = () => {
      const note = takeHandoffNote();
      if (!note || !note.title || !note.html) return;
      const newId = `note-${Date.now()}`;
      const newTab = { id: newId, title: note.title, content: ensureHtmlParagraphs(note.html), archived: false };
      setTabs((prev) => [...prev, newTab]);
      setActiveId(newId);
    };
    window.addEventListener(REOPEN_NOTE_EVENT, handleReopenEvent);
    handleReopenEvent();
    return () => window.removeEventListener(REOPEN_NOTE_EVENT, handleReopenEvent);
  }, []);
  // "Open in Scratchpad" while the Scratchpad is already showing.
  useEffect(() => {
    const onFocus = () => {
      const id = peekFocusNote();
      if (id && tabsRef.current.some((x) => x.id === id)) {
        clearFocusNote();
        setActiveId(id);
      }
    };
    window.addEventListener(FOCUS_NOTE_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_NOTE_EVENT, onFocus);
  }, []);
  const { tiptap } = useScratchEditor({ activeId, activeIdRef, bidiMode, contentRef, editorHtmlRef, editorRef, lastActiveTabId, lastNonEmptyContentRef, lastSnapshotTimeRef, pastePlainRef, recordSnapshot, setClearedAlert, setSlashOpen, setTabs, settings, tabs, tabsRef, titleTouched, serverLoaded });

  // One size for dual-language notes: larger of EN/AR settings so neither
  // script is cramped, without per-script scaling that desyncs the overlay.
  const noteFontSize = Math.max(settings?.font_size_en || 14, settings?.font_size_ar || 16);
  const { execFormat, historyRedo, historyUndo, setEditorHtml } = useEditorCommands({ activeIdRef, contentRef, editorHtmlRef, editorRef, setShowHighlightPicker, setShowTextColorPicker, setTabs, tiptap, toolbarRef });

  const fallbackTab: ScratchTab = { id: activeId || "default", title: "Scratch", content: "" };
  const active = tabs.find((x) => x.id === activeId) || tabs[0] || fallbackTab;
  const activeIsProtected = protectedIdsRef.current.has(activeId);
  const activeIsPinned = !!(active as any)?.pinned;
  const b = busy[activeId] || {};
  const detection = detections[activeId];
  const hasSecret =
    !!detection &&
    (detection.families.includes("secret") || detection.families.includes("unknown"));

  // Fix sticky selection: ensure ProseMirror is selectable and scroll syncs overlays
  useEffect(() => {
    if (!tiptap || tiptap.isDestroyed || !tiptap.view?.dom) return;
    const dom = tiptap.view.dom as HTMLElement;
    dom.style.userSelect = "text";
    (dom.style as any).webkitUserSelect = "text";
    dom.style.cursor = "text";
    const onScroll = () => {
      // These are declared later in the component; call through refs to avoid
      // stale closures without creating a TDZ crash in the deps array.
      (onScroll as any)._up?.();
      // The spell-rect walk segments every text node and measures a Range per
      // misspelling — expensive on large link-heavy notes (URL tokens read as
      // misspelled words). Trailing-throttle instead of per-scroll-frame.
      if ((onScroll as any)._t) return;
      (onScroll as any)._t = window.setTimeout(() => {
        (onScroll as any)._t = null;
        (onScroll as any)._rec?.();
      }, 120);
    };
    (onScroll as any)._up = updateScrollAffordancesRef.current;
    (onScroll as any)._rec = recomputeSpellRectsRef.current;
    dom.addEventListener("scroll", onScroll);
    return () => {
      if ((onScroll as any)._t) window.clearTimeout((onScroll as any)._t);
      dom.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiptap]);

  // Seed the editor content imperatively on every tab switch (the TipTap
  // setContent in the tabs-sync effect above). After this, React NEVER
  // re-applies content while editing — the editor is uncontrolled, which
  // is what keeps the selection and undo stack intact.
  // Protected notes are read-only at the editor level (server still enforces).
  useEffect(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    try {
      // setEditable() re-emits "update" even when the flag didn't change
      // (TipTap v3), so calling it on every tabs change fed an infinite
      // setEditable → onUpdate → setTabs → setEditable render loop that
      // pegged the CPU on large notes. Only touch it on an actual change.
      const want = !protectedIdsRef.current.has(activeId);
      if (tiptap.isEditable !== want) tiptap.setEditable(want, false);
    } catch {}
  }, [tiptap, activeId, tabs]);
  const { contextMenu, handleAddToDictionary, handleApplySuggestion, handleIgnoreWord, misspelledWords, onContextMenu, recomputeSpellRects, setContextMenu, spellRects } = useSpellcheck({ active, editorRef, recomputeSpellRectsRef, setStatus, settings, tiptap, triggerAutocomplete });
  useScratchpadSync({ initial, serverLoaded, setActiveId, setArchivedCount, setConflictTab, setSaveFailing, setTabs, tabs });

  const resolveConflict = useCallback((keepMine: boolean) => {
    if (!conflictTab) return;
    if (keepMine) {
      const mine = tabs.find((x) => x.id === conflictTab.id);
      if (mine) forceSaveScratchpadTab(mine);
    } else {
      // Adopt the server version.
      setTabs((prev) => prev.map((x) => (x.id === conflictTab.id ? { ...x, content: conflictTab.content, rev: conflictTab.rev } : x)));
      mergeSyncedScratchpadTab(conflictTab);
      if (activeId === conflictTab.id) setContent(conflictTab.id, conflictTab.content);
    }
    setConflictTab(null);
  }, [conflictTab, tabs, activeId]);

  // setContent is used by external flows (rephrase, undo-rephrase) to replace
  // the whole editor body. Route through setEditorHtml so the DOM, history
  // stack and state all update together.
  const setContent = useCallback(
    (id: string, content: string) => {
      if (id === activeIdRef.current) {
        setEditorHtml(content);
      } else {
        setTabs((prev) => prev.map((x) => (x.id === id ? { ...x, content } : x)));
        contentRef.current[id] = content;
      }
    },
    [setEditorHtml]
  );
  const { analyze, handleCopy, handleProofread, handleRephrase, handleSaveNote, handleSaveSecret, handleUndoRephrase } = useNoteActions({ active, activeId, detection, protectedIdsRef, recordSnapshot, rephraseUndo, setBusy, setContent, setCopied, setDetections, setRephraseUndo, setStatus, style, t });

  // "Save secret to Vault" asks which application and environment the
  // detected secrets belong to (SaveToAppDialog); "No application" falls
  // back to handleSaveSecret's Library-only save.
  const [saveToApp, setSaveToApp] = useState<{ items: UpsertItem[]; commands: CommandItem[]; app?: string } | null>(null);
  const keysOf = (cands: AnalyzeCandidate[]) =>
    cands
      .filter((c) => (c.family === "secret" || c.family === "unknown") && c.value)
      // Prefer the variable name the line was written under (STRIPE_SECRET_KEY=…)
      // so it matches a key already saved in the application.
      .map((c) => ({ name: (keyNameFromFragment(c.raw_fragment) || c.name || c.type || "SECRET").trim(), value: c.value, type: c.type || undefined }));
  const commandsOf = (cands: AnalyzeCandidate[]) =>
    cands.filter((c) => c.family === "command" && (c.value || "").trim()).map((c) => ({ name: (c.name || c.value).trim().slice(0, 80), command: c.value.trim() }));
  const openSaveToApp = useCallback(async () => {
    const found = keysOf(detection?.candidates || []);
    if (!found.length) return handleSaveSecret();
    setSaveToApp({ items: found, commands: [] });
  }, [detection, handleSaveSecret]);

  // The Scratchpad side of Applications: which notes the strip shows, and
  // which application the open note belongs to.
  // Kept while the Scratchpad is hidden (it unmounts on other pages).
  const [show, setShowState] = useState<string>(() => (lastShow = takeFocusApp() ?? lastShow));
  const [appNames, reloadAppNames] = useAppNames(tabs);
  const visibleTabs = useMemo(() => filterTabs(tabs, show), [tabs, show]);
  useEffect(() => {
    if (show !== SHOW_ALL && visibleTabs.length && !visibleTabs.some((x) => x.id === activeId)) setActiveId(visibleTabs[0].id);
  }, [show, visibleTabs, activeId]);
  const setActiveApp = useCallback(async (app: string | null) => {
    const id = activeIdRef.current;
    setTabs((prev) => prev.map((x) => {
      if (x.id !== id) return x;
      const { app: _old, ...rest } = x;
      return app ? { ...rest, app } : rest;
    }));
    try {
      // A note not on the server yet takes its application with its first save.
      await setNoteApp(id, app);
    } catch {
      /* not saved yet */
    }
    reloadAppNames();
    setStatus(app ? fill(t("notes_linked"), { app }) : t("notes_unlinked"));
  }, [reloadAppNames, setStatus]);
  // "Save to {app}": the note's keys and commands into its application.
  const saveNoteToApp = useCallback(async () => {
    let cands = detection?.candidates;
    if (!cands) {
      const text = htmlToPlainText(active?.content || "").trim();
      if (!text) return;
      try {
        const res = await fetch("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: text }) });
        cands = res.ok ? ((await res.json()).candidates as AnalyzeCandidate[]) || [] : [];
      } catch {
        cands = [];
      }
    }
    const items = keysOf(cands);
    const commands = commandsOf(cands);
    if (!items.length && !commands.length) return setStatus(t("notes_nothing_to_save"));
    setSaveToApp({ items, commands, app: active?.app });
  }, [detection, active, setStatus]);

  const handleSmartSplitParagraphs = useCallback(() => {
    if (!tiptap || tiptap.isDestroyed) return;
    const currentHtml = safeGetHTML(tiptap);
    recordSnapshot(activeId, currentHtml, "Before Format");
    const restored = smartFormatParagraphs(currentHtml);
    if (restored && restored !== "<p></p>") {
      contentRef.current[activeId] = restored;
      lastNonEmptyContentRef.current[activeId] = restored;
      setTabs((prev) =>
        prev.map((x) => (x.id === activeId ? { ...x, content: restored } : x))
      );
      try {
        tiptap.commands.setContent(restored, { emitUpdate: true });
        tiptap.chain().focus().run();
      } catch {}
      setStatusMsg(t("scratchpad_paragraphs_restored"));
      setTimeout(() => setStatusMsg(""), 3000);
    }
  }, [tiptap, activeId, recordSnapshot, settings]);

  const handleRestoreRevision = useCallback(
    (rev: NoteRevision) => {
      if (!tiptap || tiptap.isDestroyed) return;
      const html = ensureHtmlParagraphs(rev.content);
      tiptap.chain().setContent(html, { emitUpdate: true }).run();
      contentRef.current[activeId] = html;
      lastNonEmptyContentRef.current[activeId] = html;
      setTabs((prev) => prev.map((x) => (x.id === activeId ? { ...x, content: html } : x)));
      setStatus(getTranslation(settings, "scratchpad_history_restored" as any) || "Version restored!");
      setShowRevisions(false);
      setClearedAlert(null);
    },
    [activeId, settings, setStatus, tiptap]
  );

  const handleRestoreCleared = useCallback(() => {
    if (!clearedAlert || !tiptap || tiptap.isDestroyed) return;
    const html = ensureHtmlParagraphs(clearedAlert.content);
    tiptap.chain().setContent(html, { emitUpdate: true }).run();
    contentRef.current[clearedAlert.tabId] = html;
    lastNonEmptyContentRef.current[clearedAlert.tabId] = html;
    setTabs((prev) => prev.map((x) => (x.id === clearedAlert.tabId ? { ...x, content: html } : x)));
    setClearedAlert(null);
    setStatus(t("scratchpad_content_restored"));
  }, [clearedAlert, setStatus, tiptap, settings]);

  // Intercept Tab / ArrowRight to accept inline ghost text auto-complete,
  // and Ctrl/Cmd+Z/Y for undo/redo history.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if ((e.key === "Tab" || e.key === "ArrowRight") && ghostCompletion && enablePredictions) {
        e.preventDefault();
        // Insert as a ProseMirror text transaction — raw DOM insertNode on the
        // editor fights the DOM observer and can duplicate text. No legacy
        // onEditorInput afterwards: raw innerHTML into contentRef diverges
        // from getHTML() on empty paragraphs and triggers a destructive
        // setContent() re-parse (see handleApplySuggestion).
        const view = tiptap && !tiptap.isDestroyed ? tiptap.view : null;
        if (view) {
          try {
            view.dispatch(view.state.tr.insertText(" " + ghostCompletion));
            triggerAutocomplete(tiptap.getText());
          } catch {}
          setGhostCompletion("");
          setCaretPos(null);
        }
        return;
      }
      if ((e.key === "Escape" || e.key === "Backspace") && ghostCompletion) {
        setGhostCompletion("");
        setCaretPos(null);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        historyUndo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        historyRedo();
      }
    },
    [ghostCompletion, enablePredictions, tiptap, historyUndo, historyRedo]
  );
  const { addTab, closeTab, commitRename, renameId, renameInputRef, renameValue, reorderTab, setRenameId, setRenameValue, startRename } = useTabActions({ activeId, setActiveId, setDetections, setRephraseUndo, setStatus, setTabs, t, tabs, titleTouched });
  // Choosing an application shows only its notes; one with none yet
  // starts its first note so the editor never shows a note from elsewhere.
  const chooseApp = useCallback((v: string) => {
    lastShow = v;
    setShowState(v);
    if (v !== SHOW_ALL && v !== SHOW_NONE && !filterTabs(tabsRef.current, v).length) addTab(v);
  }, [addTab]);
  const { canScrollDown, canScrollUp, noteOverflows, scrollEditor } = useScrollAffordances({ active, activeId, bidiMode, editorRef, misspelledWords, noteFontSize, recomputeSpellRects, scratchRootRef, shellRef, updateScrollAffordancesRef });

  // Effective dir attribute for the editor + overlay.
  const noteDir: "auto" | "ltr" | "rtl" = bidiMode === "auto" ? "auto" : bidiMode;
  const activePlainText = useMemo(() => htmlToPlainText(active?.content || ""), [active?.content]);
  // htmlToPlainText sanitizes + DOM-parses the whole note — memoize it and the
  // direction scan instead of re-running both on every render.
  const detectedDir = useMemo(() => detectBaseDir(activePlainText), [activePlainText]);
  const activeCharCount = activePlainText.length;
  const activeWordCount = useMemo(() => activePlainText.trim().split(/\s+/).filter(Boolean).length, [activePlainText]);
  const activeReadingTime = Math.max(1, Math.ceil(activeWordCount / 200));

    return (
    <div ref={scratchRootRef} className="space-y-4">
      {conflictTab && (
        <div className="flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "var(--amber-bg, rgba(251,191,36,0.08))", border: "1px solid rgba(251,191,36,0.35)", color: "var(--text)" }}>
          <span>{t("scratchpad_conflict_msg" as any) || "This note was changed in another window. Whose version should win?"}</span>
          <span className="flex items-center gap-2 shrink-0">
            <button onClick={() => resolveConflict(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}>
              {t("scratchpad_conflict_load" as any) || "Load saved version"}
            </button>
            <button onClick={() => resolveConflict(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "var(--bg-input)", color: "var(--text)", border: "1px solid var(--border-input)" }}>
              {t("scratchpad_conflict_keep" as any) || "Keep mine"}
            </button>
          </span>
        </div>
      )}
      <NoteTabStrip
        activeId={activeId}
        addTab={() => addTab(show !== SHOW_ALL && show !== SHOW_NONE ? show : undefined)}
        archiveTab={archiveTab}
        closeTab={closeTab}
        commitRename={commitRename}
        dragId={dragId}
        overId={overId}
        renameId={renameId}
        renameInputRef={renameInputRef}
        renameValue={renameValue}
        reorderTab={reorderTab}
        setActiveId={setActiveId}
        setDragId={setDragId}
        setOverId={setOverId}
        setRenameId={setRenameId}
        setRenameValue={setRenameValue}
        startRename={startRename}
        t={t}
        tabs={visibleTabs}
        filter={<NoteFilter show={show} setShow={chooseApp} apps={appNames} t={t} />}
      />

      {/* Save-health alarm — saves are NOT landing; typing exists only in
          this window. Never let this fail silently again. */}
      {saveFailing && (
        <div
          className="rounded-2xl px-4 py-3 flex items-center gap-3 text-xs font-semibold"
          style={{ background: "rgba(248,113,113,0.15)", border: "1px solid rgba(248,113,113,0.45)", color: "#fca5a5" }}
        >
          <span className="text-base leading-none">⚠</span>
          <span className="flex-1">{t("scratchpad_save_failed")}</span>
          <button
            type="button"
            onClick={() => { void drainScratchpadSaves(); }}
            className="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer"
            style={{ background: "rgba(248,113,113,0.25)", color: "#fecaca", border: "1px solid rgba(248,113,113,0.5)" }}
          >
            {t("scratchpad_retry_now")}
          </button>
        </div>
      )}

      {/* Editor + actions */}
      <div
        className="rounded-2xl p-4 space-y-3"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
      >
        <EditorPanel
          active={active}
          appPicker={<NoteAppPicker app={active?.app} apps={appNames} onChange={setActiveApp} t={t} />}
          handleSaveToApp={saveNoteToApp}
          activeCharCount={activeCharCount}
          activeId={activeId}
          activeIsPinned={activeIsPinned}
          activeIsProtected={activeIsProtected}
          activeReadingTime={activeReadingTime}
          activeWordCount={activeWordCount}
          analyze={analyze}
          b={b}
          bidiMode={bidiMode}
          canScrollDown={canScrollDown}
          canScrollUp={canScrollUp}
          contextMenu={contextMenu}
          copied={copied}
          detectedDir={detectedDir}
          enablePredictions={enablePredictions}
          ghostCompletion={ghostCompletion}
          handleAddToDictionary={handleAddToDictionary}
          handleApplySuggestion={handleApplySuggestion}
          handleCopy={handleCopy}
          handleIgnoreWord={handleIgnoreWord}
          handleOpenRevisions={handleOpenRevisions}
          handleProofread={handleProofread}
          handleRephrase={handleRephrase}
          handleSaveNote={handleSaveNote}
          handleSaveSecret={openSaveToApp}
          handleSmartSplitParagraphs={handleSmartSplitParagraphs}
          handleUndoRephrase={handleUndoRephrase}
          hasSecret={hasSecret}
          highlightColor={highlightColor}
          noteFontSize={noteFontSize}
          noteOverflows={noteOverflows}
          onContextMenu={onContextMenu}
          onKeyDown={onKeyDown}
          openCompare={openCompare}
          openRescue={openRescue}
          recordSnapshot={recordSnapshot}
          rephraseUndo={rephraseUndo}
          scrollEditor={scrollEditor}
          setContent={setContent}
          setContextMenu={setContextMenu}
          setGhostCompletion={setGhostCompletion}
          setProtectConfirmInput={setProtectConfirmInput}
          setProtectError={setProtectError}
          setProtectModal={setProtectModal}
          setSlashOpen={setSlashOpen}
          setStyle={setStyle}
          settings={settings}
          shellRef={shellRef}
          slashOpen={slashOpen}
          spellRects={spellRects}
          statusMsg={statusMsg}
          style={style}
          t={t}
          tabs={tabs}
          tiptap={tiptap}
          togglePin={togglePin}
          togglePredictions={togglePredictions}
          triggerAutocomplete={triggerAutocomplete}
        />

        <FormattingToolbar
          bidiMode={bidiMode}
          canScrollDown={canScrollDown}
          canScrollUp={canScrollUp}
          detectedDir={detectedDir}
          execFormat={execFormat}
          highlightColor={highlightColor}
          historyRedo={historyRedo}
          historyUndo={historyUndo}
          noteOverflows={noteOverflows}
          pastePlain={pastePlain}
          scrollEditor={scrollEditor}
          setBidiMode={setBidiMode}
          setHighlightColor={setHighlightColor}
          setPastePlain={setPastePlain}
          setShowHighlightPicker={setShowHighlightPicker}
          setShowTextColorPicker={setShowTextColorPicker}
          setTextColor={setTextColor}
          showHighlightPicker={showHighlightPicker}
          showTextColorPicker={showTextColorPicker}
          t={t}
          textColor={textColor}
          tiptap={tiptap}
          toolbarRef={toolbarRef}
        />

        {saveToApp && (
          <SaveToAppDialog
            items={saveToApp.items}
            commands={saveToApp.commands}
            defaultApp={saveToApp.app}
            t={t}
            onClose={() => setSaveToApp(null)}
            onSaved={(msg) => { setSaveToApp(null); setStatus(msg); reloadAppNames(); }}
            onSaveLibraryOnly={handleSaveSecret}
          />
        )}

        {/* Detection status, moved to underneath the text box. */}
        {detection ? (
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {t("scratchpad_ai_detected")}: {detection.families.join(", ")}
            {detection.provider ? ` · ${detection.provider}` : ""}
          </span>
        ) : (
          <span className="text-[10px]" style={{ color: "var(--text-dim)" }}>
            {t("scratchpad_no_detection")}
          </span>
        )}
      </div>

      <ArchiveSection
        archivedCount={archivedCount}
        archivedTabs={archivedTabs}
        deleteArchivedTab={deleteArchivedTab}
        loadingArchived={loadingArchived}
        restoreTab={restoreTab}
        setPreviewArchivedTab={setPreviewArchivedTab}
        showArchived={showArchived}
        t={t}
        toggleShowArchived={toggleShowArchived}
      />

      <ArchivedNotePreview
        deleteArchivedTab={deleteArchivedTab}
        previewArchivedTab={previewArchivedTab}
        restoreTab={restoreTab}
        setPreviewArchivedTab={setPreviewArchivedTab}
        setStatus={setStatus}
        t={t}
      />

      <RevisionHistoryModal
        active={active}
        handleRestoreRevision={handleRestoreRevision}
        revisionsList={revisionsList}
        selectedRevision={selectedRevision}
        setSelectedRevision={setSelectedRevision}
        setShowRevisions={setShowRevisions}
        showRevisions={showRevisions}
        t={t}
      />

      {/* Accidental Clear / Undo Alert Toast */}
      {clearedAlert && (
        <div
          className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl animate-bounce"
          style={{
            background: "#27272a",
            border: "1px solid #ef4444",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          <div className="p-2 rounded-lg bg-red-500/15 text-red-400">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="text-xs">
            <div className="font-bold text-white">{t("scratchpad_content_cleared")}</div>
            <div className="text-[11px] text-neutral-400">{t("scratchpad_cleared_detected")}</div>
          </div>
          <button
            type="button"
            onClick={handleRestoreCleared}
            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-500 hover:bg-red-400 text-white transition-colors cursor-pointer"
          >
            {t("scratchpad_restore_undo")}
          </button>
          <button
            type="button"
            onClick={() => setClearedAlert(null)}
            className="p-1 text-neutral-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <ProtectModal
        protectConfirmInput={protectConfirmInput}
        protectError={protectError}
        protectInputRef={protectInputRef}
        protectModal={protectModal}
        protectShowInput={protectShowInput}
        setProtectConfirmInput={setProtectConfirmInput}
        setProtectError={setProtectError}
        setProtectModal={setProtectModal}
        setProtectShowInput={setProtectShowInput}
        submitProtect={submitProtect}
        t={t}
      />

      <RescueModal
        rescueList={rescueList}
        rescueLoading={rescueLoading}
        rescueOpen={rescueOpen}
        rescueQuery={rescueQuery}
        restoreOrphan={restoreOrphan}
        setRescueOpen={setRescueOpen}
        setRescueQuery={setRescueQuery}
        t={t}
      />

      <CompareModal
        compareA={compareA}
        compareB={compareB}
        compareData={compareData}
        compareOpen={compareOpen}
        setCompareA={setCompareA}
        setCompareB={setCompareB}
        setCompareOpen={setCompareOpen}
        t={t}
        tabs={tabs}
      />
    </div>
  );
};

export default ScratchpadTab;
