import React from "react";
import { Trash2, Edit3, Copy, Maximize2, FileText, KeyRound, Terminal, Compass } from "lucide-react";
import { VaultEntry, Settings } from "../types";
import { getTranslation } from "../utils/i18n";
import { isArabicText } from "../utils";

interface EntryCardProps {
  entry: VaultEntry;
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  onOpenDetail?: (entry: VaultEntry) => void;
  settings: Settings | null;
  viewMode?: "list" | "grid";
  score?: number;
  reason?: string;
}

export const EntryCard: React.FC<EntryCardProps> = ({
  entry,
  onOpenClarify,
  onDeleteEntry,
  onOpenDetail,
  settings,
  viewMode = "list",
  score,
  reason,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const isScratchpad = entry.source_file === "scratchpad";
  const isNote = entry.family === "note";
  const isSecret = entry.family === "secret";
  const isCmd = entry.family === "command";
  const isArName = isArabicText(entry.name);

  // Notes show entry.notes or value
  const noteBody = entry.notes && entry.notes.trim() ? entry.notes : entry.value;
  const isArVal = isArabicText(isNote ? noteBody : entry.value);

  const charCount = noteBody.length;
  const wordCount = noteBody.trim().split(/\s+/).filter(Boolean).length;

  return (
    <div
      onClick={() => isNote && onOpenDetail?.(entry)}
      className={`rounded-xl p-3.5 flex flex-col justify-between gap-3 group transition-all cursor-pointer hover:border-[var(--accent-bright)] hover:shadow-lg ${
        viewMode === "grid" ? "h-full min-h-[160px]" : ""
      }`}
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        backdropFilter: "blur(10px)",
      }}
    >
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="p-1.5 rounded-lg shrink-0"
            style={{
              background: isNote
                ? "var(--accent-bg)"
                : isSecret
                ? "var(--amber-bg)"
                : isCmd
                ? "rgba(34, 211, 238, 0.1)"
                : "var(--bg-input)",
              color: isNote
                ? "var(--accent-bright)"
                : isSecret
                ? "var(--amber)"
                : isCmd
                ? "var(--cyan)"
                : "var(--text-muted)",
            }}
          >
            {isNote && <FileText className="w-4 h-4" />}
            {isSecret && <KeyRound className="w-4 h-4" />}
            {isCmd && <Terminal className="w-4 h-4" />}
            {!isNote && !isSecret && !isCmd && <Compass className="w-4 h-4" />}
          </div>

          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase font-semibold" style={{ color: "var(--text-muted)" }}>
                {entry.type}
              </span>
              <span
                className={`text-xs font-semibold truncate ${isArName ? "font-arabic ar-text" : ""}`}
                dir={isArName ? "rtl" : "auto"}
                lang={isArName ? "ar" : undefined}
                style={{ color: "var(--text)" }}
              >
                {entry.name}
              </span>
              {isScratchpad && (
                <span
                  className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                  style={{ color: "var(--accent-bright)", background: "var(--accent-bg)" }}
                >
                  {entry.notes === "archived" ? t("scratchpad_archived") : t("tab_scratchpad")}
                </span>
              )}
            </div>
            {isNote && (
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {wordCount} words • {charCount} chars
              </div>
            )}
          </div>
        </div>

        {/* Action Buttons */}
        <div
          className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={(e) => e.stopPropagation()}
        >
          {isNote && onOpenDetail && (
            <button
              type="button"
              onClick={() => onOpenDetail(entry)}
              className="p-1.5 rounded-lg transition-all hover:scale-105"
              style={{ color: "var(--accent-bright)", background: "var(--accent-bg)" }}
              title="Open Full Note"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

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

      {/* Note or Key Value Preview */}
      <div className="mt-2">
        {isNote ? (
          <div
            className={`text-xs leading-relaxed select-text whitespace-pre-wrap break-words max-h-24 overflow-hidden text-ellipsis ${
              isArVal ? "font-arabic ar-text" : ""
            }`}
            dir="auto"
            lang={isArVal ? "ar" : undefined}
            style={{ color: "var(--text-dim)" }}
          >
            {noteBody.length > 220 ? noteBody.slice(0, 220) + "..." : noteBody}
          </div>
        ) : (
          <div
            className={`text-[11px] truncate max-w-md ${isArVal ? "font-arabic ar-text" : ""}`}
            dir={isArVal ? "rtl" : "auto"}
            lang={isArVal ? "ar" : undefined}
            style={{ color: "var(--emerald)", fontFamily: isArVal ? "var(--font-arabic)" : "var(--font-mono)" }}
          >
            {entry.value.slice(0, 80)}
            {entry.value.length > 80 ? "…" : ""}
          </div>
        )}
      </div>
    </div>
  );
};
