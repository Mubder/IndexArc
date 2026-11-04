import { useId, type Dispatch, type SetStateAction } from "react";
import type { ScratchTab } from "../../types";
import type { TranslationDict } from "../../utils/i18n";
import type { CompareRow, CompareStats } from "../../lib/noteDiff";
import { createPortal } from "react-dom";
import { ArrowLeftRight, X } from "lucide-react";
import { CompareCell } from "./CompareCell";
import { useDialogA11y } from "../../hooks/useDialogA11y";

export interface CompareModalProps {
  compareA: string;
  compareB: string;
  compareData: { rows: CompareRow[]; stats: CompareStats; dirA: "ltr" | "rtl"; dirB: "ltr" | "rtl"; titleA: string; titleB: string; } | null;
  compareOpen: boolean;
  setCompareA: Dispatch<SetStateAction<string>>;
  setCompareB: Dispatch<SetStateAction<string>>;
  setCompareOpen: Dispatch<SetStateAction<boolean>>;
  t: (key: keyof TranslationDict) => string;
  tabs: ScratchTab[];
}

export function CompareModal({ compareA, compareB, compareData, compareOpen, setCompareA, setCompareB, setCompareOpen, t, tabs }: CompareModalProps) {
  const dialogRef = useDialogA11y(compareOpen, () => setCompareOpen(false));
  const titleId = useId();
  return (
    <>
      {/* Compare two notes side by side with highlighted differences. */}
      {compareOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
            onClick={() => setCompareOpen(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="w-full max-w-6xl max-h-[88vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
              style={{ background: "#121214", border: "1px solid rgba(255,255,255,0.12)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className="px-5 py-4 flex items-center justify-between border-b"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "#18181b" }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-300">
                    <ArrowLeftRight className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 id={titleId} className="text-sm font-bold text-white">{t("scratchpad_compare_title")}</h3>
                    <p className="text-xs text-neutral-400 max-w-xl">{t("scratchpad_compare_desc")}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setCompareOpen(false)}
                  aria-label={t("close_btn")}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Note pickers + change stats */}
              <div
                className="px-5 py-3 flex flex-wrap items-center gap-2 border-b"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "#141416" }}
              >
                <select
                  aria-label={t("compare_left_note")}
                  value={compareA}
                  onChange={(e) => setCompareA(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs max-w-[220px] truncate"
                  style={{ background: "#1e1e22", border: "1px solid rgba(248,113,113,0.35)", color: "#fca5a5" }}
                >
                  {tabs.map((x) => (
                    <option key={x.id} value={x.id}>{x.title}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => { setCompareA(compareB); setCompareB(compareA); }}
                  title={t("compare_swap_sides")}
                  aria-label={t("compare_swap_sides")}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
                <select
                  aria-label={t("compare_right_note")}
                  value={compareB}
                  onChange={(e) => setCompareB(e.target.value)}
                  className="px-2.5 py-1.5 rounded-lg text-xs max-w-[220px] truncate"
                  style={{ background: "#1e1e22", border: "1px solid rgba(52,211,153,0.35)", color: "#6ee7b7" }}
                >
                  {tabs.map((x) => (
                    <option key={x.id} value={x.id}>{x.title}</option>
                  ))}
                </select>
                <div className="flex-1" />
                {compareData && (
                  <div className="flex items-center gap-2 text-[11px] font-semibold font-mono">
                    <span className="px-2 py-0.5 rounded-md" style={{ background: "rgba(248,113,113,0.15)", color: "#fca5a5" }}>
                      −{compareData.stats.removed}
                    </span>
                    <span className="px-2 py-0.5 rounded-md" style={{ background: "rgba(52,211,153,0.15)", color: "#6ee7b7" }}>
                      +{compareData.stats.added}
                    </span>
                    <span className="px-2 py-0.5 rounded-md" style={{ background: "rgba(255,255,255,0.06)", color: "#a1a1aa" }}>
                      ={compareData.stats.unchanged}
                    </span>
                  </div>
                )}
              </div>

              {/* Diff body */}
              <div className="flex-1 overflow-auto" style={{ background: "#0e0e10" }}>
                {!compareData ? (
                  <div className="h-full flex items-center justify-center p-8 text-center text-xs text-neutral-500">
                    {t("scratchpad_compare_pick_two")}
                  </div>
                ) : compareData.stats.added === 0 && compareData.stats.removed === 0 ? (
                  <div className="h-full flex items-center justify-center p-8">
                    <div
                      className="px-4 py-3 rounded-xl text-xs font-semibold"
                      style={{ background: "rgba(52,211,153,0.12)", color: "#6ee7b7", border: "1px solid rgba(52,211,153,0.3)" }}
                    >
                      {t("scratchpad_compare_identical")}
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0">
                    {compareData.rows.map((row, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-2"
                        style={{ borderTop: i === 0 ? "none" : "1px solid rgba(255,255,255,0.04)" }}
                      >
                        <CompareCell side={row.left} variant="left" dir={compareData.dirA} />
                        <CompareCell side={row.right} variant="right" dir={compareData.dirB} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
