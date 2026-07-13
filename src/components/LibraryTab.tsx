import React, { useMemo } from "react";
import { HelpCircle, KeyRound, LayoutGrid, RefreshCw, Search, StickyNote, Terminal, Inbox } from "lucide-react";
import { LibraryFilter, VaultEntry, Settings } from "../types";
import { EntryCard } from "./EntryCard";
import { getTranslation } from "../utils/i18n";

interface LibraryTabProps {
  entries: VaultEntry[];
  libraryFilter: LibraryFilter;
  setLibraryFilter: (v: LibraryFilter) => void;
  libraryQuery: string;
  setLibraryQuery: (v: string) => void;
  onFetchAll: () => Promise<void>;
  onOpenClarify: (entry: VaultEntry) => void;
  onDeleteEntry: (id: string) => Promise<void>;
  settings: Settings | null;
}

export const LibraryTab: React.FC<LibraryTabProps> = ({
  entries,
  libraryFilter,
  setLibraryFilter,
  libraryQuery,
  setLibraryQuery,
  onFetchAll,
  onOpenClarify,
  onDeleteEntry,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const libraryCounts = useMemo(() => {
    const c = {
      all: entries.length,
      secret: 0,
      command: 0,
      note: 0,
      unknown: 0,
      attention: 0,
    };
    for (const e of entries) {
      if (e.family === "secret") c.secret++;
      else if (e.family === "command") c.command++;
      else if (e.family === "note") c.note++;
      else if (e.family === "unknown") c.unknown++;
      if (e.status !== "saved") c.attention++;
    }
    return c;
  }, [entries]);

  const libraryFiltered = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    return entries.filter((e) => {
      if (libraryFilter === "attention") {
        if (e.status === "saved") return false;
      } else if (libraryFilter !== "all" && e.family !== libraryFilter) {
         return false;
      }
      if (!q) return true;
      const blob = `${e.name} ${e.type} ${e.value} ${e.raw_fragment} ${(e.labels || []).join(" ")}`.toLowerCase();
      return blob.includes(q);
    });
  }, [entries, libraryFilter, libraryQuery]);

  const libraryChips: {
    id: LibraryFilter;
    label: string;
    icon: React.ReactNode;
    activeClass: string;
  }[] = [
    {
      id: "all",
      label: t("lib_all"),
      icon: <LayoutGrid className="w-3.5 h-3.5" />,
      activeClass: "bg-slate-100 text-slate-900 border-slate-100",
    },
    {
      id: "secret",
      label: t("lib_keys"),
      icon: <KeyRound className="w-3.5 h-3.5" />,
      activeClass: "bg-amber-500/20 text-amber-200 border-amber-500/40",
    },
    {
      id: "command",
      label: t("lib_commands"),
      icon: <Terminal className="w-3.5 h-3.5" />,
      activeClass: "bg-sky-500/20 text-sky-200 border-sky-500/40",
    },
    {
      id: "note",
      label: t("lib_notes"),
      icon: <StickyNote className="w-3.5 h-3.5" />,
      activeClass: "bg-violet-500/20 text-violet-200 border-violet-500/40",
    },
    {
      id: "unknown",
      label: t("lib_unidentified"),
      icon: <HelpCircle className="w-3.5 h-3.5" />,
      activeClass: "bg-rose-500/20 text-rose-200 border-rose-500/40",
    },
    {
      id: "attention",
      label: t("lib_needs_review"),
      icon: <Inbox className="w-3.5 h-3.5" />,
      activeClass: "bg-orange-500/20 text-orange-200 border-orange-500/40",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">
          {t("tab_library")}{" "}
          <span className="text-slate-500 font-normal">
            ({libraryFiltered.length}
            {libraryFilter !== "all" || libraryQuery.trim()
              ? ` ${t("ui_language_label") === "لغة الواجهة / UI Language" ? "من أصل" : "of"} ${entries.length}`
              : ""}
            )
          </span>
        </h2>
        <button
          type="button"
          onClick={onFetchAll}
          className="text-slate-400 hover:text-white p-1"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Kind filters */}
      <div className="flex flex-wrap gap-2">
        {libraryChips.map((chip) => {
          const count = libraryCounts[chip.id];
          const active = libraryFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setLibraryFilter(chip.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                active
                  ? chip.activeClass
                  : "bg-slate-900/60 text-slate-400 border-slate-700 hover:border-slate-500 hover:text-slate-200"
              }`}
            >
              {chip.icon}
              {chip.label}
              <span
                className={`min-w-[1.25rem] text-center rounded-full px-1 py-0.5 text-[10px] tabular-nums ${
                  active ? "bg-black/25 text-inherit" : "bg-slate-800 text-slate-500"
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Text within library */}
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
          placeholder={t("lib_search_placeholder")}
          className="w-full bg-slate-900/80 border border-slate-700 rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div className="space-y-2">
        {libraryFiltered.map((e) => (
          <EntryCard
            key={e.id}
            entry={e}
            onOpenClarify={onOpenClarify}
            onDeleteEntry={onDeleteEntry}
            settings={settings}
          />
        ))}
        {!entries.length && (
          <p className="text-sm text-slate-500 italic">{t("lib_empty")}</p>
        )}
        {!!entries.length && !libraryFiltered.length && (
          <p className="text-sm text-slate-500 italic">
            {t("lib_no_match")}
            {libraryQuery.trim() ? ` “${libraryQuery.trim()}”` : ""}.
          </p>
        )}
      </div>
    </div>
  );
};
