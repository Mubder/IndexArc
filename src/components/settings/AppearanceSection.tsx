import type { Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface AppearanceSectionProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  t: (key: keyof TranslationDict) => string;
}

export function AppearanceSection({ onPatchSettings, settings, t }: AppearanceSectionProps) {
  return (
    <>
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

      <div className="space-y-2" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          {t("font_size_en_label")}
        </h2>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {t("font_size_en_desc")}
        </p>
        <input
          type="range"
          min="10"
          max="24"
          step="1"
          value={settings.font_size_en || 14}
          onChange={(e) => onPatchSettings({ font_size_en: parseInt(e.target.value) })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer"
          style={{
            background: "var(--bg-input)",
            accentColor: "var(--accent)",
          }}
        />
        <div className="flex justify-between items-center text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span style={{ fontSize: `${settings.font_size_en || 14}px`, color: "var(--text)" }}>
            English Font Preview — IndexArc
          </span>
          <span>{settings.font_size_en || 14}px</span>
        </div>
      </div>

      <div className="space-y-2" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          {t("font_size_ar_label")}
        </h2>
        <p className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {t("font_size_ar_desc")}
        </p>
        <input
          type="range"
          min="10"
          max="24"
          step="1"
          value={settings.font_size_ar || 16}
          onChange={(e) => onPatchSettings({ font_size_ar: parseInt(e.target.value) })}
          className="w-full h-2 rounded-lg appearance-none cursor-pointer"
          style={{
            background: "var(--bg-input)",
            accentColor: "var(--accent)",
          }}
        />
        <div className="flex justify-between items-center text-[11px]" style={{ color: "var(--text-muted)" }}>
          <span dir="rtl" lang="ar" className="font-arabic" style={{ fontSize: `${settings.font_size_ar || 16}px`, color: "var(--text)" }}>
            معاينة حجم الخط العربي — IndexArc
          </span>
          <span>{settings.font_size_ar || 16}px</span>
        </div>
      </div>

      <div className="space-y-4" style={{ borderBottom: "1px solid var(--border)", paddingBottom: "1.25rem" }}>
        <h2 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          {t("spellcheck_title")}
        </h2>
        
        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative flex items-center mt-0.5">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.enable_live_spellcheck !== false}
              onChange={(e) => onPatchSettings({ enable_live_spellcheck: e.target.checked })}
            />
            <div className="w-9 h-5 rounded-full transition-colors peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-var(--accent)/50" 
                 style={{ background: settings.enable_live_spellcheck !== false ? "var(--accent)" : "var(--bg-input)", border: "1px solid var(--border)" }}>
            </div>
            <div className="absolute left-[2px] top-[2px] w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-full shadow-sm"></div>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{t("spellcheck_live_label")}</span>
            <span className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("spellcheck_live_desc")}</span>
          </div>
        </label>

        <label className="flex items-start gap-3 cursor-pointer group">
          <div className="relative flex items-center mt-0.5">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={settings.enable_ai_proofreader !== false}
              onChange={(e) => onPatchSettings({ enable_ai_proofreader: e.target.checked })}
            />
            <div className="w-9 h-5 rounded-full transition-colors peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-var(--accent)/50" 
                 style={{ background: settings.enable_ai_proofreader !== false ? "var(--accent)" : "var(--bg-input)", border: "1px solid var(--border)" }}>
            </div>
            <div className="absolute left-[2px] top-[2px] w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-full shadow-sm"></div>
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{t("spellcheck_ai_label")}</span>
            <span className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("spellcheck_ai_desc")}</span>
          </div>
        </label>
      </div>
    </>
  );
}
