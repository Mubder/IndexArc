import type { HealthReport } from "../../types";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";

export interface HealthBannersProps {
  health: HealthReport | null;
  integrityDismissed: boolean;
  integrityWarnings: string[];
  setHealthOpen: Dispatch<SetStateAction<boolean>>;
  setIntegrityDismissed: Dispatch<SetStateAction<boolean>>;
  t: (key: keyof TranslationDict) => string;
}

export function HealthBanners({ health, integrityDismissed, integrityWarnings, setHealthOpen, setIntegrityDismissed, t }: HealthBannersProps) {
  return (
    <>
            {health?.overall === "attention" && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-xl px-4 py-3 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.35)", color: "var(--text)" }}>
                <div className="min-w-0">
                  <div className="font-semibold mb-0.5">{t("health_attention")} — {t("health_title")}</div>
                  <ul className="list-disc pl-5 text-xs" style={{ color: "var(--text-dim)" }}>
                    {(health.checks ?? []).filter((c) => c.severity === "critical" && !c.ok).slice(0, 3).map((c) => (
                      <li key={c.id}>{c.label}: {c.detail}</li>
                    ))}
                    {(health.checks ?? []).filter((c) => c.severity === "critical" && !c.ok).length === 0 && (
                      <li>{health.error || health.vault?.error || "Vault data unavailable in this data folder."}</li>
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
                  <div className="font-semibold mb-0.5">Data integrity warning</div>
                  <ul className="list-disc pl-5 text-xs" style={{ color: "var(--text-dim)" }}>
                    {integrityWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                  <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
                    Check Settings → Logs for details. Corrupt copies are quarantined, never deleted.
                  </div>
                </div>
                <button
                  onClick={() => setIntegrityDismissed(true)}
                  className="px-2.5 py-1 rounded-lg text-xs font-medium shrink-0"
                  style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)" }}
                >
                  Dismiss
                </button>
              </div>
            )}
    </>
  );
}
