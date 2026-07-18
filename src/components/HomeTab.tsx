import React from "react";
import { Plus, Sparkles, Inbox, Save, SkipForward } from "lucide-react";
import { VaultEntry, AnalyzeCandidate, Settings } from "../types";
import { EntryCard } from "./EntryCard";
import { CandidateCard } from "./CandidateCard";
import { getTranslation } from "../utils/i18n";

interface HomeTabProps {
  paste: string;
  setPaste: (v: string) => void;
  onAnalyze: () => Promise<void>;
  onOpenAnalyzeTab: () => void;
  analyzing: boolean;
  providerUsed: string;
  candidates: AnalyzeCandidate[];
  selected: Record<string, boolean>;
  setSelected: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  onSaveSelected: (parkIncomplete: boolean) => Promise<void>;
  onUpdateCandidate: (tempId: string, patch: Partial<AnalyzeCandidate>) => void;
  attention: VaultEntry[];
  entries: VaultEntry[];
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  settings: Settings | null;
}

export const HomeTab: React.FC<HomeTabProps> = ({
  paste,
  setPaste,
  onAnalyze,
  onOpenAnalyzeTab,
  analyzing,
  providerUsed,
  candidates,
  selected,
  setSelected,
  onSaveSelected,
  onUpdateCandidate,
  attention,
  entries,
  onOpenClarify,
  onDeleteEntry,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const handleAnalyze = async () => {
    await onAnalyze();
    onOpenAnalyzeTab();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Plus className="w-4 h-4" style={{ color: "var(--cyan)" }} /> {t("quick_paste")}
          </h2>
          {providerUsed && (
            <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>via {providerUsed}</span>
          )}
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
          placeholder={t("paste_placeholder")}
          className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none transition-colors resize-none"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing || !paste.trim()}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2 transition-all"
            style={{ background: "linear-gradient(135deg, var(--accent), #1d4ed8)", boxShadow: "0 0 20px var(--accent-glow)" }}
          >
            <Sparkles className="w-4 h-4" />
            {analyzing ? t("analyzing") : t("analyze_btn")}
          </button>
          <button
            type="button"
            onClick={onOpenAnalyzeTab}
            disabled={!candidates.length}
            className="px-4 py-2 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
            style={{ color: "var(--accent-bright)", border: "1px solid var(--border-glow)", background: "var(--accent-bg)" }}
          >
            {t("open_analyze_tab")} ({candidates.length})
          </button>
        </div>
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
            <CandidateCard
              key={c.temp_id}
              candidate={c}
              selected={selected[c.temp_id]}
              onToggleSelect={(id, checked) => setSelected((s) => ({ ...s, [id]: checked }))}
              onUpdate={onUpdateCandidate}
              settings={settings}
            />
          ))}
        </div>
      )}

      {attention.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--amber)" }}>
            <Inbox className="w-4 h-4" />
            {t("attention_title")} ({attention.length})
          </h2>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>
            {t("attention_desc")}
          </p>
          <div className="space-y-2">
            {attention.map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                onOpenClarify={onOpenClarify}
                onDeleteEntry={onDeleteEntry}
                settings={settings}
              />
            ))}
          </div>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("recent_saved")}</h2>
        <div className="space-y-2">
          {entries
            .filter((e) => e.status === "saved")
            .slice(0, 8)
            .map((e) => (
              <EntryCard
                key={e.id}
                entry={e}
                onOpenClarify={onOpenClarify}
                onDeleteEntry={onDeleteEntry}
                settings={settings}
              />
            ))}
          {!entries.filter((e) => e.status === "saved").length && (
            <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>{t("no_saved")}</p>
          )}
        </div>
      </div>
    </div>
  );
};
