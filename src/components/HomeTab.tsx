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
    <div className="space-y-6">
      <div className="rounded-2xl p-5 space-y-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", backdropFilter: "blur(10px)" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          <Plus className="w-4 h-4" style={{ color: "var(--cyan)" }} /> {t("quick_paste")}
        </h2>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={4}
          placeholder={t("paste_placeholder")}
          className="w-full rounded-xl px-3 py-2 text-sm focus:outline-none transition-colors resize-none"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
        />
        <button
          type="button"
          onClick={onAnalyze}
          disabled={analyzing || !paste.trim()}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 flex items-center gap-2 transition-all"
          style={{ background: "linear-gradient(135deg, var(--accent), #1d4ed8)", boxShadow: "0 0 20px var(--accent-glow)" }}
        >
          <Sparkles className="w-4 h-4" />
          {analyzing ? t("analyzing") : t("analyze_btn")}
        </button>
      </div>

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
