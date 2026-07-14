import React from "react";
import { AlertCircle, CheckCircle, HelpCircle, Save, SkipForward } from "lucide-react";
import { AnalyzeCandidate, Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface AnalyzeTabProps {
  paste: string;
  setPaste: (v: string) => void;
  onAnalyze: () => Promise<void>;
  analyzing: boolean;
  providerUsed: string;
  candidates: AnalyzeCandidate[];
  selected: Record<string, boolean>;
  setSelected: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSaveSelected: (parkIncomplete: boolean) => Promise<void>;
  onUpdateCandidate: (tempId: string, patch: Partial<AnalyzeCandidate>) => void;
  settings: Settings | null;
}

export const AnalyzeTab: React.FC<AnalyzeTabProps> = ({
  paste,
  setPaste,
  onAnalyze,
  analyzing,
  providerUsed,
  candidates,
  selected,
  setSelected,
  onSaveSelected,
  onUpdateCandidate,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("tab_paste")}</h2>
          {providerUsed && (
            <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>via {providerUsed}</span>
          )}
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none transition-colors resize-none"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
          placeholder={t("paste_placeholder")}
        />
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing || !paste.trim()}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 transition-all"
          style={{ background: "linear-gradient(135deg, var(--accent), #1d4ed8)", boxShadow: "0 0 20px var(--accent-glow)" }}
        >
          {analyzing ? t("analyzing") : t("re_analyze_btn")}
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              {t("candidates_title")} ({candidates.length})
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onSaveSelected(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                style={{ background: "var(--emerald-bg)", color: "var(--emerald)", border: "1px solid rgba(52, 211, 153, 0.2)" }}
              >
                <Save className="w-3.5 h-3.5" /> {t("save_selected_btn")}
              </button>
              <button
                type="button"
                onClick={() => onSaveSelected(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all"
                style={{ background: "var(--amber-bg)", color: "var(--amber)", border: "1px solid rgba(251, 191, 36, 0.2)" }}
                title={t("park_incomplete_title")}
              >
                <SkipForward className="w-3.5 h-3.5" /> {t("park_incomplete_btn")}
              </button>
            </div>
          </div>

          {candidates.map((c) => (
            <div
              key={c.temp_id}
              className="rounded-xl p-4 space-y-3 transition-all"
              style={{
                background: c.ready ? "var(--bg-surface)" : "var(--amber-bg)",
                border: `1px solid ${c.ready ? "var(--border)" : "rgba(251, 191, 36, 0.2)"}`,
              }}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!selected[c.temp_id]}
                  onChange={(e) => setSelected((s) => ({ ...s, [c.temp_id]: e.target.checked }))}
                />
                <span className="text-[10px] uppercase" style={{ color: "var(--text-dim)" }}>{c.family}</span>
                <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {t("confidence_label")} {Math.round(c.confidence * 100)}%
                </span>
                {!c.ready && (
                  <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--amber)" }}>
                    <AlertCircle className="w-3 h-3" />
                    {c.needs_type && t("needs_type_label")}
                    {c.needs_type && c.needs_name && " · "}
                    {c.needs_name && t("needs_name_label")}
                  </span>
                )}
                {c.ready && (
                  <span className="text-[10px] flex items-center gap-1" style={{ color: "var(--emerald)" }}>
                    <CheckCircle className="w-3 h-3" /> {t("ready_label")}
                  </span>
                )}
              </div>
              <div className="rounded-lg px-3 py-2 break-all" style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", color: "var(--emerald)", background: "var(--bg-input)", border: "1px solid var(--border)" }}>
                {c.value}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs space-y-1 block">
                  <span style={{ color: "var(--text-dim)" }}>{t("type_label")}</span>
                  <input
                    value={c.type}
                    onChange={(e) => onUpdateCandidate(c.temp_id, { type: e.target.value })}
                    placeholder={t("type_placeholder")}
                    className="w-full rounded-lg px-2 py-1.5 text-sm focus:outline-none"
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                  />
                </label>
                <label className="text-xs space-y-1 block">
                  <span style={{ color: "var(--text-dim)" }}>{t("name_label_secrets")}</span>
                  <input
                    value={c.name}
                    onChange={(e) => onUpdateCandidate(c.temp_id, { name: e.target.value })}
                    placeholder={t("name_placeholder")}
                    className="w-full rounded-lg px-2 py-1.5 text-sm focus:outline-none"
                    style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {(["secret", "command", "note", "unknown"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onUpdateCandidate(c.temp_id, { family: f })}
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
              {c.model_notes && (
                <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>{c.model_notes}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!candidates.length && (
        <p className="text-sm flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
          <HelpCircle className="w-4 h-4" />
          {t("analyze_tab_desc")}
        </p>
      )}
    </div>
  );
};
