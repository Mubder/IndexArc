import type { Dispatch, SetStateAction } from "react";
import type { ScratchTab } from "../../types";
import { Archive, X, Copy, Trash2, ArchiveRestore } from "lucide-react";
import { htmlToPlainText } from "../../lib/noteHtml";
import { copyTextToClipboard } from "../../lib/clipboard";
import { sanitizeNoteHtml } from "../../sanitize";

export interface ArchivedNotePreviewProps {
  deleteArchivedTab: (id: string, title?: string | undefined) => Promise<void>;
  previewArchivedTab: ScratchTab | null;
  restoreTab: (id: string) => Promise<void>;
  setPreviewArchivedTab: Dispatch<SetStateAction<ScratchTab | null>>;
  setStatus: (msg: string) => void;
}

export function ArchivedNotePreview({ deleteArchivedTab, previewArchivedTab, restoreTab, setPreviewArchivedTab, setStatus }: ArchivedNotePreviewProps) {
  return (
    <>
      {/* Archived Note Preview Modal (Passive Reference Viewer) */}
      {previewArchivedTab && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setPreviewArchivedTab(null)}
        >
          <div
            className="w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
            style={{
              background: "#121214",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="flex items-center justify-between px-5 py-3.5 border-b"
              style={{ borderColor: "rgba(255,255,255,0.08)" }}
            >
              <div className="flex items-center gap-2.5">
                <Archive className="w-4 h-4 text-amber-400" />
                <h3 className="text-sm font-semibold text-zinc-100 truncate max-w-md">
                  {previewArchivedTab.title || "Archived Note"}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                  Reference Only
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewArchivedTab(null)}
                className="p-1 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Note Meta */}
            <div
              className="px-5 py-2 border-b flex items-center justify-between text-[11px] text-zinc-400"
              style={{ borderColor: "rgba(255,255,255,0.05)", background: "rgba(255,255,255,0.02)" }}
            >
              <div className="flex items-center gap-3">
                {previewArchivedTab.archivedAt && (
                  <span>Archived on {new Date(previewArchivedTab.archivedAt).toLocaleString()}</span>
                )}
                <span>•</span>
                <span>{htmlToPlainText(previewArchivedTab.content || "").length} characters</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void copyTextToClipboard(htmlToPlainText(previewArchivedTab.content || ""));
                    setStatus("Copied to clipboard");
                  }}
                  className="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors flex items-center gap-1.5"
                >
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </button>
              </div>
            </div>

            {/* Read-Only Content Body */}
            <div
              className="flex-1 overflow-y-auto p-5 text-sm leading-[1.6] select-text"
              style={{ color: "#d4d4d8" }}
              dangerouslySetInnerHTML={{ __html: sanitizeNoteHtml(previewArchivedTab.content) || "<p class='text-zinc-500'>Empty note</p>" }}
            />

            {/* Footer Actions */}
            <div
              className="flex items-center justify-between px-5 py-3 border-t"
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "rgba(0,0,0,0.3)" }}
            >
              <button
                type="button"
                onClick={() => deleteArchivedTab(previewArchivedTab.id, previewArchivedTab.title)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors flex items-center gap-1.5"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete Permanently</span>
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewArchivedTab(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-400 hover:text-zinc-200 hover:bg-white/5 transition-colors"
                >
                  Close
                </button>
                <button
                  type="button"
                  onClick={() => restoreTab(previewArchivedTab.id)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors flex items-center gap-1.5 shadow-sm"
                >
                  <ArchiveRestore className="w-3.5 h-3.5" />
                  <span>Restore to Active Notes</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
