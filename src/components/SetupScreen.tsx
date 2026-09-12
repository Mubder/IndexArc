import React, { useState } from "react";
import { ShieldCheck, ShieldAlert, KeyRound } from "lucide-react";
import { Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface SetupScreenProps {
  settings: Settings | null;
  onSetupSuccess: () => void;
}

/**
 * Encrypted-by-default first-run gate: a brand-new vault cannot be used
 * until a master password exists. There is deliberately NO skip button —
 * allowing one would make "unencrypted" the de-facto default again.
 */
export const SetupScreen: React.FC<SetupScreenProps> = ({ settings, onSetupSuccess }) => {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;
  const canSubmit = password.length >= 8 && password === confirm && !loading;

  const handleSetup = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!canSubmit) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/vault/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (res.ok) {
        onSetupSuccess();
      } else {
        setError(data.error || t("sec_error_length"));
      }
    } catch (err: any) {
      setError(err.message || "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4 z-50 select-none"
      style={{ background: "var(--bg-base)" }}
    >
      <div className="absolute inset-0" style={{ background: "var(--gradient-radial)" }} />

      <div
        className="w-full max-w-md p-8 relative z-10 flex flex-col items-center"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "1rem",
          backdropFilter: "blur(10px)",
          boxShadow: "0 0 40px rgba(0,0,0,0.3)",
        }}
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)", color: "var(--accent-bright)", boxShadow: "0 0 24px var(--accent-glow)" }}
        >
          <KeyRound className="w-8 h-8" />
        </div>

        <h2 className="text-xl font-bold tracking-tight mb-2 text-center" style={{ color: "var(--text)" }}>
          {t("sec_first_setup_title")}
        </h2>
        <p className="text-sm text-center mb-6 max-w-xs leading-relaxed" style={{ color: "var(--text-dim)" }}>
          {t("sec_first_setup_subtitle")}
        </p>

        <form onSubmit={handleSetup} className="w-full space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
              {t("sec_password_label")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              autoFocus
              className="w-full rounded-xl px-4 py-3 text-sm transition-all focus:outline-none"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border-input)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-dim)" }}>
              {t("sec_confirm_label")}
            </label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={loading}
              className="w-full rounded-xl px-4 py-3 text-sm transition-all focus:outline-none"
              style={{
                background: "var(--bg-input)",
                border: "1px solid var(--border-input)",
                color: "var(--text)",
                fontFamily: "var(--font-mono)",
              }}
            />
          </div>

          {(mismatch || tooShort || error) && (
            <div
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs"
              style={{ color: "var(--danger)", background: "var(--danger-bg)", border: "1px solid rgba(248, 113, 113, 0.2)" }}
            >
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error || (mismatch ? t("sec_error_mismatch") : t("sec_error_length"))}</span>
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-center" style={{ color: "var(--text-muted)" }}>
            {t("sec_first_setup_hint")}
          </p>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full disabled:opacity-40 font-semibold text-sm py-3 rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer text-white"
            style={{ background: "linear-gradient(135deg, var(--accent), #1d4ed8)", boxShadow: "0 0 20px var(--accent-glow)" }}
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                <span>{t("sec_first_setup_btn")}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
