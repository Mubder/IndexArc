import React from "react";
import { Server, Sparkles, Shield, Lock, Unlock } from "lucide-react";
import { Settings, SystemStatus } from "../types";
import { getTranslation } from "../utils/i18n";

interface SettingsTabProps {
  settings: Settings;
  onPatchSettings: (patch: Partial<Settings>) => void;
  status: SystemStatus | null;
  onWarmOllama: () => Promise<void>;
  onSaveSettings: () => Promise<void>;
  vaultStatus: { is_locked: boolean; encryption_enabled: boolean } | null;
  onRefreshVaultStatus: () => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onPatchSettings,
  status,
  onWarmOllama,
  onSaveSettings,
  vaultStatus,
  onRefreshVaultStatus,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const [secPassword, setSecPassword] = React.useState("");
  const [secError, setSecError] = React.useState("");

  const handleSetupPassword = async () => {
    if (!secPassword || secPassword.length < 4) {
      setSecError(t("sec_error_length"));
      return;
    }
    setSecError("");
    try {
      const res = await fetch("/api/vault/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: secPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecPassword("");
        onRefreshVaultStatus();
      } else {
        setSecError(data.error || "Failed to setup password");
      }
    } catch (err: any) {
      setSecError(err.message || "Request failed");
    }
  };

  const handleRemovePassword = async () => {
    if (!secPassword) return;
    setSecError("");
    try {
      const res = await fetch("/api/vault/remove-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: secPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setSecPassword("");
        onRefreshVaultStatus();
      } else {
        setSecError(data.error || t("sec_error_incorrect"));
      }
    } catch (err: any) {
      setSecError(err.message || "Request failed");
    }
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-5 max-w-xl">
      {/* UI Language Selection */}
      <div className="space-y-2 border-b border-slate-800 pb-5">
        <h2 className="text-sm font-semibold text-white flex items-center gap-2">
          {t("ui_language_label")}
        </h2>
        <p className="text-[11px] text-slate-500">
          {t("ui_language_desc")}
        </p>
        <div className="flex gap-2 pt-1">
          {(["en", "ar", "both"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => onPatchSettings({ ui_language: lang })}
              className={`px-4 py-2 rounded-xl text-xs font-medium border ${
                settings.ui_language === lang
                  ? "bg-indigo-600 border-indigo-500 text-white"
                  : "border-slate-700 text-slate-400 hover:border-slate-500"
              }`}
            >
              {lang === "en" && "English (EN)"}
              {lang === "ar" && "العربية (AR)"}
              {lang === "both" && "Bilingual / ثنائي (EN/AR)"}
            </button>
          ))}
        </div>
      </div>

      <h2 className="text-sm font-semibold text-white">{t("ai_provider_choice")}</h2>
      <div className="flex flex-wrap gap-2">
        {([
          "auto",
          "local",
          "api",
          "openai",
          "groq",
          "openrouter",
          "anthropic",
          "local_openai"
        ] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => onPatchSettings({ ai_provider: m })}
            className={`px-3 py-2 rounded-xl text-xs font-medium border ${
              settings.ai_provider === m
                ? "bg-indigo-600 border-indigo-500 text-white"
                : "border-slate-700 text-slate-400 hover:border-slate-500"
            }`}
          >
            {m === "auto" && "Auto"}
            {m === "local" && (
              <span className="flex items-center gap-1">
                <Server className="w-3.5 h-3.5" /> Local Ollama
              </span>
            )}
            {m === "api" && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Cloud Gemini
              </span>
            )}
            {m === "openai" && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> OpenAI API
              </span>
            )}
            {m === "groq" && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Groq API
              </span>
            )}
            {m === "openrouter" && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> OpenRouter
              </span>
            )}
            {m === "anthropic" && (
              <span className="flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> Anthropic Claude
              </span>
            )}
            {m === "local_openai" && (
              <span className="flex items-center gap-1">
                <Server className="w-3.5 h-3.5" /> Custom Local OpenAI
              </span>
            )}
          </button>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">
        {t("active_now")}:{" "}
        <span className="text-indigo-300 font-mono">{status?.active_provider || "…"}</span>
        {settings.ai_provider === "auto" && ` · ${t("auto_desc")}`}
      </p>

      {/* Local Ollama panel */}
      {(settings.ai_provider === "local" || settings.ai_provider === "auto") && (
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" /> {t("local_ollama_title")}
            </h3>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded border ${
                status?.is_ollama_online
                  ? "text-emerald-300 border-emerald-500/30 bg-emerald-500/10"
                  : "text-rose-300 border-rose-500/30 bg-rose-500/10"
              }`}
            >
              {status?.is_ollama_online ? t("online") : t("offline")}
            </span>
          </div>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">{t("ollama_base_url")}</span>
            <input
              value={settings.ollama_base_url}
              onChange={(e) => onPatchSettings({ ollama_base_url: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs space-y-1">
              <span className="text-slate-400">{t("llm_classify")}</span>
              <select
                value={settings.ollama_llm_model}
                onChange={(e) => onPatchSettings({ ollama_llm_model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              >
                {!status?.ollama_models?.some(
                  (m) =>
                    m === settings.ollama_llm_model ||
                    m.startsWith(settings.ollama_llm_model.split(":")[0])
                ) && (
                  <option value={settings.ollama_llm_model}>
                    {settings.ollama_llm_model}
                  </option>
                )}
                {(status?.ollama_models || []).map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={settings.ollama_llm_model}
                onChange={(e) => onPatchSettings({ ollama_llm_model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-400"
                placeholder={t("ollama_placeholder")}
              />
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-slate-400">{t("embed_search")}</span>
              <select
                value={settings.ollama_embed_model}
                onChange={(e) => onPatchSettings({ ollama_embed_model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              >
                {!status?.ollama_models?.some(
                  (m) =>
                    m === settings.ollama_embed_model ||
                    m.startsWith(settings.ollama_embed_model.split(":")[0])
                ) && (
                  <option value={settings.ollama_embed_model}>
                    {settings.ollama_embed_model}
                  </option>
                )}
                {(status?.ollama_models || []).map((m) => (
                  <option key={`e-${m}`} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input
                value={settings.ollama_embed_model}
                onChange={(e) => onPatchSettings({ ollama_embed_model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-[11px] font-mono text-slate-400"
                placeholder={t("ollama_placeholder")}
              />
            </label>
          </div>
          <p className="text-[11px] text-slate-500 leading-relaxed">
            {t("ollama_llm_desc")}
          </p>
          <button
            type="button"
            onClick={onWarmOllama}
            className="px-3 py-1.5 rounded-lg bg-sky-700/80 hover:bg-sky-600 text-xs font-medium"
          >
            {t("load_llm_btn")}
          </button>
        </div>
      )}

      {/* Cloud API panel */}
      {(settings.ai_provider === "api" || settings.ai_provider === "auto") && (
        <div className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-950/20 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> {t("cloud_api_title")}
          </h3>
          {!settings.gemini_api_key && settings.ai_provider === "api" && (
            <p className="text-[11px] text-amber-300/90 border border-amber-500/20 bg-amber-500/10 rounded-lg px-2 py-1.5">
              {t("api_key_desc")}
            </p>
          )}
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">{t("gemini_api_key_label")}</span>
            <input
              type="password"
              value={settings.gemini_api_key}
              onChange={(e) => onPatchSettings({ gemini_api_key: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="AIza…"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs space-y-1">
              <span className="text-slate-400">{t("gemini_llm_label")}</span>
              <select
                value={settings.gemini_llm_model}
                onChange={(e) => onPatchSettings({ gemini_llm_model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              >
                {[
                  "gemini-2.0-flash",
                  "gemini-2.0-flash-lite",
                  "gemini-1.5-flash",
                  "gemini-1.5-pro",
                  settings.gemini_llm_model,
                ]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-xs space-y-1">
              <span className="text-slate-400">{t("gemini_embed_label")}</span>
              <select
                value={settings.gemini_embed_model}
                onChange={(e) => onPatchSettings({ gemini_embed_model: e.target.value })}
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              >
                {["text-embedding-004", "embedding-001", settings.gemini_embed_model]
                  .filter((v, i, a) => a.indexOf(v) === i)
                  .map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </div>
      )}

      {/* OpenAI API panel */}
      {settings.ai_provider === "openai" && (
        <div className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-950/20 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> OpenAI API
          </h3>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">OpenAI API key</span>
            <input
              type="password"
              value={settings.openai_api_key || ""}
              onChange={(e) => onPatchSettings({ openai_api_key: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="sk-..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">OpenAI model (classify / extract)</span>
            <input
              type="text"
              value={settings.openai_llm_model || ""}
              onChange={(e) => onPatchSettings({ openai_llm_model: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>
      )}

      {/* Groq API panel */}
      {settings.ai_provider === "groq" && (
        <div className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-950/20 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Groq API
          </h3>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">Groq API key</span>
            <input
              type="password"
              value={settings.groq_api_key || ""}
              onChange={(e) => onPatchSettings({ groq_api_key: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="gsk_..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">Groq model (classify / extract)</span>
            <input
              type="text"
              value={settings.groq_llm_model || ""}
              onChange={(e) => onPatchSettings({ groq_llm_model: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="llama-3.3-70b-versatile"
            />
          </label>
        </div>
      )}

      {/* OpenRouter API panel */}
      {settings.ai_provider === "openrouter" && (
        <div className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-950/20 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> OpenRouter API
          </h3>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">OpenRouter API key</span>
            <input
              type="password"
              value={settings.openrouter_api_key || ""}
              onChange={(e) => onPatchSettings({ openrouter_api_key: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="sk-or-v1-..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">OpenRouter model (classify / extract)</span>
            <input
              type="text"
              value={settings.openrouter_llm_model || ""}
              onChange={(e) => onPatchSettings({ openrouter_llm_model: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="meta-llama/llama-3.3-70b-instruct"
            />
          </label>
        </div>
      )}

      {/* Anthropic Claude panel */}
      {settings.ai_provider === "anthropic" && (
        <div className="space-y-3 rounded-xl border border-violet-500/30 bg-violet-950/20 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Anthropic Claude API
          </h3>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">Anthropic API key</span>
            <input
              type="password"
              value={settings.anthropic_api_key || ""}
              onChange={(e) => onPatchSettings({ anthropic_api_key: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="sk-ant-..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">Anthropic model (classify / extract)</span>
            <input
              type="text"
              value={settings.anthropic_llm_model || ""}
              onChange={(e) => onPatchSettings({ anthropic_llm_model: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="claude-3-5-haiku-latest"
            />
          </label>
        </div>
      )}

      {/* Custom Local OpenAI panel */}
      {settings.ai_provider === "local_openai" && (
        <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300 flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" /> Custom OpenAI Endpoint
          </h3>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">Base URL</span>
            <input
              type="text"
              value={settings.local_openai_base_url || ""}
              onChange={(e) => onPatchSettings({ local_openai_base_url: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="http://127.0.0.1:1234/v1"
            />
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">API Key (optional)</span>
            <input
              type="password"
              value={settings.local_openai_api_key || ""}
              onChange={(e) => onPatchSettings({ local_openai_api_key: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
            />
          </label>
          <label className="block text-xs space-y-1">
            <span className="text-slate-400">Model name</span>
            <input
              type="text"
              value={settings.local_openai_llm_model || ""}
              onChange={(e) => onPatchSettings({ local_openai_llm_model: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-2 py-1.5 text-sm font-mono"
              placeholder="meta-llama-3-8b-instruct"
            />
          </label>
        </div>
      )}

      {/* Security & Encryption Panel */}
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/40 p-5 mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-indigo-300 flex items-center gap-1.5 pb-2 border-b border-slate-800">
          <Shield className="w-4 h-4" /> {t("sec_title")}
        </h3>

        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400">Vault Encryption Status:</span>
          <span className={`px-2 py-0.5 rounded text-[10px] border ${
            vaultStatus?.encryption_enabled
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300 font-medium"
              : "bg-slate-500/10 border-slate-800 text-slate-500"
          }`}>
            {vaultStatus?.encryption_enabled ? t("sec_status_enabled") : t("sec_status_disabled")}
          </span>
        </div>

        {vaultStatus?.encryption_enabled ? (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Your vault is fully encrypted with AES-256-GCM. To remove encryption and convert data back to plain text, enter your current master password:
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={secPassword}
                onChange={(e) => setSecPassword(e.target.value)}
                placeholder={t("sec_password_placeholder")}
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleRemovePassword}
                className="px-3 py-1.5 rounded-lg bg-rose-950/40 hover:bg-rose-900 border border-rose-900/30 text-rose-300 text-xs font-medium transition-colors"
              >
                {t("sec_remove_btn")}
              </button>
            </div>
            {secError && <p className="text-[10px] text-rose-400 font-mono">{secError}</p>}
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] text-slate-400 leading-relaxed">
              {t("sec_setup_subtitle")}
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={secPassword}
                onChange={(e) => setSecPassword(e.target.value)}
                placeholder="Set master password..."
                className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs font-mono text-white focus:outline-none focus:border-indigo-500"
              />
              <button
                type="button"
                onClick={handleSetupPassword}
                className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
              >
                {t("sec_setup_btn")}
              </button>
            </div>
            {secError && <p className="text-[10px] text-rose-400 font-mono">{secError}</p>}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        {t("vault_data_location")}
      </p>

      <button
        type="button"
        onClick={onSaveSettings}
        className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-sm font-medium"
      >
        {t("save_settings_btn")}
      </button>
    </div>
  );
};
