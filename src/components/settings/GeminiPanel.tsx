import { Sparkles } from "lucide-react";
import { SavedBadge, KeyInput } from "./fields";
import type { Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface GeminiPanelProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  t: (key: keyof TranslationDict) => string;
}

export function GeminiPanel({ onPatchSettings, settings, t }: GeminiPanelProps) {
  return (
    <>
      {(settings.ai_provider === "api" || settings.ai_provider === "auto") && (
        <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--accent-bg)", border: "1px solid var(--border-glow)" }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--accent-bright)" }}>
            <Sparkles className="w-3.5 h-3.5" /> {t("cloud_api_title")}
          </h3>
          {!settings.gemini_api_key_configured && settings.ai_provider === "api" && (
            <p className="text-[11px] px-2 py-1.5 rounded-lg" style={{ color: "var(--amber)", background: "var(--amber-bg)", border: "1px solid rgba(251, 191, 36, 0.2)" }}>
              {t("api_key_desc")}
            </p>
          )}
          <label className="block text-xs space-y-1">
            <span className="flex items-center gap-1.5" style={{ color: "var(--text-dim)" }}>
              {t("gemini_api_key_label")} <SavedBadge ok={settings.gemini_api_key_configured} />
            </span>
            <KeyInput
              field="gemini_api_key"
              configured={settings.gemini_api_key_configured}
              placeholder="AIza…"
              onCommit={onPatchSettings}
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
    </>
  );
}
