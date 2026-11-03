import { VaultEntry } from "../../types";
import { useCallback } from "react";
import type { Dispatch, SetStateAction } from "react";

export interface UseEntryActionsArgs {
  fetchAll: () => Promise<void>;
  setAttention: Dispatch<SetStateAction<VaultEntry[]>>;
  setEntries: Dispatch<SetStateAction<VaultEntry[]>>;
  showConfirm: (title: string, message: string, onConfirm: () => void, confirmText?: string | undefined) => Promise<void>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

// Library entry edits and (bulk) deletes.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useEntryActions({ fetchAll, setAttention, setEntries, showConfirm, showToast }: UseEntryActionsArgs) {
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
      showToast(err?.error || "Save failed / فشل الحفظ", "error");
      return false;
    } catch {
      showToast("Network error / خطأ في الاتصال", "error");
      return false;
    }
  };

  const removeEntriesLocally = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setEntries((prev) => prev.filter((e) => !idSet.has(e.id)));
    setAttention((prev) => prev.filter((e) => !idSet.has(e.id)));
  }, []);

  const deleteEntry = async (id: string) => {
    showConfirm("Delete Entry", "Delete this entry permanently?", async () => {
      const res = await fetch(`/api/entries/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) {
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Delete failed (HTTP ${res.status})`);
      }
      removeEntriesLocally([id]);
      await fetchAll();
    }, "Delete").catch((e) => showToast(e?.message || "Delete failed", "error"));
  };

  const bulkDeleteEntries = async (ids: string[]) => {
    if (ids.length === 0) return;
    return showConfirm(
      "Delete Entries",
      `Delete ${ids.length} selected entr${ids.length === 1 ? "y" : "ies"} permanently?`,
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
      "Delete"
    );
  };

  return { bulkDeleteEntries, deleteEntry, saveEntryUpdate };
}
