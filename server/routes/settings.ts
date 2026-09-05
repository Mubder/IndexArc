import { Router } from "express";
import { addLog, getLogs } from "../logs.js";
import { sendSSE } from "./sse.js";
import { isHttpUrl } from "../validate.js";
import type { RouteContext } from "./types.js";

// API keys are write-only: they are accepted by POST and never returned.
// GET responses carry `*_api_key_configured` booleans instead.
const KEY_FIELDS = [
  "gemini_api_key",
  "openai_api_key",
  "groq_api_key",
  "openrouter_api_key",
  "anthropic_api_key",
  "local_openai_api_key",
] as const;

function maskSettings(s: object): Record<string, unknown> {
  const src = s as Record<string, unknown>;
  const out: Record<string, unknown> = { ...src };
  for (const k of KEY_FIELDS) {
    out[`${k}_configured`] = Boolean(src[k]);
    out[k] = "";
  }
  return out;
}

export function settingsRoutes(ctx: RouteContext) {
  const r = Router();
  const { store } = ctx;

  r.get("/logs", (_req, res) => res.json(getLogs()));

  r.get("/settings", (_req, res) => {
    res.json(maskSettings(store.getSettings()));
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
      "auto_lock_minutes",
      "lock_on_minimize",
      "llm_provider_override",
      "embed_provider_override",
    ];
    const patch: Record<string, unknown> = {};
    for (const k of allowed) {
      if (body[k] === undefined) continue;
      // Key fields are write-only and sticky: an empty string means "keep the
      // stored key" so masked responses round-tripping through the client can
      // never wipe a saved key.
      if ((KEY_FIELDS as readonly string[]).includes(k) && String(body[k]).trim() === "") continue;
      patch[k] = body[k];
    }
    if (patch.auto_lock_minutes !== undefined) {
      const n = Number(patch.auto_lock_minutes);
      if (!Number.isFinite(n) || n < 0 || n > 1440) {
        return res.status(400).json({ error: "auto_lock_minutes must be 0-1440" });
      }
      patch.auto_lock_minutes = Math.round(n);
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
    // Base URLs become fetch targets that carry vault content — validate here
    // centrally (providers also guard defensively at call time).
    for (const k of ["ollama_base_url", "local_openai_base_url"] as const) {
      const v = patch[k];
      if (typeof v === "string" && v.trim() && !isHttpUrl(v)) {
        return res.status(400).json({ error: `${k} must be a valid http(s) URL` });
      }
    }
    const next = store.saveSettings(patch as Partial<ReturnType<typeof store.getSettings>>);
    addLog("SETTINGS", `Updated AI provider mode: ${next.ai_provider}`);
    sendSSE("settings-changed", { ai_provider: next.ai_provider });
    res.json(maskSettings(next));
  });

  return r;
}
