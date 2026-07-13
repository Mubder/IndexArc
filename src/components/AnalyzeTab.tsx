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
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-white">{t("tab_paste")}</h2>
          {providerUsed && (
            <span className="text-[11px] font-mono text-slate-400">via {providerUsed}</span>
          )}
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-500"
          placeholder={t("paste_placeholder")}
        />
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing || !paste.trim()}
          className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium disabled:opacity-50"
        >
          {analyzing ? t("analyzing") : t("re_analyze_btn")}
        </button>
      </div>

      {candidates.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">
              {t("candidates_title")} ({candidates.length})
            </h3>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onSaveSelected(false)}
                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium flex items-center gap-1"
              >
                <Save className="w-3.5 h-3.5" /> {t("save_selected_btn")}
              </button>
              <button
                type="button"
                onClick={() => onSaveSelected(true)}
                className="px-3 py-1.5 rounded-lg bg-amber-700/80 hover:bg-amber-600 text-xs font-medium flex items-center gap-1"
                title={t("park_incomplete_title")}
              >
                <SkipForward className="w-3.5 h-3.5" /> {t("park_incomplete_btn")}
              </button>
            </div>
          </div>

          {candidates.map((c) => (
            <div
              key={c.temp_id}
              className={`border rounded-xl p-4 space-y-3 ${
                c.ready
                  ? "bg-slate-900/60 border-slate-700"
                  : "bg-amber-950/20 border-amber-500/30"
              }`}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!selected[c.temp_id]}
                  onChange={(e) =>
                    setSelected((s) => ({ ...s, [c.temp_id]: e.target.checked }))
                  }
                />
                <span className="text-[10px] uppercase text-slate-400">{c.family}</span>
                <span className="text-[10px] text-slate-500">
                  {t("confidence_label")} {Math.round(c.confidence * 100)}%
                </span>
                {!c.ready && (
                  <span className="text-[10px] text-amber-300 flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    {c.needs_type && t("needs_type_label")}
                    {c.needs_type && c.needs_name && " · "}
                    {c.needs_name && t("needs_name_label")}
                  </span>
                )}
                {c.ready && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle className="w-3 h-3" /> {t("ready_label")}
                  </span>
                )}
              </div>
              <div className="font-mono text-sm text-emerald-300 bg-slate-950 rounded-lg px-3 py-2 break-all">
                {c.value}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="text-xs space-y-1 block">
                  <span className="text-slate-400">{t("type_label")}</span>
                  <input
                    value={c.type}
                    onChange={(e) => onUpdateCandidate(c.temp_id, { type: e.target.value })}
                    placeholder={t("type_placeholder")}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                  />
                </label>
                <label className="text-xs space-y-1 block">
                  <span className="text-slate-400">{t("name_label_secrets")}</span>
                  <input
                    value={c.name}
                    onChange={(e) => onUpdateCandidate(c.temp_id, { name: e.target.value })}
                    placeholder={t("name_placeholder")}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px]">
                {(["secret", "command", "note", "unknown"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => onUpdateCandidate(c.temp_id, { family: f })}
                    className={`px-2 py-0.5 rounded border ${
                      c.family === f
                        ? "border-indigo-500 text-indigo-300 bg-indigo-500/10"
                        : "border-slate-700 text-slate-500"
                    }`}
                  >
                    {f}
                  </button>
                ))}
              </div>
              {c.model_notes && (
                <p className="text-[11px] text-slate-500">{c.model_notes}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {!candidates.length && (
        <p className="text-sm text-slate-500 flex items-center gap-2">
          <HelpCircle className="w-4 h-4" />
          {t("analyze_tab_desc")}
        </p>
      )}
    </div>
  );
};
