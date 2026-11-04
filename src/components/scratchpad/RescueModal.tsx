import { useId, type Dispatch, type SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";
import { createPortal } from "react-dom";
import { LifeBuoy, X, Loader2 } from "lucide-react";
import { htmlToPlainText } from "../../lib/noteHtml";
import { useDialogA11y } from "../../hooks/useDialogA11y";

export interface RescueModalProps {
  rescueList: any[];
  rescueLoading: boolean;
  rescueOpen: boolean;
  rescueQuery: string;
  restoreOrphan: (tabId: string, content: string) => Promise<void>;
  setRescueOpen: Dispatch<SetStateAction<boolean>>;
  setRescueQuery: Dispatch<SetStateAction<string>>;
  t: (key: keyof TranslationDict) => string;
}

export function RescueModal({ rescueList, rescueLoading, rescueOpen, rescueQuery, restoreOrphan, setRescueOpen, setRescueQuery, t }: RescueModalProps) {
  const dialogRef = useDialogA11y(rescueOpen, () => setRescueOpen(false));
  const titleId = useId();
  return (
    <>
      {/* Rescue unsaved notes from orphaned revision snapshots. */}
      {rescueOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(6px)" }}
            onClick={() => setRescueOpen(false)}
          >
            <div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="w-full max-w-3xl max-h-[85vh] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
              style={{ background: "#121214", border: "1px solid rgba(255,255,255,0.12)" }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div
                className="px-5 py-4 flex items-center justify-between border-b"
                style={{ borderColor: "rgba(255,255,255,0.08)", background: "#18181b" }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                    <LifeBuoy className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 id={titleId} className="text-sm font-bold text-white">{t("scratchpad_rescue_title")}</h3>
                    <p className="text-xs text-neutral-400 max-w-lg">{t("scratchpad_rescue_desc")}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setRescueOpen(false)}
                  aria-label={t("close_btn")}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Search + list */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2" style={{ background: "#0e0e10" }}>
                <input
                  type="text"
                  value={rescueQuery}
                  onChange={(e) => setRescueQuery(e.target.value)}
                  placeholder={t("rescue_search_placeholder")}
                  aria-label={t("rescue_search_placeholder")}
                  className="px-3 py-2 rounded-lg text-xs"
                  style={{ background: "#1e1e22", border: "1px solid rgba(255,255,255,0.12)", color: "var(--text)" }}
                />
                {rescueLoading ? (
                  <div className="flex items-center justify-center gap-2 py-10 text-xs text-neutral-500">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t("rescue_scanning")}</span>
                  </div>
                ) : rescueList.length === 0 ? (
                  <div className="py-10 text-center text-xs text-neutral-500">{t("scratchpad_rescue_empty")}</div>
                ) : (
                  (() => {
                    const q = rescueQuery.trim().toLowerCase();
                    const filtered = q
                      ? rescueList.filter(
                          (o) =>
                            String(o.title || "").toLowerCase().includes(q) ||
                            htmlToPlainText(String(o.lastContent || "")).toLowerCase().includes(q)
                        )
                      : rescueList;
                    if (filtered.length === 0) {
                      return <div className="py-10 text-center text-xs text-neutral-500">{t("scratchpad_rescue_empty")}</div>;
                    }
                    return filtered.map((o) => {
                      const when = new Date(Number(o.timestamp) || 0);
                      const dayStr = when.toLocaleDateString([], { month: "short", day: "numeric" });
                      const timeStr = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                      const preview = htmlToPlainText(String(o.lastContent || "")).trim().slice(0, 140);
                      return (
                        <div
                          key={o.tabId}
                          className="p-3 rounded-xl flex flex-col gap-2"
                          style={{ background: "#17171a", border: "1px solid rgba(255,255,255,0.08)" }}
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs font-bold text-white truncate max-w-[280px]">{o.title || t("family_note")}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono" style={{ background: "rgba(255,255,255,0.07)", color: "#a1a1aa" }}>
                              {dayStr} {timeStr}
                            </span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md font-mono" style={{ background: "rgba(99,102,241,0.15)", color: "#a5b4fc" }}>
                              {o.revisionCount} {o.revisionCount === 1 ? t("rescue_snapshot_one") : t("rescue_snapshot_many")}
                            </span>
                            <div className="flex-1" />
                            <button
                              type="button"
                              onClick={() => { void restoreOrphan(o.tabId, String(o.lastContent || "")); }}
                              className="px-2.5 py-1 rounded-lg text-xs font-bold cursor-pointer"
                              style={{ background: "rgba(52,211,153,0.18)", color: "#6ee7b7", border: "1px solid rgba(52,211,153,0.4)" }}
                            >
                              {t("scratchpad_rescue_restore")}
                            </button>
                          </div>
                          {preview && (
                            <p className="text-[11px] leading-relaxed text-neutral-400 line-clamp-2" dir="auto">{preview}</p>
                          )}
                        </div>
                      );
                    });
                  })()
                )}
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
