import type { FormEvent } from "react";
import type { Tab, HealthReport } from "../../types";
import { Search, X, Menu, Lock, Stethoscope, Sun, Moon, Globe, FolderOpen } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Settings, SystemStatus } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface TopBarProps {
  handleAsk: (e?: FormEvent<Element> | undefined) => Promise<void>;
  handleLockVault: () => Promise<void>;
  onOpenFiles: () => void;
  health: HealthReport | null;
  query: string;
  setCmdPaletteOpen: Dispatch<SetStateAction<boolean>>;
  setHealthOpen: Dispatch<SetStateAction<boolean>>;
  setQuery: Dispatch<SetStateAction<string>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  settings: Settings | null;
  sidebarOpen: boolean;
  status: SystemStatus | null;
  t: (key: keyof TranslationDict) => string;
  theme: "dark" | "light";
  toggleLanguage: () => void;
  toggleTheme: () => void;
  vaultStatus: { is_locked: boolean; encryption_enabled: boolean; needs_setup?: boolean | undefined; migration_recommended?: boolean | undefined; } | null;
}

export function TopBar({ handleAsk, handleLockVault, onOpenFiles, health, query, setCmdPaletteOpen, setHealthOpen, setQuery, setSidebarOpen, setTab, settings, sidebarOpen, status, t, theme, toggleLanguage, toggleTheme, vaultStatus }: TopBarProps) {
  return (
    <>
          {/* Top Bar - Fixed Layout */}
          <header
            className="app-header flex items-center gap-4 px-6 py-3 border-b flex-shrink-0"
            style={{
              background: "var(--glass)",
              backdropFilter: "blur(12px)",
              borderColor: "var(--border)",
            }}
          >
            {/* Brand/Title - hidden on mobile, shown on desktop */}
            <div className="flex items-center gap-3 flex-shrink-0 hidden md:flex">
              <img
                src="/Logo1.png"
                alt="IndexArc"
                className="w-9 h-9 rounded-xl object-contain"
                style={{ boxShadow: "0 0 20px var(--accent-glow)" }}
              />
              <div>
                <h1
                  className="brand-text text-base font-bold"
                  style={{
                    background: "linear-gradient(135deg, var(--text), var(--accent-bright))",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }}
                >
                  IndexArc
                </h1>
                <span className="text-[10px] uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  {t("brand_tagline")}
                </span>
              </div>
            </div>

            {/* Mobile brand - shown only on mobile */}
            <div className="flex items-center gap-2 flex-shrink-0 md:hidden">
              <img
                src="/Logo1.png"
                alt="IndexArc"
                className="w-8 h-8 rounded-xl object-contain"
                style={{ boxShadow: "0 0 20px var(--accent-glow)" }}
              />
              <span className="text-sm font-bold" style={{ color: "var(--text)" }}>IndexArc</span>
            </div>

            {/* Search - Center */}
            <div className="flex-1 max-w-2xl relative order-3 md:order-none md:max-w-xl">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--text-muted)" }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk(e)}
                placeholder={t("ask_header_placeholder") || "Search entries, tokens, commands..."}
                className="w-full pl-9 pr-16 py-2.5 rounded-xl text-sm focus:outline-none transition-all"
                style={{
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-input)",
                  color: "var(--text)",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-glow)";
                  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.08)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-input)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              />
              <span
                className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-0.5 rounded text-[10px]"
                style={{
                  background: "var(--accent-bg)",
                  border: "1px solid rgba(37, 99, 235, 0.15)",
                  color: "var(--text-muted)",
                }}
              >
                Ctrl K
              </span>
            </div>

            {/* Right Controls */}
            <div className="flex items-center gap-1 flex-shrink-0">
              {/* Mobile Menu Toggle */}
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="icon-btn p-2 rounded-xl border transition-all md:hidden"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                aria-label={sidebarOpen ? t("menu_close") : t("menu_open")}
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
              {/* AI Status */}
              {status?.is_ollama_online && (
                <div
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border"
                  style={{ borderColor: "var(--border)", background: "var(--bg-surface)" }}
                >
                  <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "var(--emerald)" }} />
                  <span className="font-mono" style={{ color: "var(--text-dim)" }}>
                    {status?.ai_provider || "auto"}
                  </span>
                </div>
              )}

              {/* Encryption Badge */}
              {vaultStatus?.encryption_enabled && (
                <div
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold border"
                  style={{
                    background: "var(--emerald-bg)",
                    color: "var(--emerald)",
                    borderColor: "rgba(52, 211, 153, 0.12)",
                  }}
                >
                  <Lock className="w-3 h-3" />
                  AES-256
                </div>
              )}

              {/* Lock Button */}
              {vaultStatus?.encryption_enabled && !vaultStatus?.is_locked && (
                <button
                  onClick={handleLockVault}
                  className="icon-btn p-2 rounded-xl border transition-all"
                  style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                  title={t("sec_lock_btn") || "Lock vault"}
                >
                  <Lock className="w-4 h-4" />
                </button>
              )}

              {/* Files window */}
              <button
                onClick={onOpenFiles}
                className="icon-btn p-2 rounded-xl border transition-all"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                title={t("docs_open_window")}
                aria-label={t("docs_open_window")}
              >
                <FolderOpen className="w-4 h-4" />
              </button>

              {/* App Health */}
              <button
                onClick={() => setHealthOpen(true)}
                className="icon-btn p-2 rounded-xl border transition-all relative"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                title={t("health_open_btn")}
                aria-label={t("health_open_btn")}
              >
                <Stethoscope className="w-4 h-4" />
                {health && health.overall !== "healthy" && (
                  <span
                    className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                    style={{
                      background: health.overall === "attention" ? "var(--danger)" : "var(--amber)",
                      borderColor: "var(--bg-surface)",
                    }}
                  />
                )}
              </button>

              {/* Theme Toggle */}
              <button
                onClick={toggleTheme}
                className="icon-btn p-2 rounded-xl border transition-all"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                title={theme === "dark" ? t("theme_to_light") : t("theme_to_dark")}
                aria-label={theme === "dark" ? t("theme_to_light") : t("theme_to_dark")}
              >
                {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>

              {/* Command Palette Trigger */}
              <button
                onClick={() => setCmdPaletteOpen(true)}
                className="icon-btn hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs transition-all"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-muted)" }}
                title={t("search_btn_title")}
              >
                <Search className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t("search_btn_short")}</span>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono" style={{ background: "var(--bg-input)" }}>Ctrl+K</kbd>
              </button>

              {/* Language Toggle */}
              <button
                onClick={toggleLanguage}
                className="icon-btn p-2 rounded-xl border transition-all"
                style={{ borderColor: "var(--border)", background: "var(--bg-surface)", color: "var(--text-dim)" }}
                title={t("lang_switch_title")}
                aria-label={t("lang_switch_title")}
              >
                <Globe className="w-4 h-4" />
              </button>

              {/* New Entry */}
              <button
                onClick={() => setTab("home")}
                className="btn-primary px-4 py-2 rounded-lg text-sm font-semibold text-white"
              >
                + {t("new_entry_btn")}
              </button>
            </div>
          </header>
    </>
  );
}
