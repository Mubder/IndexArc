import React, { useState, useEffect, useMemo } from "react";
import { Search, X, StickyNote, KeyRound, Terminal, Compass, ArrowRight } from "lucide-react";
import { VaultEntry, Tab, Settings } from "../types";
import { getTranslation } from "../utils/i18n";
import { isArabicText } from "../utils";

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  entries: VaultEntry[];
  onSelectEntry: (entry: VaultEntry) => void;
  onNavigateTab: (tab: Tab) => void;
  settings: Settings | null;
}

export const CommandPaletteModal: React.FC<CommandPaletteModalProps> = ({
  isOpen,
  onClose,
  entries,
  onSelectEntry,
  onNavigateTab,
  settings,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Keyboard listener for Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (isOpen) onClose();
        else setQuery("");
      }
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const navActions = useMemo(
    () => [
      { id: "scratchpad", label: t("tab_scratchpad"), icon: <StickyNote className="w-4 h-4 text-emerald-400" /> },
      { id: "library", label: t("tab_library"), icon: <Compass className="w-4 h-4 text-indigo-400" /> },
      { id: "ask", label: t("tab_ask"), icon: <Search className="w-4 h-4 text-cyan-400" /> },
      { id: "settings", label: t("tab_settings"), icon: <Terminal className="w-4 h-4 text-amber-400" /> },
    ],
    [t]
  );

  const filteredEntries = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries.slice(0, 10);
    return entries
      .filter((e) => {
        const blob = `${e.name} ${e.type} ${e.value} ${(e.labels || []).join(" ")}`.toLowerCase();
        return blob.includes(q);
      })
      .slice(0, 15);
  }, [entries, query]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/75 backdrop-blur-md animate-fade-in">
      <div
        className="w-full max-w-2xl rounded-2xl flex flex-col min-w-0 shadow-2xl overflow-hidden transition-all"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-glow)",
        }}
      >
        {/* Search Input Bar */}
        <div
          className="p-4 border-b flex items-center gap-3 shrink-0"
          style={{ borderColor: "var(--border)", background: "var(--bg-base)" }}
        >
          <Search className="w-5 h-5 shrink-0" style={{ color: "var(--accent-bright)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Search notes, secrets, commands, or tabs... (Esc to close)"
            dir="auto"
            className="w-full bg-transparent text-base focus:outline-none"
            style={{ color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--bg-hover)] text-xs font-mono"
            style={{ color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            ESC
          </button>
        </div>

        {/* Results Body */}
        <div className="p-2 max-h-[60vh] overflow-y-auto custom-scrollbar space-y-3">
          {/* Quick Navigation Commands */}
          {!query.trim() && (
            <div>
              <div className="px-3 py-1.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--text-muted)" }}>
                Quick Navigation
              </div>
              <div className="space-y-1">
                {navActions.map((action) => (
                  <button
                    key={action.id}
                    type="button"
                    onClick={() => {
                      onNavigateTab(action.id as Tab);
                      onClose();
                    }}
                    className="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between gap-3 text-xs transition-all hover:bg-[var(--bg-hover)]"
                    style={{ color: "var(--text)" }}
                  >
                    <div className="flex items-center gap-2.5">
                      {action.icon}
                      <span className="font-medium">{action.label}</span>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 opacity-50" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Vault Entries */}
          <div>
            <div className="px-3 py-1.5 text-[10px] uppercase font-semibold tracking-wider" style={{ color: "var(--text-muted)" }}>
              Vault Results ({filteredEntries.length})
            </div>
            {filteredEntries.length === 0 ? (
              <p className="px-3 py-4 text-xs italic" style={{ color: "var(--text-muted)" }}>
                No matching notes, secrets, or commands found.
              </p>
            ) : (
              <div className="space-y-1">
                {filteredEntries.map((entry) => {
                  const isNote = entry.family === "note";
                  const isSecret = entry.family === "secret";
                  const isCmd = entry.family === "command";
                  const isAr = isArabicText(entry.name);

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => {
                        onSelectEntry(entry);
                        onClose();
                      }}
                      className="w-full text-left px-3 py-2.5 rounded-xl flex items-center justify-between gap-3 transition-all hover:bg-[var(--bg-hover)] group"
                      style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="shrink-0 p-1.5 rounded-lg" style={{ background: "var(--bg-input)" }}>
                          {isNote && <StickyNote className="w-4 h-4 text-indigo-400" />}
                          {isSecret && <KeyRound className="w-4 h-4 text-amber-400" />}
                          {isCmd && <Terminal className="w-4 h-4 text-cyan-400" />}
                          {!isNote && !isSecret && !isCmd && <Compass className="w-4 h-4 text-rose-400" />}
                        </div>

                        <div className="min-w-0">
                          <div
                            className={`text-xs font-semibold truncate ${isAr ? "font-arabic ar-text" : ""}`}
                            dir={isAr ? "rtl" : "auto"}
                            style={{ color: "var(--text)" }}
                          >
                            {entry.name}
                          </div>
                          <div className="text-[10px] truncate max-w-md" style={{ color: "var(--text-muted)" }}>
                            {entry.value.slice(0, 90)}
                          </div>
                        </div>
                      </div>

                      <span
                        className="text-[10px] px-2 py-0.5 rounded font-mono uppercase shrink-0"
                        style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}
                      >
                        {entry.type}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-2 border-t flex items-center justify-between text-[11px]"
          style={{ borderColor: "var(--border)", background: "var(--bg-base)", color: "var(--text-muted)" }}
        >
          <span>Use <strong>Ctrl + K</strong> anytime to toggle</span>
          <span>IndexArc Search</span>
        </div>
      </div>
    </div>
  );
};
