import { Router } from "express";
import { addLog, getLogs } from "../logs.js";
import { sendSSE } from "./sse.js";
import type { RouteContext } from "./types.js";

export function settingsRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;

  r.get("/logs", (_req, res) => res.json(getLogs()));

  r.get("/settings", (_req, res) => {
    const s = store.getSettings();
    res.json({
      ...s,
      gemini_api_key: s.gemini_api_key,
    });
  });

  r.post("/settings", (req, res) => {
    const body = req.body || {};
    const allowed: (keyof ReturnType<typeof store.getSettings>)[] = [
      "ai_provider",
      "ollama_base_url",
      "ollama_llm_model",
      "ollama_embed_model",
      "gemini_api_key",
      "gemini_llm_model",
      "gemini_embed_model",
      "openai_api_key",
      "openai_llm_model",
      "groq_api_key",
      "groq_llm_model",
      "openrouter_api_key",
      "openrouter_llm_model",
      "anthropic_api_key",
      "anthropic_llm_model",
      "local_openai_base_url",
      "local_openai_api_key",
      "local_openai_llm_model",
      "local_openai_embed_model",
      "ui_language",
      "font_size_en",
      "font_size_ar",
      "enable_live_spellcheck",
      "enable_ai_proofreader",
      "llm_provider_override",
      "embed_provider_override",
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) patch[k] = body[k];
    }
    if (
      patch.ai_provider &&
      ![
        "local",
        "api",
        "auto",
        "openai",
        "groq",
        "openrouter",
        "anthropic",
        "local_openai",
      ].includes(patch.ai_provider as string)
    ) {
      return res.status(400).json({ error: "Invalid ai_provider" });
    }
    const next = store.saveSettings(patch as Partial<ReturnType<typeof store.getSettings>>);
    addLog("SETTINGS", `Updated AI provider mode: ${next.ai_provider}`);
    sendSSE("settings-changed", { ai_provider: next.ai_provider });
    res.json(next);
  });

  return r;
}
