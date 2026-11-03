import { Server } from "lucide-react";
import type { Settings, SystemStatus } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface OllamaPanelProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  onWarmOllama: () => Promise<void>;
  settings: Settings;
  status: SystemStatus | null;
  t: (key: keyof TranslationDict) => string;
}

export function OllamaPanel({ onPatchSettings, onWarmOllama, settings, status, t }: OllamaPanelProps) {
  return (
    <>
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
                    m.startsWith((settings.ollama_llm_model || "").split(":")[0])
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
                    m.startsWith((settings.ollama_embed_model || "").split(":")[0])
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
    </>
  );
}
