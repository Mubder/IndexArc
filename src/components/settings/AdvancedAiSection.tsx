import { Sparkles } from "lucide-react";
import type { Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface AdvancedAiSectionProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  t: (key: keyof TranslationDict) => string;
}

export function AdvancedAiSection({ onPatchSettings, settings, t }: AdvancedAiSectionProps) {
  return (
    <>
      {/* Advanced AI Settings - Mix providers */}
      <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text)" }}>
          <Sparkles className="w-3.5 h-3.5" /> {t("adv_ai_title")}
        </h3>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {t("adv_ai_desc")}
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs space-y-1">
              <span style={{ color: "var(--text-dim)" }}>{t("adv_ai_llm_override")}</span>
              <select
                value={settings.llm_provider_override || "default"}
                onChange={(e) => onPatchSettings({ llm_provider_override: e.target.value || undefined })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              >
                <option value="default">{t("adv_ai_default_auto")}</option>
                <option value="local">{t("provider_local_ollama")}</option>
                <option value="api">Google Gemini</option>
                <option value="openai">OpenAI API</option>
                <option value="groq">Groq API</option>
                <option value="openrouter">OpenRouter</option>
                <option value="anthropic">Anthropic</option>
                <option value="local_openai">{t("provider_custom_openai_lmstudio")}</option>
                <option value="heuristic">{t("provider_heuristic")}</option>
              </select>
            </label>
          </div>
          <div>
            <label className="block text-xs space-y-1">
              <span style={{ color: "var(--text-dim)" }}>{t("adv_ai_embed_override")}</span>
              <select
                value={settings.embed_provider_override || "default"}
                onChange={(e) => onPatchSettings({ embed_provider_override: e.target.value || undefined })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              >
                <option value="default">{t("adv_ai_default_auto")}</option>
                <option value="local">{t("provider_local_ollama")}</option>
                <option value="api">Google Gemini</option>
                <option value="openai">OpenAI API</option>
                <option value="local_openai">{t("provider_custom_openai_lmstudio")}</option>
              </select>
            </label>
          </div>
        </div>
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {t("adv_ai_tip")}
        </p>
      </div>
    </>
  );
}
