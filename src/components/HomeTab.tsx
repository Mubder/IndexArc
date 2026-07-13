import React from "react";
import { Plus, Sparkles, Inbox } from "lucide-react";
import { VaultEntry, Settings } from "../types";
import { EntryCard } from "./EntryCard";
import { getTranslation } from "../utils/i18n";

interface HomeTabProps {
  paste: string;
  setPaste: (v: string) => void;
  onAnalyze: () => Promise<void>;
  analyzing: boolean;
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
  analyzing,
  attention,
  entries,
  onOpenClarify,
  onDeleteEntry,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  return (
    <>
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          <Plus className="w-4 h-4 text-teal-400" /> {t("quick_paste")}
        </h2>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
          placeholder={t("paste_placeholder")}
          className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-teal-500"
        />
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing || !paste.trim()}
          className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-sm font-medium disabled:opacity-50 flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          {analyzing ? t("analyzing") : t("analyze_btn")}
        </button>
      </div>

      {attention.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-amber-300 flex items-center gap-2">
            <Inbox className="w-4 h-4" />
            {t("attention_title")} ({attention.length})
          </h2>
          <p className="text-xs text-slate-500">
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
        <h2 className="text-sm font-semibold text-slate-300">{t("recent_saved")}</h2>
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
            <p className="text-sm text-slate-500 italic">{t("no_saved")}</p>
          )}
        </div>
      </div>
    </>
  );
};
