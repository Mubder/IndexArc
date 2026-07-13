import React, { useState } from "react";
import { Lock, Unlock, ShieldAlert } from "lucide-react";
import { Settings } from "../types";
import { getTranslation } from "../utils/i18n";

interface LockScreenProps {
  settings: Settings | null;
  onUnlockSuccess: () => void;
}

export const LockScreen: React.FC<LockScreenProps> = ({ settings, onUnlockSuccess }) => {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const handleUnlock = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!password) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/vault/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();
      if (res.ok) {
        onUnlockSuccess();
      } else {
        setError(data.error || t("sec_error_incorrect"));
      }
    } catch (err: any) {
      setError(err.message || "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950 flex items-center justify-center p-4 z-50 select-none">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(99,102,241,0.08),transparent_70%)]" />
      
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-8 shadow-2xl relative z-10 flex flex-col items-center">
        {/* Animated Badge */}
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-6 animate-pulse">
          <Lock className="w-8 h-8" />
        </div>

        {/* Header Text */}
        <h2 className="text-xl font-bold text-white tracking-tight mb-2 text-center">
          {t("sec_locked_title")}
        </h2>
        <p className="text-sm text-slate-400 text-center mb-8 max-w-xs leading-relaxed">
          {t("sec_locked_subtitle")}
        </p>

        {/* Unlock Form */}
        <form onSubmit={handleUnlock} className="w-full space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              {t("sec_password_label")}
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("sec_password_placeholder")}
              disabled={loading}
              autoFocus
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors placeholder:text-slate-600 font-mono"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-rose-400 bg-rose-500/10 border border-rose-500/20 px-4 py-2.5 rounded-xl text-xs">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white font-medium text-sm py-3 rounded-xl transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <Unlock className="w-4 h-4" />
                <span>{t("sec_unlock_btn")}</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
