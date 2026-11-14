import { AnalyzeCandidate } from "../../types";
import { findDuplicateHits } from "../../utils";
import { useRef } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Tab } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";

export interface UsePasteActionsArgs {
  candidates: AnalyzeCandidate[];
  fetchAll: () => Promise<void>;
  paste: string;
  pasteId: string | null;
  selected: Record<string, boolean>;
  setAnalyzing: Dispatch<SetStateAction<boolean>>;
  setCandidates: Dispatch<SetStateAction<AnalyzeCandidate[]>>;
  setPaste: Dispatch<SetStateAction<string>>;
  setPasteId: Dispatch<SetStateAction<string | null>>;
  setProviderUsed: Dispatch<SetStateAction<string>>;
  setSelected: Dispatch<SetStateAction<Record<string, boolean>>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  showConfirm: (title: string, message: string, onConfirm: () => void, confirmText?: string | undefined) => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  t: (key: keyof TranslationDict) => string;
}

// Paste & Analyze: analyze, edit or discard candidates, save the selected ones.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function usePasteActions({ candidates, fetchAll, paste, pasteId, selected, setAnalyzing, setCandidates, setPaste, setPasteId, setProviderUsed, setSelected, setTab, showConfirm, showToast, t }: UsePasteActionsArgs) {
  const handleAnalyze = async () => {
    if (!paste.trim()) return;
    setAnalyzing(true);
    setCandidates([]);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: paste }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Analyze failed");
      setPasteId(data.paste_id);
      setCandidates(data.candidates || []);
      setProviderUsed(data.provider_used || "");
      const sel: Record<string, boolean> = {};
      for (const c of data.candidates || []) sel[c.temp_id] = true;
      setSelected(sel);
    } catch (e: any) {
      showToast(e.message, "error");
    } finally {
      setAnalyzing(false);
      fetchAll();
    }
  };

  const updateCandidate = (tempId: string, patch: Partial<AnalyzeCandidate>) => {
    setCandidates((prev) =>
      prev.map((c) => {
        if (c.temp_id !== tempId) return c;
        const next = { ...c, ...patch };
        next.needs_type = !String(next.type || "").trim() && (next.family === "secret" || next.family === "unknown");
        next.needs_name =
          !String(next.name || "").trim() && (next.family === "secret" || next.family === "unknown");
        if (next.family === "note" || next.family === "command") {
          next.needs_type = false;
          next.needs_name = false;
        }
        next.ready = !next.needs_type && !next.needs_name;
        return next;
      })
    );
  };

  const discardCandidate = (tempId: string) => {
    setCandidates((prev) => prev.filter((c) => c.temp_id !== tempId));
    setSelected((prev) => {
      const n = { ...prev };
      delete n[tempId];
      return n;
    });
  };

  // One save at a time. The Save buttons stay clickable while the duplicate
  // check and the save run, so a double-click started a second save whose
  // duplicate check found the first one's brand-new entry: "saved" followed
  // by a "Possible duplicates" prompt for the very same key.
  const savingRef = useRef(false);
  const handleSaveSelected = async (parkIncomplete: boolean) => {
    if (savingRef.current) return;
    savingRef.current = true;
    try {
      await saveSelected(parkIncomplete);
    } finally {
      savingRef.current = false;
    }
  };
  const saveSelected = async (parkIncomplete: boolean) => {
    const items = candidates.filter((c) => selected[c.temp_id]);
    if (!items.length) return;
    const doSave = async () => {
      const payload = items.map((c) => ({
        value: c.value,
        type: c.type,
        name: c.name,
        raw_fragment: c.raw_fragment,
        labels: c.labels,
        type_aliases: c.type_aliases,
        family: c.family,
      }));
      const endpoint = parkIncomplete ? "/api/entries/park" : "/api/entries/save";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paste_id: pasteId, candidates: payload }),
      });
      if (res.ok) {
        setCandidates([]);
        setPaste("");
        setPasteId(null);
        fetchAll();
        setTab("home");
      } else {
        const err = await res.json();
        showToast(err.error || t("save_failed"), "error");
      }
    };
    // Pre-save duplicate screen: values already in the vault trigger a
    // confirm instead of silently doubling entries. Cancelling deselects the
    // duplicates so a second click saves only the new ones.
    try {
      const hits = await findDuplicateHits(items);
      if (hits.length) {
        const names = hits.map((h) => `"${h.existing_name}"`).slice(0, 4).join(", ");
        const more = hits.length > 4 ? ` ${fill(t("more_count"), { n: hits.length - 4 })}` : "";
        // showConfirm resolves on BOTH confirm and cancel — track the choice.
        let confirmed = false;
        await showConfirm(
          t("dup_confirm_title"),
          fill(t("dup_confirm_msg"), { n: hits.length, total: items.length, names: `${names}${more}` }),
          async () => {
            confirmed = true;
            await doSave();
          },
          t("dup_save_anyway")
        ).catch(() => {});
        if (confirmed) return;
        // Cancelled: deselect the duplicates, keep the rest selected.
        const dupIds = new Set(hits.map((h) => items[h.index].temp_id));
        setSelected((prev) => {
          const n = { ...prev };
          for (const id of dupIds) delete n[id];
          return n;
        });
        showToast(fill(t("dup_deselected"), { n: items.length - hits.length }), "info");
        return;
      }
    } catch {
      /* fail open — duplicates are advisory */
    }
    await doSave();
  };

  return { discardCandidate, handleAnalyze, handleSaveSelected, updateCandidate };
}
