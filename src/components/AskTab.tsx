import React from "react";
import { Sparkles } from "lucide-react";
import { VaultEntry, Settings } from "../types";
import { EntryCard } from "./EntryCard";
import { getTranslation } from "../utils/i18n";

interface AskTabProps {
  query: string;
  setQuery: (v: string) => void;
  onAsk: (e?: React.FormEvent) => Promise<void>;
  asking: boolean;
  askResults: { entry: VaultEntry; score: number; match_reason: string }[];
  answer?: string | null;
  providerUsed?: string;
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  settings: Settings | null;
}

export const AskTab: React.FC<AskTabProps> = ({
  query,
  setQuery,
  onAsk,
  asking,
  askResults,
  answer,
  providerUsed,
  onOpenClarify,
  onDeleteEntry,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  return (
    <div className="space-y-4">
      <form onSubmit={onAsk} className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
          placeholder={t("ask_header_placeholder")}
        />
        <button
          type="submit"
          disabled={asking}
          className="px-4 py-2 rounded-xl bg-pink-600 hover:bg-pink-500 text-sm font-medium disabled:opacity-50"
        >
          {asking ? "…" : t("ask_btn")}
        </button>
      </form>

      {answer && (
        <div className="bg-gradient-to-r from-indigo-950/30 via-slate-900 to-slate-900 border border-indigo-500/20 rounded-2xl p-5 shadow-xl space-y-3 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-4 opacity-[0.03] pointer-events-none">
            <Sparkles className="w-24 h-24 text-indigo-400" />
          </div>
          <div className="flex items-center gap-2 text-indigo-400">
            <Sparkles className="w-4 h-4 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider">{t("assistant_answer_title")}</span>
          </div>
          <div className="whitespace-pre-wrap text-sm text-slate-200 leading-relaxed font-sans select-text">
            {answer}
          </div>
          {providerUsed && (
            <div className="pt-2.5 border-t border-slate-800/80 flex justify-between items-center text-[10px] text-slate-500">
              <span>{t("bilingual_synth_footer")}</span>
              <span className="font-mono text-[9px] text-slate-500">{providerUsed}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        {askResults.map((r) => (
          <EntryCard
            key={r.entry.id}
            entry={r.entry}
            score={r.score}
            reason={r.match_reason}
            onOpenClarify={onOpenClarify}
            onDeleteEntry={onDeleteEntry}
            settings={settings}
          />
        ))}
        {!askResults.length && !answer && (
          <p className="text-sm text-slate-500 italic">{t("no_ask_results")}</p>
        )}
      </div>
    </div>
  );
};
