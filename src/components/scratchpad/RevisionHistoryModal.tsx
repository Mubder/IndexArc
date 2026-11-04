import { useId, type Dispatch, type SetStateAction } from "react";
import type { ScratchTab } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import type { NoteRevision } from "./revisions";
import { History, X, RotateCcw } from "lucide-react";
import { sanitizeNoteHtml } from "../../sanitize";
import { useDialogA11y } from "../../hooks/useDialogA11y";

export interface RevisionHistoryModalProps {
  active: ScratchTab;
  handleRestoreRevision: (rev: NoteRevision) => void;
  revisionsList: NoteRevision[];
  selectedRevision: NoteRevision | null;
  setSelectedRevision: Dispatch<SetStateAction<NoteRevision | null>>;
  setShowRevisions: Dispatch<SetStateAction<boolean>>;
  showRevisions: boolean;
  t: (key: keyof TranslationDict) => string;
}

export function RevisionHistoryModal({ active, handleRestoreRevision, revisionsList, selectedRevision, setSelectedRevision, setShowRevisions, showRevisions, t }: RevisionHistoryModalProps) {
  const dialogRef = useDialogA11y(showRevisions, () => setShowRevisions(false));
  const titleId = useId();
  return (
    <>
      {/* Revision History Modal */}
      {showRevisions && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
          onClick={() => setShowRevisions(false)}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="w-full max-w-2xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
            style={{
              background: "#121214",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div
              className="px-5 py-4 flex items-center justify-between border-b"
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "#18181b" }}
            >
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400">
                  <History className="w-5 h-5" />
                </div>
                <div>
                  <h3 id={titleId} className="text-sm font-bold text-white">
                    {t("scratchpad_history_title")}
                  </h3>
                  <p className="text-xs text-neutral-400">
                    {active?.title || t("family_note")} &bull; {revisionsList.length} {revisionsList.length === 1 ? t("history_version_one") : t("history_version_many")} {t("history_saved_suffix")}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowRevisions(false)}
                aria-label={t("close_btn")}
                className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 flex overflow-hidden min-h-[340px]">
              {/* Revision list sidebar */}
              <div
                className="w-64 border-r overflow-y-auto flex flex-col p-2 gap-1.5"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "#141416" }}
              >
                {revisionsList.length === 0 ? (
                  <div className="p-4 text-center text-xs text-neutral-500">
                    {t("scratchpad_history_empty")}
                  </div>
                ) : (
                  revisionsList.map((rev, idx) => {
                    const isSelected = selectedRevision?.id === rev.id;
                    const dateStr = new Date(rev.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    });
                    const dateFull = new Date(rev.timestamp).toLocaleDateString([], {
                      month: "short",
                      day: "numeric",
                    });
                    return (
                      <button
                        key={rev.id}
                        type="button"
                        onClick={() => setSelectedRevision(rev)}
                        className={`text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1 cursor-pointer ${
                          isSelected
                            ? "bg-amber-500/15 border border-amber-500/40 text-white shadow-sm"
                            : "hover:bg-white/5 border border-transparent text-neutral-300"
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-amber-300">
                            {idx === 0 ? t("history_latest_snapshot") : `${t("history_version_label")} ${revisionsList.length - idx}`}
                          </span>
                          <span className="text-[10px] text-neutral-400">{dateStr}</span>
                        </div>
                        <div className="text-[10px] text-neutral-400 flex items-center justify-between">
                          <span>{dateFull}</span>
                          <span>{rev.charCount} {t("chars_unit")}</span>
                        </div>
                        {rev.reason && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-neutral-400 self-start font-mono">
                            {rev.reason}
                          </span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>

              {/* Revision content preview */}
              <div className="flex-1 flex flex-col overflow-hidden bg-[#0e0e10]">
                {selectedRevision ? (
                  <>
                    <div
                      className="px-4 py-2 text-xs border-b flex items-center justify-between"
                      style={{ borderColor: "rgba(255,255,255,0.08)" }}
                    >
                      <span className="text-neutral-400">
                        {t("history_preview_label")}: <strong className="text-white">{selectedRevision.charCount} {t("note_characters")}</strong>
                      </span>
                      <span className="text-[11px] text-neutral-500">
                        {new Date(selectedRevision.timestamp).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto font-sans text-xs text-neutral-200 leading-[1.6] select-text">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: sanitizeNoteHtml(selectedRevision.content) || `<em>${t("history_empty")}</em>`,
                        }}
                        className="prose prose-invert max-w-none text-xs"
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-neutral-500">
                    {t("history_select_version")}
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div
              className="px-5 py-3 border-t flex items-center justify-between"
              style={{ borderColor: "rgba(255,255,255,0.08)", background: "#18181b" }}
            >
              <span className="text-xs text-neutral-400">
                {t("history_footer_hint")}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowRevisions(false)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-300 hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {t("close_btn")}
                </button>
                {selectedRevision && (
                  <button
                    type="button"
                    onClick={() => handleRestoreRevision(selectedRevision)}
                    className="px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md cursor-pointer"
                    style={{
                      background: "#f59e0b",
                      color: "#000000",
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t("scratchpad_history_restore")}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
