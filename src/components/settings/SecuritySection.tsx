import { Shield } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationDict } from "../../utils/i18n";
import { ChangePasswordCard, RecoveryKeyCard } from "./KeyManagement";

export interface SecuritySectionProps {
  handleRemovePassword: () => Promise<void>;
  handleSetupPassword: () => Promise<void>;
  secError: string;
  secPassword: string;
  setSecPassword: Dispatch<SetStateAction<string>>;
  t: (key: keyof TranslationDict) => string;
  vaultStatus: { is_locked: boolean; encryption_enabled: boolean; } | null;
}

export function SecuritySection({ handleRemovePassword, handleSetupPassword, secError, secPassword, setSecPassword, t, vaultStatus }: SecuritySectionProps) {
  return (
    <>
      <div id="security-section" className="space-y-4 rounded-xl p-5 mt-4 scroll-mt-4" style={{ background: "var(--bg-surface)", border: vaultStatus?.encryption_enabled ? "1px solid var(--border)" : "1px solid rgba(251, 191, 36, 0.35)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 pb-2" style={{ color: "var(--accent-bright)", borderBottom: "1px solid var(--border)" }}>
          <Shield className="w-4 h-4" /> {t("sec_title")}
        </h3>

        <div className="flex items-center justify-between text-xs">
          <span style={{ color: "var(--text-dim)" }}>{t("sec_encryption_status")}:</span>
          <span
            className="px-2 py-0.5 rounded text-[10px] font-semibold"
            style={vaultStatus?.encryption_enabled
              ? { color: "var(--emerald)", background: "var(--emerald-bg)", border: "1px solid rgba(52, 211, 153, 0.2)" }
              : { color: "var(--amber)", background: "var(--amber-bg)", border: "1px solid rgba(251, 191, 36, 0.35)" }
            }
          >
            {vaultStatus?.encryption_enabled ? t("sec_status_enabled") : t("sec_status_disabled")}
          </span>
        </div>

        {vaultStatus?.encryption_enabled ? (
          <div className="space-y-3 pt-1">
            {!vaultStatus.is_locked && (
              <>
                <ChangePasswordCard t={t} />
                <RecoveryKeyCard t={t} />
              </>
            )}
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
              {t("sec_remove_desc")}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={secPassword}
                onChange={(e) => setSecPassword(e.target.value)}
                placeholder={t("sec_password_placeholder")}
                className="flex-1 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              />
              <button
                type="button"
                onClick={handleRemovePassword}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248, 113, 113, 0.2)" }}
              >
                {t("sec_remove_btn")}
              </button>
            </div>
            {secError && <p className="text-[10px] font-mono" style={{ color: "var(--danger)" }}>{secError}</p>}
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
              {t("sec_setup_subtitle")}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={secPassword}
                onChange={(e) => setSecPassword(e.target.value)}
                placeholder={t("sec_set_password_placeholder")}
                className="flex-1 rounded-lg px-3 py-1.5 text-xs"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              />
              <button
                type="button"
                onClick={handleSetupPassword}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                style={{ background: "var(--accent)", color: "white" }}
              >
                {t("sec_setup_btn")}
              </button>
            </div>
            {secError && <p className="text-[10px] font-mono" style={{ color: "var(--danger)" }}>{secError}</p>}
          </div>
        )}
      </div>
    </>
  );
}
