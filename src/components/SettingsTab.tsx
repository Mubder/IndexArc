import React from "react";
import { Server, Sparkles, Shield, Lock, Unlock, LifeBuoy, Save, RotateCcw, HardDriveDownload, Terminal } from "lucide-react";
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
  logs: { time: string; type: string; message: string }[];
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  settings,
  onPatchSettings,
  status,
  onWarmOllama,
  onSaveSettings,
  vaultStatus,
  onRefreshVaultStatus,
  logs,
}) => {
  const t = (key: Parameters<typeof getTranslation>[1]) => getTranslation(settings, key);

  const [secPassword, setSecPassword] = React.useState("");
  const [secError, setSecError] = React.useState("");

  type EmergencySnapshot = {
    name: string;
    size: number;
    created_at: string;
    encrypted: boolean;
    locations: string[];
  };
  const [snapshots, setSnapshots] = React.useState<EmergencySnapshot[]>([]);
  const [emgBusy, setEmgBusy] = React.useState(false);
  const [emgMsg, setEmgMsg] = React.useState("");
  const [confirmRestore, setConfirmRestore] = React.useState<string | null>(null);

  const loadSnapshots = React.useCallback(async () => {
    try {
      const res = await fetch("/api/emergency");
      const data = await res.json();
      setSnapshots(Array.isArray(data.snapshots) ? data.snapshots : []);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  const handleCreateSnapshot = async () => {
    setEmgBusy(true);
    setEmgMsg("");
    try {
      const res = await fetch("/api/emergency/create", { method: "POST" });
      const data = await res.json();
      setEmgMsg(
        data.ok
          ? t("emergency_created")
          : t("emergency_nochange")
      );
      await loadSnapshots();
    } catch (err: any) {
      setEmgMsg(err.message || "Failed");
    } finally {
      setEmgBusy(false);
    }
  };

  const handleRestoreSnapshot = async (name: string) => {
    setEmgBusy(true);
    setEmgMsg("");
    try {
      const res = await fetch("/api/emergency/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (data.ok) {
        setEmgMsg(t("emergency_restored"));
        onRefreshVaultStatus();
        await loadSnapshots();
        setTimeout(() => window.location.reload(), 1200);
      } else {
        setEmgMsg(data.error || "Restore failed");
      }
    } catch (err: any) {
      setEmgMsg(err.message || "Failed");
    } finally {
      setEmgBusy(false);
      setConfirmRestore(null);
    }
  };

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return iso;
    }
  };

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
    <div className="rounded-2xl p-6 space-y-5 max-w-xl" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
      <div className="space-y-2" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          {t("ui_language_label")}
        </h2>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {t("ui_language_desc")}
        </p>
        <div className="flex gap-2 pt-1">
          {(["en", "ar"] as const).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => onPatchSettings({ ui_language: lang })}
              className="px-4 py-2 rounded-xl text-xs font-medium transition-all"
              style={{
                background: settings.ui_language === lang ? "var(--accent)" : "transparent",
                color: settings.ui_language === lang ? "white" : "var(--text-muted)",
                border: `1px solid ${settings.ui_language === lang ? "var(--accent)" : "var(--border)"}`,
              }}
            >
              {lang === "en" && "English (EN)"}
              {lang === "ar" && "العربية (AR)"}
            </button>
          ))}
        </div>
      </div>

      <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("ai_provider_choice")}</h2>
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
            className="px-3 py-2 rounded-xl text-xs font-medium transition-all"
            style={{
              background: settings.ai_provider === m ? "var(--accent)" : "transparent",
              color: settings.ai_provider === m ? "white" : "var(--text-muted)",
              border: `1px solid ${settings.ai_provider === m ? "var(--accent)" : "var(--border)"}`,
            }}
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
      <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
        {t("active_now")}:{" "}
        <span style={{ color: "var(--cyan)", fontFamily: "var(--font-mono)" }}>{status?.active_provider || "…"}</span>
        {settings.ai_provider === "auto" && ` · ${t("auto_desc")}`}
      </p>

      {(settings.ai_provider === "local" || settings.ai_provider === "auto") && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
              <Server className="w-3.5 h-3.5" /> {t("local_ollama_title")}
            </h3>
            <span
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={status?.is_ollama_online
                ? { color: "var(--emerald)", background: "var(--emerald-bg)", border: "1px solid rgba(52, 211, 153, 0.2)" }
                : { color: "var(--danger)", background: "var(--danger-bg)", border: "1px solid rgba(248, 113, 113, 0.2)" }
              }
            >
              {status?.is_ollama_online ? t("online") : t("offline")}
            </span>
          </div>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>{t("ollama_base_url")}</span>
            <input
              value={settings.ollama_base_url}
              onChange={(e) => onPatchSettings({ ollama_base_url: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs space-y-1">
              <span style={{ color: "var(--text-dim)" }}>{t("llm_classify")}</span>
              <select
                value={settings.ollama_llm_model}
                onChange={(e) => onPatchSettings({ ollama_llm_model: e.target.value })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
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
                className="w-full rounded-lg px-2 py-1 text-[11px]"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                placeholder={t("ollama_placeholder")}
              />
            </label>
            <label className="block text-xs space-y-1">
              <span style={{ color: "var(--text-dim)" }}>{t("embed_search")}</span>
              <select
                value={settings.ollama_embed_model}
                onChange={(e) => onPatchSettings({ ollama_embed_model: e.target.value })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
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
                className="w-full rounded-lg px-2 py-1 text-[11px]"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}
                placeholder={t("ollama_placeholder")}
              />
            </label>
          </div>
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
            {t("ollama_llm_desc")}
          </p>
          <button
            type="button"
            onClick={onWarmOllama}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            {t("load_llm_btn")}
          </button>
        </div>
      )}

      {(settings.ai_provider === "api" || settings.ai_provider === "auto") && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--accent-bright)" }}>
            <Sparkles className="w-3.5 h-3.5" /> {t("cloud_api_title")}
          </h3>
          {!settings.gemini_api_key && settings.ai_provider === "api" && (
            <p className="text-[11px] px-2 py-1.5 rounded-lg" style={{ color: "var(--amber)", background: "var(--amber-bg)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>
              {t("api_key_desc")}
            </p>
          )}
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>{t("gemini_api_key_label")}</span>
            <input
              type="password"
              value={settings.gemini_api_key}
              onChange={(e) => onPatchSettings({ gemini_api_key: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="AIza…"
            />
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block text-xs space-y-1">
              <span style={{ color: "var(--text-dim)" }}>{t("gemini_llm_label")}</span>
              <select
                value={settings.gemini_llm_model}
                onChange={(e) => onPatchSettings({ gemini_llm_model: e.target.value })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
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
              <span style={{ color: "var(--text-dim)" }}>{t("gemini_embed_label")}</span>
              <select
                value={settings.gemini_embed_model}
                onChange={(e) => onPatchSettings({ gemini_embed_model: e.target.value })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
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

      {settings.ai_provider === "openai" && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--accent-bright)" }}>
            <Sparkles className="w-3.5 h-3.5" /> OpenAI API
          </h3>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>OpenAI API key</span>
            <input
              type="password"
              value={settings.openai_api_key || ""}
              onChange={(e) => onPatchSettings({ openai_api_key: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="sk-..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>OpenAI model (classify / extract)</span>
            <input
              type="text"
              value={settings.openai_llm_model || ""}
              onChange={(e) => onPatchSettings({ openai_llm_model: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="gpt-4o-mini"
            />
          </label>
        </div>
      )}

      {settings.ai_provider === "groq" && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--accent-bright)" }}>
            <Sparkles className="w-3.5 h-3.5" /> Groq API
          </h3>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>Groq API key</span>
            <input
              type="password"
              value={settings.groq_api_key || ""}
              onChange={(e) => onPatchSettings({ groq_api_key: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="gsk_..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>Groq model (classify / extract)</span>
            <input
              type="text"
              value={settings.groq_llm_model || ""}
              onChange={(e) => onPatchSettings({ groq_llm_model: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="llama-3.3-70b-versatile"
            />
          </label>
        </div>
      )}

      {settings.ai_provider === "openrouter" && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--accent-bright)" }}>
            <Sparkles className="w-3.5 h-3.5" /> OpenRouter API
          </h3>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>OpenRouter API key</span>
            <input
              type="password"
              value={settings.openrouter_api_key || ""}
              onChange={(e) => onPatchSettings({ openrouter_api_key: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="sk-or-v1-..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>OpenRouter model (classify / extract)</span>
            <input
              type="text"
              value={settings.openrouter_llm_model || ""}
              onChange={(e) => onPatchSettings({ openrouter_llm_model: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="meta-llama/llama-3.3-70b-instruct"
            />
          </label>
        </div>
      )}

      {settings.ai_provider === "anthropic" && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--accent-bright)" }}>
            <Sparkles className="w-3.5 h-3.5" /> Anthropic Claude API
          </h3>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>Anthropic API key</span>
            <input
              type="password"
              value={settings.anthropic_api_key || ""}
              onChange={(e) => onPatchSettings({ anthropic_api_key: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="sk-ant-..."
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>Anthropic model (classify / extract)</span>
            <input
              type="text"
              value={settings.anthropic_llm_model || ""}
              onChange={(e) => onPatchSettings({ anthropic_llm_model: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="claude-3-5-haiku-latest"
            />
          </label>
        </div>
      )}

      {settings.ai_provider === "local_openai" && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
            <Server className="w-3.5 h-3.5" /> Custom OpenAI Endpoint
          </h3>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>Base URL</span>
            <input
              type="text"
              value={settings.local_openai_base_url || ""}
              onChange={(e) => onPatchSettings({ local_openai_base_url: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="http://127.0.0.1:1234/v1"
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>API Key (optional)</span>
            <input
              type="password"
              value={settings.local_openai_api_key || ""}
              onChange={(e) => onPatchSettings({ local_openai_api_key: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>Model name</span>
            <input
              type="text"
              value={settings.local_openai_llm_model || ""}
              onChange={(e) => onPatchSettings({ local_openai_llm_model: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="meta-llama-3-8b-instruct"
            />
          </label>
        </div>
      )}

      <div className="space-y-4 rounded-xl p-5 mt-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 pb-2" style={{ color: "var(--accent-bright)", borderBottom: "1px solid var(--border)" }}>
          <Shield className="w-4 h-4" /> {t("sec_title")}
        </h3>

        <div className="flex items-center justify-between text-xs">
          <span style={{ color: "var(--text-dim)" }}>Vault Encryption Status:</span>
          <span
            className="px-2 py-0.5 rounded text-[10px]"
            style={vaultStatus?.encryption_enabled
              ? { color: "var(--emerald)", background: "var(--emerald-bg)", border: "1px solid rgba(52, 211, 153, 0.2)" }
              : { color: "var(--text-muted)", background: "var(--bg-input)", border: "1px solid var(--border)" }
            }
          >
            {vaultStatus?.encryption_enabled ? t("sec_status_enabled") : t("sec_status_disabled")}
          </span>
        </div>

        {vaultStatus?.encryption_enabled ? (
          <div className="space-y-3 pt-1">
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
              Your vault is fully encrypted with AES-256-GCM. To remove encryption and convert data back to plain text, enter your current master password:
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
                placeholder="Set master password..."
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

      <div className="space-y-4 rounded-xl p-5 mt-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5 pb-2" style={{ color: "var(--accent-bright)", borderBottom: "1px solid var(--border)" }}>
          <LifeBuoy className="w-4 h-4" /> {t("emergency_title")}
        </h3>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-dim)" }}>
          {t("emergency_desc")}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={emgBusy}
            onClick={handleCreateSnapshot}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: "var(--accent-bg)", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            <Save className="w-3.5 h-3.5" /> {t("emergency_create_btn")}
          </button>
          <button
            type="button"
            disabled={emgBusy}
            onClick={loadSnapshots}
            className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 disabled:opacity-50"
            style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
          >
            <RotateCcw className="w-3.5 h-3.5" /> {t("emergency_refresh_btn")}
          </button>
        </div>

        {emgMsg && (
          <p className="text-[10px] font-mono" style={{ color: "var(--emerald)" }}>{emgMsg}</p>
        )}

        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {snapshots.length === 0 && (
            <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t("emergency_empty")}
            </p>
          )}
          {snapshots.map((s) => (
            <div
              key={s.name}
              className="flex items-center justify-between gap-2 rounded-lg px-3 py-2"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}
            >
              <div className="min-w-0">
                <div className="text-[11px] flex items-center gap-1.5" style={{ color: "var(--text)" }}>
                  <HardDriveDownload className="w-3 h-3 shrink-0" style={{ color: "var(--cyan)" }} />
                  <span className="truncate" style={{ fontFamily: "var(--font-mono)" }}>{fmtDate(s.created_at)}</span>
                  {s.encrypted && (
                    <Lock className="w-3 h-3 shrink-0" style={{ color: "var(--emerald)" }} />
                  )}
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                  {(s.size / 1024).toFixed(1)} KB · {s.locations.length} {t("emergency_copies")}
                </div>
              </div>
              {confirmRestore === s.name ? (
                <div className="flex gap-1.5 shrink-0">
                  <button
                    type="button"
                    disabled={emgBusy}
                    onClick={() => handleRestoreSnapshot(s.name)}
                    className="px-2 py-1 rounded text-[10px] font-medium disabled:opacity-50"
                    style={{ background: "var(--danger-bg)", color: "var(--danger)", border: "1px solid rgba(248, 113, 113, 0.2)" }}
                  >
                    {t("emergency_confirm_restore")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmRestore(null)}
                    className="px-2 py-1 rounded text-[10px] font-medium"
                    style={{ background: "transparent", color: "var(--text-muted)", border: "1px solid var(--border)" }}
                  >
                    {t("identify_cancel_btn")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={emgBusy}
                  onClick={() => setConfirmRestore(s.name)}
                  className="px-2.5 py-1 rounded text-[10px] font-medium shrink-0 disabled:opacity-50"
                  style={{ background: "transparent", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
                >
                  {t("emergency_restore_btn")}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {t("vault_data_location")}
      </p>

      <div className="space-y-3 pt-2" style={{ borderTop: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between gap-2 pt-3">
          <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Terminal className="w-4 h-4" style={{ color: "var(--accent-bright)" }} /> {t("tab_logs")}
            <span className="text-[10px] font-normal px-1.5 py-0.5 rounded-full" style={{ background: "var(--bg-active)", color: "var(--text-muted)" }}>
              {logs.length}
            </span>
          </h2>
          <button
            type="button"
            disabled={!logs.length}
            onClick={() => {
              const text = logs.map((l) => `${l.time}\t${l.type}\t${l.message}`).join("\n");
              navigator.clipboard?.writeText(text);
            }}
            className="px-2.5 py-1 rounded-lg text-[10px] font-medium disabled:opacity-40"
            style={{ background: "transparent", color: "var(--accent-bright)", border: "1px solid var(--border-glow)" }}
          >
            {t("logs_copy_all")}
          </button>
        </div>
        <div className="rounded-xl p-4 font-mono text-[11px] h-[60vh] min-h-[320px] overflow-y-auto" style={{ background: "var(--bg-input)", border: "1px solid var(--border)" }}>
          {!logs.length && (
            <p className="text-center py-6" style={{ color: "var(--text-muted)" }}>No logs yet</p>
          )}
          {logs.slice().reverse().map((l, i) => (
            <div key={i} className="flex gap-3 py-1 border-b items-start" style={{ borderColor: "var(--border)" }}>
              <span className="shrink-0 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>{l.time}</span>
              <span className="shrink-0 w-24" style={{ color: "var(--accent-bright)" }}>{l.type}</span>
              <span className="break-all whitespace-pre-wrap" style={{ color: "var(--text-dim)" }}>{l.message}</span>
            </div>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onSaveSettings}
        className="px-4 py-2 rounded-xl text-sm font-medium transition-all"
        style={{ background: "var(--accent)", color: "white" }}
      >
        {t("save_settings_btn")}
      </button>
    </div>
  );
};
