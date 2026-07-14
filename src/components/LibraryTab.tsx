import React, { useMemo, useState } from "react";
import { HelpCircle, KeyRound, LayoutGrid, RefreshCw, Search, StickyNote, Terminal, Inbox, Copy, AlertTriangle } from "lucide-react";
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
  onBulkDeleteEntries: (ids: string[]) => Promise<void>;
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
  onBulkDeleteEntries,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);
  const [duplicates, setDuplicates] = useState<Array<{ entry: VaultEntry; match: VaultEntry }>>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [selectedDuplicates, setSelectedDuplicates] = useState<string[]>([]);
  const [selectAllDuplicates, setSelectAllDuplicates] = useState(false);

  // Sync selectAll with selection
  React.useEffect(() => {
    setSelectAllDuplicates(selectedDuplicates.length === duplicates.length && duplicates.length > 0);
  }, [selectedDuplicates, duplicates]);

  const removeSelectedDuplicates = async () => {
    if (selectedDuplicates.length === 0) return;
    try {
      await onBulkDeleteEntries(selectedDuplicates);
      setShowDuplicates(false);
      setDuplicates([]);
      setSelectedDuplicates([]);
    } catch {
      // user cancelled — keep the duplicates panel as-is
    }
  };

  const findDuplicates = async () => {
    setCheckingDuplicates(true);
    setDuplicates([]);
    try {
      // Check for exact value duplicates
      const valueMap = new Map<string, VaultEntry[]>();
      for (const entry of entries) {
        if (!valueMap.has(entry.value)) {
          valueMap.set(entry.value, []);
        }
        valueMap.get(entry.value)!.push(entry);
      }
      const foundDuplicates: Array<{ entry: VaultEntry; match: VaultEntry }> = [];
      for (const [value, entriesWithSameValue] of valueMap.entries()) {
        if (entriesWithSameValue.length > 1) {
          for (let i = 1; i < entriesWithSameValue.length; i++) {
            foundDuplicates.push({
              entry: entriesWithSameValue[i],
              match: entriesWithSameValue[0],
            });
          }
        }
      }
      setDuplicates(foundDuplicates);
      setShowDuplicates(true);
    } catch (e: any) {
      console.error("Find duplicates failed:", e);
    } finally {
      setCheckingDuplicates(false);
    }
  };

  const libraryCounts = useMemo(() => {
    const c: Record<string, number> = {
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
    color: string;
    bgColor: string;
  }[] = [
    {
      id: "all",
      label: t("lib_all"),
      icon: <LayoutGrid className="w-3.5 h-3.5" />,
      color: "var(--text)",
      bgColor: "var(--bg-hover)",
    },
    {
      id: "secret",
      label: t("lib_keys"),
      icon: <KeyRound className="w-3.5 h-3.5" />,
      color: "var(--amber)",
      bgColor: "var(--amber-bg)",
    },
    {
      id: "command",
      label: t("lib_commands"),
      icon: <Terminal className="w-3.5 h-3.5" />,
      color: "var(--cyan)",
      bgColor: "rgba(34, 211, 238, 0.1)",
    },
    {
      id: "note",
      label: t("lib_notes"),
      icon: <StickyNote className="w-3.5 h-3.5" />,
      color: "var(--accent-bright)",
      bgColor: "var(--accent-bg)",
    },
    {
      id: "unknown",
      label: t("lib_unidentified"),
      icon: <HelpCircle className="w-3.5 h-3.5" />,
      color: "var(--danger)",
      bgColor: "var(--danger-bg)",
    },
    {
      id: "attention",
      label: t("lib_needs_review"),
      icon: <Inbox className="w-3.5 h-3.5" />,
      color: "#f97316",
      bgColor: "rgba(249, 115, 22, 0.1)",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {t("tab_library")}{" "}
          <span style={{ color: "var(--text-muted)", fontWeight: "normal" }}>
            ({libraryFiltered.length}
            {libraryFilter !== "all" || libraryQuery.trim()
              ? ` ${t("ui_language_label") === "لغة الواجهة / UI Language" ? "من أصل" : "of"} ${entries.length}`
              : ""}
            )
          </span>
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={findDuplicates}
            disabled={checkingDuplicates}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all disabled:opacity-50"
            style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            <Search className="w-3.5 h-3.5" /> {checkingDuplicates ? t("scanning_label") : t("find_duplicates_btn")}
          </button>
          <button
            type="button"
            onClick={onFetchAll}
            className="p-1 transition-colors"
            style={{ color: "var(--text-muted)" }}
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {showDuplicates && duplicates.length > 0 && (
        <div className="rounded-xl p-4 space-y-2" style={{ background: "var(--amber-bg)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--amber)" }}>
              <AlertTriangle className="w-4 h-4" />
              {t("duplicates_found")} ({duplicates.length})
            </h3>
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={selectAllDuplicates}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedDuplicates(duplicates.map(d => d.entry.id));
                    } else {
                      setSelectedDuplicates([]);
                    }
                    setSelectAllDuplicates(e.target.checked);
                  }}
                />
                {t("select_all")}
              </label>
              <button
                type="button"
                onClick={removeSelectedDuplicates}
                disabled={selectedDuplicates.length === 0}
                className="px-2 py-1 rounded text-[10px] disabled:opacity-50"
                style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248, 113, 113, 0.2)" }}
              >
                {t("remove_selected_btn")}
              </button>
            </div>
          </div>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>{t("duplicates_desc")}</p>
          <div className="space-y-2 max-h-60 overflow-y-auto">
            {duplicates.map((d, i) => (
              <div key={i} className="rounded-lg p-3" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedDuplicates.includes(d.entry.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedDuplicates((prev) => [...prev, d.entry.id]);
                      } else {
                        setSelectedDuplicates((prev) => prev.filter((id) => id !== d.entry.id));
                      }
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-mono text-rose-400 break-all">{d.entry.value.slice(0, 80)}{d.entry.value.length > 80 ? "…" : ""}</div>
                    <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                      Duplicate of: <strong>{d.match.name}</strong> ({d.match.id.slice(0, 8)})
                    </div>
                  </div>
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {libraryChips.map((chip) => {
          const count = libraryCounts[chip.id] || 0;
          const active = libraryFilter === chip.id;
          return (
            <button
              key={chip.id}
              type="button"
              onClick={() => setLibraryFilter(chip.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors"
              style={{
                background: active ? chip.bgColor : "var(--bg-surface)",
                color: active ? chip.color : "var(--text-muted)",
                borderColor: active ? chip.color : "var(--border)",
              }}
            >
              {chip.icon}
              {chip.label}
              <span
                className="min-w-[1.25rem] text-center rounded-full px-1 py-0.5 text-[10px]"
                style={{
                  fontFamily: "var(--font-mono)",
                  background: active ? "rgba(0,0,0,0.2)" : "var(--bg-base)",
                  color: active ? "inherit" : "var(--text-muted)",
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
        <input
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
          placeholder={t("lib_search_placeholder")}
          className="w-full rounded-xl pl-9 pr-3 py-2 text-sm focus:outline-none transition-colors"
          style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
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
          <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>{t("lib_empty")}</p>
        )}
        {!!entries.length && !libraryFiltered.length && (
          <p className="text-sm italic" style={{ color: "var(--text-muted)" }}>
            {t("lib_no_match")}
            {libraryQuery.trim() ? ` "${libraryQuery.trim()}"` : ""}.
          </p>
        )}
      </div>
    </div>
  );
};
