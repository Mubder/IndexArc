import type { Dispatch, SetStateAction } from "react";
import type { ScratchTab } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import { Archive, Loader2, ArchiveRestore, Trash2 } from "lucide-react";

export interface ArchiveSectionProps {
  archivedCount: number;
  archivedTabs: ScratchTab[] | null;
  deleteArchivedTab: (id: string, title?: string | undefined) => Promise<void>;
  loadingArchived: boolean;
  restoreTab: (id: string) => Promise<void>;
  setPreviewArchivedTab: Dispatch<SetStateAction<ScratchTab | null>>;
  showArchived: boolean;
  t: (key: keyof TranslationDict) => string;
  toggleShowArchived: () => void;
}

export function ArchiveSection({ archivedCount, archivedTabs, deleteArchivedTab, loadingArchived, restoreTab, setPreviewArchivedTab, showArchived, t, toggleShowArchived }: ArchiveSectionProps) {
  return (
    <>
      {/* Archived tabs — Cold Reference Archive */}
      {(archivedCount > 0 || (archivedTabs && archivedTabs.length > 0)) && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
        >
          <button
            type="button"
            onClick={toggleShowArchived}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold"
            style={{ color: "var(--text-dim)" }}
          >
            <span className="flex items-center gap-2">
              <Archive className="w-3.5 h-3.5 text-amber-400/80" />
              <span>{t("scratchpad_archived")} ({archivedCount})</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 font-mono text-zinc-400">Cold Storage</span>
            </span>
            <span className="text-zinc-500">{showArchived ? "▾" : "▸"}</span>
          </button>
          {showArchived && (
            <div className="px-4 pb-3 flex flex-col gap-1.5">
              {loadingArchived && (
                <div className="py-4 flex items-center justify-center gap-2 text-xs text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Loading archive...</span>
                </div>
              )}
              {!loadingArchived && archivedTabs && archivedTabs.length === 0 && (
                <div className="py-2 text-center text-xs text-zinc-500">No archived notes</div>
              )}
              {!loadingArchived && archivedTabs && archivedTabs.map((tab) => (
                <div
                  key={tab.id}
                  className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg group transition-colors"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
                >
                  <span
                    className="flex-1 truncate text-xs cursor-pointer hover:underline"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => setPreviewArchivedTab(tab)}
                    title="Click to preview (read-only)"
                  >
                    {tab.title || "Untitled"}
                  </span>
                  {tab.archivedAt && (
                    <span className="text-[10px] text-zinc-500 hidden sm:inline">
                      {new Date(tab.archivedAt).toLocaleDateString()}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPreviewArchivedTab(tab)}
                    className="opacity-70 hover:opacity-100 transition-opacity text-xs px-1.5 py-0.5 rounded bg-white/5 hover:bg-white/10 text-zinc-300"
                    title="View note"
                  >
                    View
                  </button>
                  <button
                    type="button"
                    onClick={() => restoreTab(tab.id)}
                    className="opacity-70 hover:opacity-100 transition-opacity text-emerald-400 hover:text-emerald-300 p-1"
                    aria-label={t("scratchpad_restore")}
                    title={t("scratchpad_restore")}
                  >
                    <ArchiveRestore className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteArchivedTab(tab.id, tab.title)}
                    className="opacity-70 hover:opacity-100 transition-opacity text-red-400 hover:text-red-300 p-1"
                    aria-label={t("scratchpad_delete")}
                    title={t("scratchpad_delete")}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
