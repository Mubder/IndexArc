import type { Tab, Settings } from "../../types";
import type { Dispatch, SetStateAction, ReactNode } from "react";
import type { TranslationDict } from "../../utils/i18n";
import { Lock, ShieldCheck, ShieldAlert } from "lucide-react";

export interface SidebarProps {
  nav: { id: Tab; label: string; icon: ReactNode; badge?: number | undefined; }[];
  setTab: Dispatch<SetStateAction<Tab>>;
  sidebarOpen: boolean;
  settings: Settings | null;
  vaultStatus: { is_locked: boolean; encryption_enabled: boolean } | null;
  handleLockVault: () => Promise<void>;
  t: (key: keyof TranslationDict) => string;
  tab: Tab;
}

export function Sidebar({ nav, setTab, sidebarOpen, settings, vaultStatus, handleLockVault, t, tab }: SidebarProps) {
  const encrypted = !!vaultStatus?.encryption_enabled;
  const autoLock = settings?.auto_lock_minutes ?? 0;
  return (
    <>
          {/* Sidebar - desktop: always visible, mobile: drawer */}
          <aside
            className={`
              app-sidebar w-60 flex-shrink-0 flex flex-col border-r overflow-y-auto
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

          {/* Vault security */}
          <div className="mx-3 mb-3 p-4 rounded-xl border flex flex-col gap-3" style={{ background: "var(--bg-surface)", borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2">
              {encrypted ? (
                <ShieldCheck className="w-4 h-4" style={{ color: "var(--emerald)" }} aria-hidden="true" />
              ) : (
                <ShieldAlert className="w-4 h-4" style={{ color: "var(--amber)" }} aria-hidden="true" />
              )}
              <span className="text-[13px] font-semibold" style={{ color: "var(--text)" }}>
                {encrypted ? t("lock_card_unlocked") : t("lock_card_plain")}
              </span>
              {encrypted && (
                <span className="ms-auto text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>AES-256</span>
              )}
            </div>
            {encrypted ? (
              <>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                  {autoLock > 0 ? t("lock_card_autolock").replace("{n}", String(autoLock)) : t("lock_card_autolock_off")}
                </span>
                <button
                  type="button"
                  onClick={() => void handleLockVault()}
                  className="icon-btn min-h-[36px] rounded-lg border text-[13px] font-semibold flex items-center justify-center gap-2"
                  style={{ borderColor: "var(--border-hover)", color: "var(--text)" }}
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" /> {t("lock_now")}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setTab("settings")}
                className="icon-btn min-h-[36px] rounded-lg border text-[13px] font-semibold"
                style={{ borderColor: "var(--amber)", color: "var(--amber)" }}
              >
                {t("lock_card_encrypt")}
              </button>
            )}
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
              src="/kazma-logo.png"
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
