import React from "react";
import { Trash2, Edit3, Copy } from "lucide-react";
import { VaultEntry, Settings } from "../types";
import { getTranslation } from "../utils/i18n";
import { isArabicText } from "../utils";

interface EntryCardProps {
  entry: VaultEntry;
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  settings: Settings | null;
}

export const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  onOpenClarify,
  onDeleteEntry,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const isScratchpad = entry.source_file === "scratchpad";
  const isNote = entry.family === "note";
  const isArName = isArabicText(entry.name);
  // Notes show their full body (entry.notes) which may differ from value.
  const noteBody = entry.notes && entry.notes.trim() ? entry.notes : entry.value;
  const isArVal = isArabicText(isNote ? noteBody : entry.value);

  return (
    <div
      className={`rounded-xl p-3 flex ${isNote ? "items-start" : "items-center"} justify-between gap-3 group transition-all`}
      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}
    >
      <div className={`flex ${isNote ? "items-start" : "items-center"} gap-3 min-w-0`}>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: entry.needsClarification ? "var(--amber)" : "var(--emerald)" }}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase font-semibold" style={{ color: "var(--text-muted)" }}>{entry.type}</span>
            <span
              className={`text-xs font-medium truncate ${isArName ? "font-arabic ar-text" : ""}`}
              dir={isArName ? "rtl" : "auto"}
              lang={isArName ? "ar" : undefined}
              style={{ color: "var(--text)" }}
            >
              {entry.name}
            </span>
            {isScratchpad && (
              <span
                className="text-[9px] px-1.5 py-0.5 rounded"
                style={{ color: "var(--accent-bright)", background: "var(--accent-bg)" }}
              >
                {entry.notes === "archived" ? t("scratchpad_archived") : t("tab_scratchpad")}
              </span>
            )}
          </div>
          {isNote ? (
            <div
              className={`text-sm leading-relaxed select-text whitespace-pre-wrap break-words max-h-40 overflow-y-auto ${isArVal ? "font-arabic ar-text" : ""}`}
              dir="auto"
              lang={isArVal ? "ar" : undefined}
              style={{ color: "var(--text)", fontFamily: isArVal ? "var(--font-arabic)" : "var(--font-sans)" }}
            >
              {noteBody}
            </div>
          ) : (
            <div
              className={`text-[11px] truncate max-w-md ${isArVal ? "font-arabic ar-text" : ""}`}
              dir={isArVal ? "rtl" : "auto"}
              lang={isArVal ? "ar" : undefined}
              style={{ color: "var(--emerald)", fontFamily: isArVal ? "var(--font-arabic)" : "var(--font-mono)" }}
            >
              {entry.value.slice(0, 80)}{entry.value.length > 80 ? "…" : ""}
            </div>
          )}
        </div>
      </div>
      <div className={`flex ${isNote ? "items-start" : "items-center"} gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity`}>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(isNote ? noteBody : entry.value)}
          className="p-1.5 rounded-lg transition-all"
          style={{ color: "var(--text-muted)", background: "var(--bg-input)" }}
          title={t("copy")}
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
        {!isScratchpad && (
          <button
            type="button"
            onClick={() => onOpenClarify(entry)}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: "var(--cyan)", background: "var(--bg-input)" }}
            title={t("identify")}
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
        )}
        {!isScratchpad && (
          <button
            type="button"
            onClick={() => onDeleteEntry(entry.id)}
            className="p-1.5 rounded-lg transition-all"
            style={{ color: "var(--danger)", background: "var(--bg-input)" }}
            title={t("hide")}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
};
