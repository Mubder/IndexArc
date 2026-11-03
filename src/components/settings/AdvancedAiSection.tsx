import { Sparkles } from "lucide-react";
import type { Settings } from "../../types";

export interface AdvancedAiSectionProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
}

export function AdvancedAiSection({ onPatchSettings, settings }: AdvancedAiSectionProps) {
  return (
    <>
      {/* Advanced AI Settings - Mix providers */}
      <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--text)" }}>
          <Sparkles className="w-3.5 h-3.5" /> Advanced AI Settings
        </h3>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Override which provider is used for LLM generation and embeddings. Useful for using LM Studio for LLMs while keeping Ollama for embeddings.
        </p>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs space-y-1">
              <span style={{ color: "var(--text-dim)" }}>LLM Provider Override</span>
              <select
                value={settings.llm_provider_override || "default"}
                onChange={(e) => onPatchSettings({ llm_provider_override: e.target.value || undefined })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              >
                <option value="default">Default (auto)</option>
                <option value="local">Local Ollama</option>
                <option value="api">Google Gemini</option>
                <option value="openai">OpenAI API</option>
                <option value="groq">Groq API</option>
                <option value="openrouter">OpenRouter</option>
                <option value="anthropic">Anthropic</option>
                <option value="local_openai">Custom OpenAI (LM Studio)</option>
                <option value="heuristic">Heuristic (no AI)</option>
              </select>
            </label>
          </div>
          <div>
            <label className="block text-xs space-y-1">
              <span style={{ color: "var(--text-dim)" }}>Embed Provider Override</span>
              <select
                value={settings.embed_provider_override || "default"}
                onChange={(e) => onPatchSettings({ embed_provider_override: e.target.value || undefined })}
                className="w-full rounded-lg px-2 py-1.5 text-sm"
                style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              >
                <option value="default">Default (auto)</option>
                <option value="local">Local Ollama</option>
                <option value="api">Google Gemini</option>
                <option value="openai">OpenAI API</option>
                <option value="local_openai">Custom OpenAI (LM Studio)</option>
              </select>
            </label>
          </div>
        </div>
        <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          Tip: Use LM Studio (local_openai) for LLM and Ollama (local) for embeddings for mixed local models.
        </p>
      </div>
    </>
  );
}
