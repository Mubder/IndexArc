import { Settings } from "../../types";
import { readJson } from "../../utils";
import type { Dispatch, SetStateAction, RefObject } from "react";

export interface UseSettingsActionsArgs {
  fetchAll: () => Promise<void>;
  setSettings: Dispatch<SetStateAction<Settings | null>>;
  settings: Settings | null;
  settingsDirtyRef: RefObject<boolean>;
  showToast: (message: string, type?: "success" | "error" | "info") => void;
}

// Save settings and warm the local Ollama models.
// Moved verbatim from App.tsx (R3.4); App wires the inputs.
export function useSettingsActions({ fetchAll, setSettings, settings, settingsDirtyRef, showToast }: UseSettingsActionsArgs) {
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
      // When using local/auto, ensure models exist and warm the LLM into memory
      if (settings.ai_provider === "local" || settings.ai_provider === "auto") {
        try {
          await fetch("/api/ollama/ensure", { method: "POST" });
        } catch {
          /* optional */
        }
      }
      fetchAll();
      showToast("Settings saved · تم الحفظ", "success");
    } catch (e: any) {
      showToast(e?.message || "Settings save failed / فشل حفظ الإعدادات", "error");
    }
  };

  const warmOllama = async () => {
    try {
      showToast("Loading LLM into memory... · جارٍ التحميل", "info");
      const res = await fetch("/api/ollama/warm", { method: "POST" });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || "Warm failed");
      const parts = [`classify: ${data.model}`];
      if (data.embed_model) parts.push(`embed: ${data.embed_model}`);
      showToast(`Models loaded · ${parts.join(" · ")}`, "success");
      fetchAll();
    } catch (e: any) {
      showToast(e.message || "Could not load Ollama LLM", "error");
    }
  };

  return { saveSettings, warmOllama };
}
