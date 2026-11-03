import { GoogleGenAI } from "@google/genai";
import type { AppSettings } from "../../types.js";
import { addLog } from "../../logs.js";
import { callWithRetry } from "../../validate.js";
import type { GenerateRequest, ProviderAdapter } from "./types.js";

async function geminiGenerate(settings: AppSettings, req: GenerateRequest): Promise<string | null> {
  const ai = new GoogleGenAI({ apiKey: settings.gemini_api_key });
  const model = settings.gemini_llm_model;

  if (req.mode === "json") {
    // Errors propagate: the analyze caller logs them and falls back to heuristics.
    const response = await callWithRetry(
      (abortSignal) =>
        ai.models.generateContent({
          model,
          contents: req.prompt,
          config: {
            abortSignal,
            systemInstruction: req.system,
            responseMimeType: "application/json",
            ...(req.responseSchema ? { responseSchema: req.responseSchema as any } : {}),
          },
        }),
      { timeoutMs: 120_000, label: "Gemini analyze" }
    );
    return response.text || null;
  }

  if (req.mode === "complete") {
    // Autocomplete is latency-bound: a retry would land after the user typed on.
    const response = await callWithRetry(
      (abortSignal) =>
        ai.models.generateContent({
          model,
          contents: `${req.system}\n\nUser Text:\n${req.prompt}`,
          config: {
            abortSignal,
            temperature: 0.2,
            maxOutputTokens: req.maxTokens ?? 32,
          },
        }),
      { timeoutMs: 60_000, label: "Gemini autocomplete", retries: 0 }
    );
    return response.text || null;
  }

  if (!settings.gemini_api_key) return null;
  try {
    const response = await callWithRetry(
      (abortSignal) =>
        ai.models.generateContent({
          model,
          contents: req.prompt,
          config: {
            abortSignal,
            systemInstruction: req.system,
            temperature: 0.3,
          },
        }),
      { timeoutMs: 120_000, label: "Gemini generateText" }
    );
    return response.text || null;
  } catch (e: any) {
    addLog("GEMINI", `generateText failed: ${e.message}`);
    return null;
  }
}

async function geminiEmbed(settings: AppSettings, text: string): Promise<number[] | null> {
  if (!settings.gemini_api_key) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: settings.gemini_api_key });
    const res: any = await callWithRetry(
      (abortSignal) =>
        ai.models.embedContent({
          model: settings.gemini_embed_model,
          contents: text.slice(0, 8000),
          config: { abortSignal },
        }),
      { timeoutMs: 60_000, label: "Gemini embed" }
    );
    const values =
      res.embedding?.values ||
      res.embeddings?.[0]?.values ||
      res.embeddings?.values ||
      res.embedding;
    if (Array.isArray(values)) return values as number[];
  } catch (e: any) {
    addLog("GEMINI", `embed failed: ${e.message}`);
  }
  return null;
}

export const geminiAdapter: ProviderAdapter = {
  id: "api",
  label: "gemini",
  displayName: "Gemini",
  auto: true,
  isLocal: () => false,
  ready: async (s) => !!s.gemini_api_key,
  model: (s) => s.gemini_llm_model,
  generate: geminiGenerate,
  embed: geminiEmbed,
  embedModelId: (s) => `api:${s.gemini_embed_model}`,
};
