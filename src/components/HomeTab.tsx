import React from "react";
import { Plus, Sparkles, Inbox, Save, SkipForward } from "lucide-react";
import { VaultEntry, AnalyzeCandidate, Settings } from "../types";
import type { SystemStatus, HealthReport, FolderScanSession, LibraryFilter } from "../types";
import { KpiTiles, HealthCard, VaultMixCard, ServicesCard, RecentList } from "./home/DashboardCards";
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
  onDiscardCandidate?: (tempId: string) => void;
  attention: VaultEntry[];
  entries: VaultEntry[];
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  settings: Settings | null;
  status: SystemStatus | null;
  health: HealthReport | null;
  scanSession: FolderScanSession | null;
  encrypted: boolean;
  onOpenLibrary: (filter: LibraryFilter) => void;
  onOpenHealth: () => void;
  onOpenFolders: () => void;
  onOpenSettings: () => void;
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
  onDiscardCandidate,
  attention,
  entries,
  onOpenClarify,
  onDeleteEntry,
  settings,
  status,
  health,
  scanSession,
  encrypted,
  onOpenLibrary,
  onOpenHealth,
  onOpenFolders,
  onOpenSettings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const handleAnalyze = async () => {
    await onAnalyze();
    onOpenAnalyzeTab();
  };

  const lang = settings?.ui_language === "ar" ? "ar" : "en";
  const hour = new Date().getHours();
  const greeting = hour < 12 ? t("home_good_morning") : hour < 18 ? t("home_good_afternoon") : t("home_good_evening");
  // Info-level issues (no backup yet, AI offline) don't make the vault unhealthy.
  const healthy = !health || health.overall !== "attention";
  const today = new Date().toLocaleDateString(lang === "ar" ? "ar" : "en", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-6 max-w-[1280px]">
      <header className="flex flex-col gap-1">
        <span className="text-[13px]" style={{ color: "var(--text-muted)" }}>{today}</span>
        <h1 className="text-2xl md:text-[28px] font-bold tracking-tight" style={{ color: "var(--text)" }}>
          {greeting}. {healthy ? t("home_sub_healthy") : t("home_sub_attention")}
        </h1>
      </header>

      <KpiTiles entries={entries} status={status} encrypted={encrypted} t={t} onOpen={onOpenLibrary} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] items-start">
      <div className="space-y-5 min-w-0">
      <div className="app-card p-5 space-y-3" style={{ backdropFilter: "blur(10px)" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Plus className="w-4 h-4" style={{ color: "var(--cyan)" }} /> {t("quick_paste")}
          </h2>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{t("quick_capture_hint")}</span>
          </div>
          {providerUsed && (
            <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>via {providerUsed}</span>
          )}
        </div>
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          // Pasted secrets must never reach the OS spellchecker or its
          // "Add to dictionary" list (plaintext in the Chromium profile).
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          rows={4}
          placeholder={t("paste_placeholder")}
          className="app-input w-full px-3 py-2 text-sm resize-none"
          style={{ fontFamily: "var(--font-mono)" }}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing || !paste.trim()}
            className="btn-primary px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 disabled:pointer-events-none flex items-center gap-2"
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

      {analyzing && (
        <div className="app-card p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 animate-spin text-accent-bright" />
            <span className="text-xs font-semibold" style={{ color: "var(--accent-bright)" }}>
              {t("analyzing") || "Analyzing text with heuristics & AI..."}
            </span>
          </div>
          <div className="space-y-2">
            <div className="skeleton h-12 w-full rounded-xl" />
            <div className="skeleton h-12 w-full rounded-xl" />
          </div>
        </div>
      )}

       {candidates.length > 0 && (
          <div className="app-card p-4 space-y-3">
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
              onDiscard={onDiscardCandidate}
              settings={settings}
            />
          ))}
        </div>
      )}

        {attention.length > 0 && (
          <div className="app-card p-4 space-y-3">
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

        <RecentList entries={entries} lang={lang} t={t} onOpenLibrary={() => onOpenLibrary("all")} />
      </div>

      <aside className="space-y-5 min-w-0">
        <HealthCard health={health} t={t} onOpenDetails={onOpenHealth} />
        <VaultMixCard status={status} t={t} />
        <ServicesCard status={status} settings={settings} scanSession={scanSession} t={t} onOpenFolders={onOpenFolders} onOpenSettings={onOpenSettings} />
      </aside>
      </div>
    </div>
  );
};
