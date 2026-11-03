import { Server, Sparkles } from "lucide-react";
import type { Settings, SystemStatus } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface ProviderPickerProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  status: SystemStatus | null;
  t: (key: keyof TranslationDict) => string;
}

export function ProviderPicker({ onPatchSettings, settings, status, t }: ProviderPickerProps) {
  return (
    <>
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
    </>
  );
}
