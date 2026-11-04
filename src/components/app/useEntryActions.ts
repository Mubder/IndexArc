import { VaultEntry } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { fill } from "../home/DashboardCards";
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

export interface UseEntryActionsArgs {
  fetchAll: () => Promise<void>;
  setAttention: Dispatch<SetStateAction<VaultEntry[]>>;
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>;
  showConfirm: (title: string, message: string, onConfirm: () => void, confirmText?: string | undefined) => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  t: (key: keyof TranslationDict) => string;
}

// Library entry edits and (bulk) deletes.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useEntryActions({ fetchAll, setAttention, setEntries, showConfirm, showToast, t }: UseEntryActionsArgs) {
  /** PATCH an entry (NoteDetailModal edit path). Returns success. */
  const saveEntryUpdate = async (id: string, updates: Partial<VaultEntry>): Promise<boolean> => {
    try {
      const res = await fetch(`/api/entries/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        fetchAll();
        return true;
      }
      const err = await res.json().catch(() => null);
      showToast(err?.error || t("save_failed"), "error");
      return false;
    } catch {
      showToast(t("toast_network_error"), "error");
      return false;
    }
  };

  const removeEntriesLocally = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setEntries((prev) => prev.filter((e) => !idSet.has(e.id)));
    setAttention((prev) => prev.filter((e) => !idSet.has(e.id)));
  }, []);

  const deleteEntry = async (id: string) => {
    showConfirm(t("confirm_delete_entry_title"), t("confirm_delete_entry_msg"), async () => {
      const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `${t("delete_failed")} (HTTP ${res.status})`);
      }
      removeEntriesLocally([id]);
      await fetchAll();
    }, t("delete_btn")).catch((e) => showToast(e?.message || t("delete_failed"), "error"));
  };

  const bulkDeleteEntries = async (ids: string[]) => {
    if (ids.length === 0) return;
    return showConfirm(
      t("confirm_delete_entries_title"),
      fill(t(ids.length === 1 ? "confirm_delete_entries_one" : "confirm_delete_entries_many"), { n: ids.length }),
      async () => {
        // Optimistic update first so the UI reflects the deletion immediately.
        removeEntriesLocally(ids);
        await fetch("/api/entries/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        await fetchAll();
      },
      t("delete_btn")
    );
  };

  return { bulkDeleteEntries, deleteEntry, saveEntryUpdate };
}
