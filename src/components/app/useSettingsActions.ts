import { Settings } from "../../types";
import { readJson } from "../../utils";
import type { Dispatch, SetStateAction, RefObject } from "react";
import type { TranslationDict } from "../../utils/i18n";

export interface UseSettingsActionsArgs {
  fetchAll: () => Promise<void>;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  settings: Settings | null;
  settingsDirtyRef: RefObject<boolean>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
  t: (key: keyof TranslationDict) => string;
}

// Save settings and warm the local Ollama models.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useSettingsActions({ fetchAll, setSettings, settings, settingsDirtyRef, showToast, t }: UseSettingsActionsArgs) {
  const saveSettings = async () => {
    if (!settings) return;
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) {
        // Never claim success on a refused save — the user believes API keys
        // and model picks persisted when they didn't.
        const err = await res.json().catch(() => null);
        throw new Error(err?.error || `Save failed (HTTP ${res.status})`);
      }
      const saved = await res.json().catch(() => settings);
      settingsDirtyRef.current = false;
      if (saved && typeof saved === "object" && saved.ai_provider) {
        setSettings(saved as Settings);
      }
      // The save has landed: confirm now. Model prep below can take minutes
      // (it may pull a model), and used to hold this toast back the whole time.
      showToast(t("toast_settings_saved"), "success");
      fetchAll();
      // When using local/auto, ensure models exist and warm the LLM into
      // memory in the background, then refresh the AI status.
      if (settings.ai_provider === "local" || settings.ai_provider === "auto") {
        fetch("/api/ollama/ensure", { method: "POST" })
          .then(() => fetchAll())
          .catch(() => {
            /* optional */
          });
      }
    } catch (e: any) {
      showToast(e?.message || t("toast_settings_save_failed"), "error");
    }
  };

  const warmOllama = async () => {
    try {
      showToast(t("toast_loading_llm"), "info");
      const res = await fetch("/api/ollama/warm", { method: "POST" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || t("toast_warm_failed"));
      const parts = [`classify: ${data.model}`];
      if (data.embed_model) parts.push(`embed: ${data.embed_model}`);
      showToast(`${t("toast_models_loaded")} · ${parts.join(" · ")}`, "success");
      fetchAll();
    } catch (e: any) {
      showToast(e.message || t("toast_llm_load_failed"), "error");
    }
  };

  return { saveSettings, warmOllama };
}
