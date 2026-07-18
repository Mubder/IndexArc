import React from "react";
import { AlertCircle, CheckCircle } from "lucide-react";
import { AnalyzeCandidate, Settings } from "../types";
import { getTranslation } from "../utils/i18n";

export type CandidateFamily = AnalyzeCandidate["family"];

interface CandidateCardProps {
  candidate: AnalyzeCandidate;
  selected?: boolean;
  onToggleSelect?: (tempId: string, checked: boolean) => void;
  onUpdate: (tempId: string, patch: Partial<AnalyzeCandidate>) => void;
  settings: Settings | null;
  /** Optional source badge (used by folder-scan candidates). */
  sourceName?: string;
  /** Render the family chips toggle (Home/Analyze). Hidden for folder scans. */
  showFamilyChips?: boolean;
  /** Optional custom footer (e.g. folder-scan decision buttons). */
  footer?: React.ReactNode;
  /** Highlight style override (folder discard, etc.). */
  styleOverride?: React.CSSProperties;
}

export const CandidateCard: React.FC<CandidateCardProps> = ({
  candidate: c,
  selected,
  onToggleSelect,
  onUpdate,
  settings,
  sourceName,
  showFamilyChips = true,
  footer,
  styleOverride,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  return (
    <div
      className="rounded-xl p-4 space-y-3 transition-all"
      style={{
        background: c.ready ? "var(--bg-surface)" : "var(--amber-bg)",
        border: `1px solid ${c.ready ? "var(--border)" : "rgba(251, 191, 36, 0.2)"}`,
        ...styleOverride,
      }}
    >
      <div className="flex flex-wrap items-center gap-2 text-[10px]">
        {onToggleSelect && (
          <input
            type="checkbox"
            checked={!!selected}
            onChange={(e) => onToggleSelect(c.temp_id, e.target.checked)}
          />
        )}
        <span className="uppercase" style={{ color: "var(--text-dim)" }}>{c.family}</span>
        <span style={{ color: "var(--text-muted)" }}>
          {t("confidence_label")} {Math.round(c.confidence * 100)}%
        </span>
        {sourceName && (
          <span
            className="px-1.5 py-0.5 rounded"
            style={{ fontFamily: "var(--font-mono)", color: "var(--accent-bright)", background: "var(--accent-bg)" }}
          >
            {sourceName}
          </span>
        )}
        {!c.ready && (
          <span className="flex items-center gap-1" style={{ color: "var(--amber)" }}>
            <AlertCircle className="w-3 h-3" />
            {c.needs_type && t("needs_type_label")}
            {c.needs_type && c.needs_name && " · "}
            {c.needs_name && t("needs_name_label")}
          </span>
        )}
        {c.ready && (
          <span className="flex items-center gap-1" style={{ color: "var(--emerald)" }}>
            <CheckCircle className="w-3 h-3" /> {t("ready_label")}
          </span>
        )}
      </div>

      <div
        className="rounded-lg px-3 py-2 break-all"
        style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", color: "var(--emerald)", background: "var(--bg-input)", border: "1px solid var(--border)" }}
      >
        {c.value}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="text-xs space-y-1 block">
          <span style={{ color: "var(--text-dim)" }}>{t("type_label")}</span>
          <input
            value={c.type}
            onChange={(e) => onUpdate(c.temp_id, { type: e.target.value })}
            placeholder={t("type_placeholder")}
            className="w-full rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
          />
        </label>
        <label className="text-xs space-y-1 block">
          <span style={{ color: "var(--text-dim)" }}>{t("name_label_secrets")}</span>
          <input
            value={c.name}
            onChange={(e) => onUpdate(c.temp_id, { name: e.target.value })}
            placeholder={t("name_placeholder")}
            className="w-full rounded-lg px-2 py-1.5 text-sm focus:outline-none"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
          />
        </label>
      </div>

      {showFamilyChips && (
        <div className="flex flex-wrap gap-2 text-[11px]">
          {(["secret", "command", "note", "unknown"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onUpdate(c.temp_id, { family: f })}
              className="px-2 py-0.5 rounded border transition-all"
              style={{
                borderColor: c.family === f ? "var(--border-glow)" : "var(--border)",
                color: c.family === f ? "var(--accent-bright)" : "var(--text-muted)",
                background: c.family === f ? "var(--accent-bg)" : "transparent",
              }}
            >
              {f}
            </button>
          ))}
        </div>
      )}

      {c.model_notes && (
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{c.model_notes}</p>
      )}

      {footer}
    </div>
  );
};

export default CandidateCard;
