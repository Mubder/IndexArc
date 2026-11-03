import { Lock } from "lucide-react";
import type { Settings } from "../../types";
import type { TranslationDict } from "../../utils/i18n";

export interface PrivacySectionProps {
  onPatchSettings: (patch: Partial<Settings>) => void;
  settings: Settings;
  t: (key: keyof TranslationDict) => string;
}

export function PrivacySection({ onPatchSettings, settings, t }: PrivacySectionProps) {
  return (
    <>
      {/* Auto-Lock */}
      <div className="space-y-3 rounded-xl p-4" style={{ background: "var(--bg-surface)", border: "1px solid var(--border)" }}>
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--cyan)" }}>
          <Lock className="w-3.5 h-3.5" /> {t("autolock_section_title")}
        </h3>
        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("autolock_minutes_label")}</span>
          <input
            type="number"
            min={0}
            max={1440}
            value={settings.auto_lock_minutes ?? 5}
            onChange={(e) => onPatchSettings({ auto_lock_minutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)) })}
            className="w-28 rounded-lg px-2 py-1.5 text-sm"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
          />
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("autolock_desc")}</p>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!settings.lock_on_minimize}
            onChange={(e) => onPatchSettings({ lock_on_minimize: e.target.checked })}
            className="accent-blue-500"
          />
          <span className="text-xs" style={{ color: "var(--text)" }}>{t("autolock_minimize_label")}</span>
        </label>
        <label className="block text-xs space-y-1">
          <span style={{ color: "var(--text-dim)" }}>{t("clipboard_clear_label")}</span>
          <input
            type="number"
            min={0}
            max={600}
            value={settings.clipboard_clear_seconds ?? 45}
            onChange={(e) => onPatchSettings({ clipboard_clear_seconds: Math.max(0, Math.min(600, Number(e.target.value) || 0)) })}
            className="w-28 rounded-lg px-2 py-1.5 text-sm"
            style={{ background: "var(--bg-input)", border: "1px solid var(--border-input)", color: "var(--text)", fontFamily: "var(--font-mono)" }}
          />
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("clipboard_clear_desc")}</p>
        </label>
      </div>

      {/* Egress consent — audit H2: cloud AI and the public LanguageTool API
          stay disabled until the user explicitly opts in. */}
      <div
        className="space-y-3 rounded-xl p-4"
        style={{ background: "var(--amber-bg)", border: "1px solid rgba(251, 191, 36, 0.25)" }}
      >
        <h3 className="text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5" style={{ color: "var(--amber)" }}>
          ⚠ {t("egress_title")}
        </h3>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.ai_cloud_consent === true}
            onChange={(e) => onPatchSettings({ ai_cloud_consent: e.target.checked })}
          />
          <div
            className="w-9 h-5 rounded-full transition-colors peer-focus:outline-none"
            style={{ background: settings.ai_cloud_consent ? "var(--amber)" : "var(--bg-input)", border: "1px solid var(--border)" }}
          >
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{t("egress_cloud_label")}</span>
            <span className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("egress_cloud_desc")}</span>
          </div>
        </label>
        <label className="flex items-center gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            className="sr-only peer"
            checked={settings.languagetool_enabled === true}
            onChange={(e) => onPatchSettings({ languagetool_enabled: e.target.checked })}
          />
          <div
            className="w-9 h-5 rounded-full transition-colors peer-focus:outline-none"
            style={{ background: settings.languagetool_enabled ? "var(--amber)" : "var(--bg-input)", border: "1px solid var(--border)" }}
          >
          </div>
          <div className="flex flex-col">
            <span className="text-xs font-medium" style={{ color: "var(--text)" }}>{t("egress_lt_label")}</span>
            <span className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{t("egress_lt_desc")}</span>
          </div>
        </label>
      </div>
    </>
  );
}
