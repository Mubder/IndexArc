import { Sparkles } from "lucide-react";
import { SavedBadge, KeyInput } from "./fields";
import type { Settings } from "../../types";

export interface CloudKeyPanelsProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
}

export function CloudKeyPanels({ onPatchSettings, settings }: CloudKeyPanelsProps) {
  return (
    <>
      {settings.ai_provider === "openai" && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--accent-bright)" }}>
            <Sparkles className="w-3.5 h-3.5" /> OpenAI API
          </h3>
          <label className="block text-xs space-y-1">
            <span className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
              OpenAI API key <SavedBadge ok={settings.openai_api_key_configured} />
            </span>
            <KeyInput
              field="openai_api_key"
              configured={settings.openai_api_key_configured}
              placeholder="sk-..."
              onCommit={onPatchSettings}
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
            <span className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
              Groq API key <SavedBadge ok={settings.groq_api_key_configured} />
            </span>
            <KeyInput
              field="groq_api_key"
              configured={settings.groq_api_key_configured}
              placeholder="gsk_..."
              onCommit={onPatchSettings}
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
            <span className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
              OpenRouter API key <SavedBadge ok={settings.openrouter_api_key_configured} />
            </span>
            <KeyInput
              field="openrouter_api_key"
              configured={settings.openrouter_api_key_configured}
              placeholder="sk-or-v1-..."
              onCommit={onPatchSettings}
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
            <span className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
              Anthropic API key <SavedBadge ok={settings.anthropic_api_key_configured} />
            </span>
            <KeyInput
              field="anthropic_api_key"
              configured={settings.anthropic_api_key_configured}
              placeholder="sk-ant-..."
              onCommit={onPatchSettings}
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
    </>
  );
}
