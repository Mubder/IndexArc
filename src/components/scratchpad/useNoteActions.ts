import { useRef, useCallback } from "react";
import { AnalyzeCandidate } from "../../types";
import { findDuplicateHits } from "../../utils";
import { htmlToPlainText } from "../../lib/noteHtml";
import { textToNoteHtml } from "../../sanitize";
import { copyTextToClipboard } from "../../lib/clipboard";
import { plainToSimpleHtml } from "../../lib/clipboardText";
import type { Dispatch, SetStateAction, RefObject } from "react";
import type { ScratchTab, Detection, Busy, RewriteStyle } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";

export interface UseNoteActionsArgs {
  active: ScratchTab;
  activeId: string;
  detection: Detection;
  protectedIdsRef: RefObject<Set<string>>;
  recordSnapshot: (tabId: string, content: string, reason?: string | undefined) => Promise<void>;
  rephraseUndo: Record<string, string[]>;
  setBusy: Dispatch<SetStateAction<Record<string, Busy>>>;
  setContent: (id: string, content: string) => void;
  setCopied: Dispatch<SetStateAction<boolean>>;
  setDetections: Dispatch<SetStateAction<Record<string, Detection>>>;
  setRephraseUndo: Dispatch<SetStateAction<Record<string, string[]>>>;
  setStatus: (msg: string) => void;
  style: RewriteStyle;
  t: (key: keyof TranslationDict) => string;
}

// Note actions: analyze, save as note or secret, rephrase, proofread, undo, copy.
// Moved verbatim from ScratchpadTab (R3.4); the component wires the inputs.
export function useNoteActions({ active, activeId, detection, protectedIdsRef, recordSnapshot, rephraseUndo, setBusy, setContent, setCopied, setDetections, setRephraseUndo, setStatus, style, t }: UseNoteActionsArgs) {
  // Analyze runs the WHOLE note through the detection pipeline (LLM-backed
  // server-side). Pasting several items in quick succession used to fire one
  // full-note request per paste — collapse bursts: while a request for a tab
  // is in flight, remember only the latest content and analyze that once.
  const analyzePendingRef = useRef<Record<string, string | null>>({});
  const analyze = useCallback(async (id: string, content: string) => {
    const text = content.trim();
    if (!text) {
      analyzePendingRef.current[id] = null;
      setDetections((d) => {
        const n = { ...d };
        delete n[id];
        return n;
      });
      return;
    }
    if (analyzePendingRef.current[id]) {
      analyzePendingRef.current[id] = content;
      return;
    }
    analyzePendingRef.current[id] = content;
    setBusy((prev) => ({ ...prev, [id]: { ...prev[id], analyze: true } }));
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text }),
      });
      const data = await res.json();
      if (res.ok) {
        const candidates: AnalyzeCandidate[] = data.candidates || [];
        const families = Array.from(new Set(candidates.map((c) => c.family)));
        setDetections((d) => ({ ...d, [id]: { families, candidates, provider: data.provider_used || "" } }));
      }
    } catch {
      /* ignore analysis errors */
    } finally {
      setBusy((prev) => ({ ...prev, [id]: { ...prev[id], analyze: false } }));
      const queued = analyzePendingRef.current[id];
      analyzePendingRef.current[id] = null;
      if (typeof queued === "string" && queued.trim() && queued !== content) {
        analyze(id, queued);
      }
    }
  }, []);

  // Two-click force-save for duplicates: the first save attempt only warns
  // (remembering the items' signature); an immediate second attempt with the
  // same items proceeds. Re-save on purpose without needing a modal.
  const dupAckRef = useRef<string | null>(null);
  const checkDupAck = async (items: { value?: string; name?: string }[]): Promise<boolean> => {
    const sig = JSON.stringify(items.map((i) => String(i.value ?? "")));
    let hits: Awaited<ReturnType<typeof findDuplicateHits>> = [];
    try {
      hits = await findDuplicateHits(items);
    } catch {
      return true;
    }
    if (!hits.length) return true;
    if (dupAckRef.current === sig) {
      dupAckRef.current = null;
      return true;
    }
    dupAckRef.current = sig;
    const names = hits
      .map((h) => `"${h.existing_name}"`)
      .slice(0, 3)
      .join(", ");
    const more = hits.length > 3 ? ` +${hits.length - 3}` : "";
    setStatus(fill(t("scratchpad_already_in_vault"), { names: `${names}${more}` }));
    return false;
  };

  const handleSaveNote = async () => {
    const plainText = htmlToPlainText(active?.content || "").trim();
    if (!plainText) return;
    const items: Array<Partial<AnalyzeCandidate> & { notes?: string; source_file?: string }> = [
      {
        value: plainText,
        type: "note",
        name: active?.title || "Scratch",
        raw_fragment: active?.content || "",
        labels: [],
        type_aliases: ["note"],
        family: "note",
        notes: plainText,
      },
    ];
    // Duplicate screen: warn on first attempt, save on repeat (two-click force).
    if (!(await checkDupAck(items))) return;
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: true } }));
    setStatus(t("scratchpad_saving"));
    try {
      const res = await fetch("/api/entries/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: items.map((c) => ({
            value: c.value,
            type: c.type,
            name: c.name,
            raw_fragment: c.raw_fragment,
            labels: c.labels,
            type_aliases: c.type_aliases,
            family: c.family,
            notes: c.notes,
            source_file: "scratchpad",
          })),
        }),
      });
      if (res.ok) {
        setStatus(t("scratchpad_saved_ok"));
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus(err.error || t("scratchpad_save_err"));
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_save_err"));
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: false } }));
    }
  };

  const handleSaveSecret = async () => {
    const plainText = htmlToPlainText(active?.content || "").trim();
    if (!plainText) return;
    const secretItems: Array<Partial<AnalyzeCandidate> & { notes?: string }> =
      detection?.candidates?.filter((c) => c.family === "secret" || c.family === "unknown") || [];
    const items: Array<Partial<AnalyzeCandidate> & { notes?: string; source_file?: string }> =
      secretItems.length > 0
        ? secretItems.map((c) => ({ ...c, value: c.value || "" }))
        : [
            {
              value: plainText,
              type: "note",
              name: active?.title || "Scratch",
              raw_fragment: plainText,
              labels: [],
              type_aliases: ["note"],
              family: "note",
              notes: plainText,
              source_file: "scratchpad",
            },
          ];
    // Duplicate screen: warn on first attempt, save on repeat (two-click force).
    if (!(await checkDupAck(items))) return;
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: true } }));
    setStatus(t("scratchpad_saving"));
    try {
      const res = await fetch("/api/entries/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidates: items.map((c) => ({
            value: c.value,
            type: c.type,
            name: c.name,
            raw_fragment: c.raw_fragment,
            labels: c.labels,
            type_aliases: c.type_aliases,
            family: c.family,
            notes: c.notes,
            source_file: c.family === "note" ? "scratchpad" : c.source_file,
          })),
        }),
      });
      if (res.ok) {
        setStatus(t("scratchpad_saved_ok"));
      } else {
        const err = await res.json().catch(() => ({}));
        setStatus(err.error || t("scratchpad_save_err"));
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_save_err"));
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], save: false } }));
    }
  };

  const handleRephrase = async () => {
    if (protectedIdsRef.current.has(activeId)) return;
    const original = active?.content || "";
    const text = htmlToPlainText(original).trim();
    if (!text) return;
    recordSnapshot(activeId, original, "Before AI Rewrite");
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], rewrite: true } }));
    setStatus(t("scratchpad_rewriting"));
    try {
      const res = await fetch("/api/rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, style, tab_id: activeId }),
      });
      const data = await res.json();
      if (res.ok && data.rewritten) {
        setRephraseUndo((prev) => ({
          ...prev,
          [activeId]: [...(prev[activeId] || []), original],
        }));
        const newHtml = textToNoteHtml(data.rewritten);
        // setContent routes through setEditorHtml for the active tab, which
        // updates DOM + history + state together — no direct innerHTML write.
        setContent(activeId, newHtml);
        setStatus(t("scratchpad_rephrased"));
        analyze(activeId, data.rewritten);
      } else {
        setStatus(data.error || t("scratchpad_rewrite_err"));
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_rewrite_err"));
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], rewrite: false } }));
    }
  };

  const handleProofread = async () => {
    if (protectedIdsRef.current.has(activeId)) return;
    const original = active?.content || "";
    const text = htmlToPlainText(original).trim();
    if (!text) return;
    recordSnapshot(activeId, original, "Before Proofread");
    setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], proofread: true } }));
    setStatus(t("scratchpad_proofreading" as any) || "Proofreading...");
    try {
      const res = await fetch("/api/proofread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, tab_id: activeId }),
      });
      const data = await res.json();
      if (res.ok && data.corrected) {
        setRephraseUndo((prev) => ({
          ...prev,
          [activeId]: [...(prev[activeId] || []), original],
        }));
        const newHtml = textToNoteHtml(data.corrected);
        setContent(activeId, newHtml);
        setStatus(t("scratchpad_proofread_ok" as any) || "Proofread complete");
        analyze(activeId, data.corrected);
      } else {
        setStatus(data.error || t("scratchpad_proofread_err" as any) || "Proofread failed");
      }
    } catch (e: any) {
      setStatus(e?.message || t("scratchpad_proofread_err" as any) || "Proofread failed");
    } finally {
      setBusy((prev) => ({ ...prev, [activeId]: { ...prev[activeId], proofread: false } }));
    }
  };

  const handleUndoRephrase = () => {
    const stack = rephraseUndo[activeId] || [];
    if (stack.length === 0) return;
    const previous = stack[stack.length - 1];
    setRephraseUndo((prev) => ({
      ...prev,
      [activeId]: stack.slice(0, -1),
    }));
    setContent(activeId, previous);
    setStatus(t("scratchpad_rephrase_undone"));
    analyze(activeId, previous);
  };

   const handleCopy = async () => {
     try {
       const plain = htmlToPlainText(active?.content || "");
       await copyTextToClipboard(plain, { html: plainToSimpleHtml(plain) });
       setCopied(true);
       setTimeout(() => setCopied(false), 1500);
     } catch {}
   };

  return { analyze, handleCopy, handleProofread, handleRephrase, handleSaveNote, handleSaveSecret, handleUndoRephrase };
}
