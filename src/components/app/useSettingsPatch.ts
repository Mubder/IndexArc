import { useCallback } from "react";
import { Settings } from "../../types";
import type { Dispatch, SetStateAction, RefObject } from "react";

export interface UseSettingsPatchArgs {
  patchTimerRef: RefObject<ReturnType<typeof setTimeout> | null>;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  settings: Settings | null;
  settingsDirtyRef: RefObject<boolean>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

// Debounced settings patches (marks settings dirty so fetchAll does not clobber edits) and the language toggle.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useSettingsPatch({ patchTimerRef, setSettings, settings, settingsDirtyRef, showToast }: UseSettingsPatchArgs) {
  const patchSettings = useCallback((patch: Partial<Settings>) => {
    settingsDirtyRef.current = true;
    setSettings((prev) => {
      const next = prev ? { ...prev, ...patch } : (patch as Settings);
      if (next) {
        localStorage.setItem(
          "indexarc-settings-preset",
          JSON.stringify({
            font_size_en: next.font_size_en || 14,
            font_size_ar: next.font_size_ar || 16,
            ui_language: next.ui_language || "en",
          })
        );
      }
      return next;
    });

    if (patchTimerRef.current) clearTimeout(patchTimerRef.current);
    patchTimerRef.current = setTimeout(() => {
      fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((saved) => {
          settingsDirtyRef.current = false;
          if (saved && typeof saved === "object" && (saved as Settings).ai_provider) {
            // The server masks API keys (writes them as ""). Never let a
            // masked response wipe locally stored key material — merge
            // server fields while preserving non-empty local key values.
            // Without this, every settings save replaced the whole settings
            // object with a masked copy, and components below the first
            // edited toggle (e.g. the egress card at the top of SettingsTab)
            // re-rendered with blanked keys — visually "cut in half."
            const KEY_FIELDS = [
              "gemini_api_key",
              "openai_api_key",
              "groq_api_key",
              "openrouter_api_key",
              "anthropic_api_key",
              "local_openai_api_key",
            ] as const;
            setSettings((prev) => {
              const merged = { ...prev, ...saved };
              for (const k of KEY_FIELDS) {
                if (merged[k] === "" && prev?.[k]) {
                  merged[k] = prev[k];
                }
              }
              return merged;
            });
          }
        })
        .catch(() => {
          settingsDirtyRef.current = false;
          showToast("Settings change may not have saved / قد لا يكون الحفظ قد تم", "error");
        });
    }, 300);
  }, []);

  // Language toggle routes through patchSettings: pure state update + the
  // debounced persist path (the old version POSTed inside a setState updater,
  // which StrictMode double-invokes).
  const toggleLanguage = useCallback(() => {
    const current = settings?.ui_language || "en";
    const next = (current === "en" ? "ar" : "en") as "ar" | "en";
    patchSettings({ ui_language: next });
  }, [settings, patchSettings]);

  return { patchSettings, toggleLanguage };
}
