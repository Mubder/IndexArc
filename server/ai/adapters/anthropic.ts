import type { AppSettings } from "../../types.js";
import { addLog } from "../../logs.js";
import type { ProviderAdapter } from "./types.js";

async function anthropicGenerate(settings: AppSettings, prompt: string, system: string): Promise<string | null> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.anthropic_api_key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: settings.anthropic_llm_model,
        system,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 4096,
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      addLog("ANTHROPIC", `HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as {
      content?: { type: string; text: string }[];
      error?: any;
    };

    if (data.error) {
      addLog("ANTHROPIC", `API Error: ${JSON.stringify(data.error)}`);
      return null;
    }

    return data.content?.[0]?.text?.trim() || null;
  } catch (e: any) {
    addLog("ANTHROPIC", `Fetch failed: ${e.message}`);
    return null;
  }
}

// No embeddings API: entries index by keyword only under this provider.
export const anthropicAdapter: ProviderAdapter = {
  id: "anthropic",
  label: "anthropic",
  displayName: "Anthropic",
  auto: true,
  isLocal: () => false,
  ready: async (s) => !!s.anthropic_api_key,
  model: (s) => s.anthropic_llm_model,
  generate: (s, req) => anthropicGenerate(s, req.prompt, req.system),
};
