import type { HealthReport } from "../../types";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";

export interface HealthBannersProps {
  /** Outside Home: one line with the first issue, details in the health dialog. */
  compact?: boolean;
  health: HealthReport | null;
  integrityDismissed: boolean;
  integrityWarnings: string[];
  setHealthOpen: Dispatch<SetStateAction<boolean>>;
  setIntegrityDismissed: Dispatch<SetStateAction<boolean>>;
  t: (key: keyof TranslationDict) => string;
}

export function HealthBanners({ compact, health, integrityDismissed, integrityWarnings, setHealthOpen, setIntegrityDismissed, t }: HealthBannersProps) {
  return (
    <>
            {health?.overall === "attention" && compact && (() => {
              const bad = (health.checks ?? []).filter((c) => c.severity === "critical" && !c.ok);
              const first = bad[0] ? `${bad[0].label}: ${bad[0].detail}` : health.error || health.vault?.error || "Vault data unavailable in this data folder.";
              return (
                <div className="mb-4 flex items-center gap-3 rounded-xl px-4 py-2 text-xs" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--text)" }}>
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: "var(--danger)", boxShadow: "0 0 8px var(--danger)" }} />
                  <span className="font-semibold shrink-0">{t("health_attention")}</span>
                  <span dir="auto" className="truncate min-w-0" style={{ color: "var(--text-dim)" }}>{first}</span>
                  {bad.length > 1 && (
                    <span className="shrink-0" style={{ color: "var(--text-muted)" }}>{t("health_more_issues").replace("{n}", String(bad.length - 1))}</span>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => setHealthOpen(true)}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium shrink-0"
                    style={{ background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger)" }}
                  >
                    {t("health_banner_action")}
                  </button>
                </div>
              );
            })()}

            {health?.overall === "attention" && !compact && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--text)" }}>
                <div className="min-w-0">
                  <div className="font-semibold mb-0.5">{t("health_attention")} — {t("health_title")}</div>
                  <ul className="list-disc pl-5 text-xs" style={{ color: "var(--text-dim)" }}>
                    {(health.checks ?? []).filter((c) => c.severity === "critical" && !c.ok).slice(0, 3).map((c) => (
                      <li key={c.id} dir="auto">{c.label}: {c.detail}</li>
                    ))}
                    {(health.checks ?? []).filter((c) => c.severity === "critical" && !c.ok).length === 0 && (
                      <li dir="auto">{health.error || health.vault?.error || "Vault data unavailable in this data folder."}</li>
                    )}
                  </ul>
                </div>
                <button
                  onClick={() => setHealthOpen(true)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium shrink-0"
                  style={{ background: "var(--danger-bg)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--danger)" }}
                >
                  {t("health_banner_action")}
                </button>
              </div>
            )}

            {integrityWarnings.length > 0 && !integrityDismissed && health?.overall !== "attention" && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--text)" }}>
                <div>
                  <div className="font-semibold mb-0.5">{t("integrity_title")}</div>
                  <ul className="list-disc pl-5 text-xs" style={{ color: "var(--text-dim)" }}>
                    {integrityWarnings.map((w, i) => (
                      <li key={i} dir="auto">{w}</li>
                    ))}
                  </ul>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    {t("integrity_hint")}
                  </div>
                </div>
                <button
                  onClick={() => setIntegrityDismissed(true)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium shrink-0"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                >
                  {t("dismiss_btn")}
                </button>
              </div>
            )}
    </>
  );
}
