import type { Tab } from "../../types";
import { LibraryFilter } from "../../types";
import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { SystemStatus } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface SidebarProps {
  nav: { id: Tab; label: string; icon: ReactNode; badge?: number | undefined; }[];
  setLibraryFilter: Dispatch<SetStateAction<LibraryFilter>>;
  setTab: Dispatch<SetStateAction<Tab>>;
  sidebarOpen: boolean;
  status: SystemStatus | null;
  t: (key: keyof TranslationDict) => string;
  tab: Tab;
}

export function Sidebar({ nav, setLibraryFilter, setTab, sidebarOpen, status, t, tab }: SidebarProps) {
  return (
    <>
          {/* Sidebar - desktop: always visible, mobile: drawer */}
          <aside
            className={`
              w-60 flex-shrink-0 flex flex-col border-r overflow-y-auto
              ${sidebarOpen ? "translate-x-0 open" : "-translate-x-full"} 
              md:translate-x-0
              transition-transform duration-250 ease-out
              z-50 md:z-auto
              fixed md:static inset-y-0 left-0
            `}
            style={{
              background: "var(--glass)",
              backdropFilter: "blur(20px)",
              borderColor: "var(--border)",
            }}
          >
          {/* Navigation */}
          <nav className="flex-1 p-3 flex flex-col gap-1">
            <div
              className="text-[11px] font-semibold uppercase tracking-wider px-3 pt-2 pb-2 flex items-center gap-2"
              style={{ color: "var(--text-muted)" }}
            >
              {t("nav_section_vault")}
              <div className="flex-1 h-px" style={{ background: "var(--border)" }} />
            </div>
            {nav.map((n) => {
              const isActive = tab === n.id;
              return (
              <button
                key={n.id}
                type="button"
                onClick={() => setTab(n.id)}
                data-active={isActive}
                className="nav-item w-full flex items-center gap-2.5 ps-5 pe-3 py-2 text-sm font-medium relative group"
                style={{
                  borderRadius: "9999px",
                  color: isActive ? "var(--tab-active-color)" : "var(--tab-inactive-color)",
                  background: isActive ? "var(--tab-active-bg)" : "var(--tab-inactive-bg)",
                  border: `1px solid ${isActive ? "var(--tab-active-border)" : "var(--tab-inactive-border)"}`,
                  boxShadow: isActive ? "var(--tab-active-shadow)" : "none",
                }}
              >
                <span style={{ color: isActive ? "var(--accent-bright)" : "inherit", opacity: isActive ? 1 : 0.75 }}>{n.icon}</span>
                <span className="flex-1 text-left truncate font-medium">{n.label}</span>
                {n.badge ? (
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-none"
                    style={{ background: isActive ? "var(--accent)" : "var(--amber-bg)", color: isActive ? "#fff" : "var(--amber)" }}
                  >
                    {n.badge}
                  </span>
                ) : null}
              </button>
              );
            })}
          </nav>

          {/* Stats */}
          <div
            className="mx-3 mb-3 p-4 rounded-xl border"
            style={{ background: "var(--bg-surface)", borderColor: "var(--border)", backdropFilter: "blur(10px)" }}
          >
            <div
              className="text-[10px] font-semibold uppercase tracking-wider mb-2.5"
              style={{ color: "var(--text-muted)" }}
            >
              {t("vault_overview")}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {([
                { val: status?.stats?.total_saved ?? 0, lbl: t("stat_saved"), filter: "all" },
                { val: status?.stats?.needs_attention ?? 0, lbl: t("stat_pending"), filter: "attention" },
                { val: status?.stats?.total_secrets ?? 0, lbl: t("stat_secrets"), filter: "secret" },
                { val: status?.stats?.total_commands ?? 0, lbl: t("stat_commands"), filter: "command" },
              ] as { val: number; lbl: string; filter: LibraryFilter }[]).map((s) => (
                <button
                  key={s.lbl}
                  type="button"
                  onClick={() => {
                    setLibraryFilter(s.filter);
                    setTab("library");
                  }}
                  className="text-center py-1.5 rounded-lg border transition-all hover:brightness-125 cursor-pointer"
                  style={{ background: "var(--accent-bg)", borderColor: "rgba(37, 99, 235, 0.06)" }}
                  title={`${s.lbl} · ${t("stat_open_in_library")}`}
                >
                  <div
                    className="text-lg font-bold tabular-nums"
                    style={{
                      background: "linear-gradient(135deg, var(--accent-bright), var(--cyan))",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    {s.val}
                  </div>
                  <div className="text-[9px] uppercase tracking-wider font-medium" style={{ color: "var(--text-muted)" }}>
                    {s.lbl}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Built with Kazma.ai credit (clickable → opens in default browser) */}
          <button
            type="button"
            onClick={() => window.electronAPI?.openExternal?.("https://kazma.ai")}
            className="mt-auto m-3 p-3 rounded-xl flex items-center gap-3 transition-all hover:brightness-125 text-left"
            style={{
              borderColor: "var(--border-glow)",
              background: "var(--accent-bg)",
              boxShadow: "0 0 10px var(--accent-glow)",
            }}
            title="https://kazma.ai"
          >
            <img
              src="/kazma-logo.jpeg"
              alt="Kazma.ai"
              className="h-10 w-10 rounded-lg object-contain flex-shrink-0"
            />
            <div className="leading-snug">
              <div className="text-[11px] font-semibold" style={{ color: "var(--accent-bright)" }}>
                {t("built_with_kazma")}
              </div>
              <div className="text-[10px]" style={{ color: "var(--text-dim)" }}>
                {t("kazma_tagline")}
              </div>
            </div>
          </button>
        </aside>
    </>
  );
}
