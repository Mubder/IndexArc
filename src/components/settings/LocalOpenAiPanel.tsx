import { Server } from "lucide-react";
import { SavedBadge, KeyInput } from "./fields";
import type { Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface LocalOpenAiPanelProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  t: (key: keyof TranslationDict) => string;
}

export function LocalOpenAiPanel({ onPatchSettings, settings, t }: LocalOpenAiPanelProps) {
  return (
    <>
      {settings.ai_provider === "local_openai" && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
            <Server className="w-3.5 h-3.5" /> {t("local_openai_title")}
          </h3>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>{t("local_openai_base_url")}</span>
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
            <span className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
              {t("local_openai_api_key")} <SavedBadge ok={settings.local_openai_api_key_configured} t={t} />
            </span>
            <KeyInput
              field="local_openai_api_key"
              configured={settings.local_openai_api_key_configured}
              onCommit={onPatchSettings}
              t={t}
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>{t("local_openai_model")}</span>
            <input
              type="text"
              value={settings.local_openai_llm_model || ""}
              onChange={(e) => onPatchSettings({ local_openai_llm_model: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder="meta-llama-3-8b-instruct"
            />
          </label>
          <label className="block text-xs space-y-1">
            <span style={{ color: "var(--text-dim)" }}>{t("local_openai_embed_model")}</span>
            <input
              type="text"
              value={settings.local_openai_embed_model || ""}
              onChange={(e) => onPatchSettings({ local_openai_embed_model: e.target.value })}
              className="w-full rounded-lg px-2 py-1.5 text-sm"
              style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
              placeholder={`bge-m3 (${t("local_openai_embed_default")})`}
            />
          </label>
        </div>
      )}
    </>
  );
}
