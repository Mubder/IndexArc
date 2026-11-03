import type { AppSettings } from "../../types.js";
import { fetchOpenAiCompatible, fetchOpenAiEmbeddings, isLoopback, safeBaseUrl } from "./net.js";
import type { GenerateRequest, ProviderAdapter, ProviderId } from "./types.js";

// OpenAI, Groq, OpenRouter and any local OpenAI-compatible server (LM Studio,
// llama.cpp, vLLM) share one wire format; each is a row of settings below.

interface CompatConfig {
  id: ProviderId;
  label: string;
  displayName: string;
  auto: boolean;
  /** The API base (…/v1), or null when the configured URL is invalid. */
  base(s: AppSettings): string | null;
  key(s: AppSettings): string;
  model(s: AppSettings): string;
  ready(s: AppSettings): boolean;
  isLocal(s: AppSettings): boolean;
  headers?: Record<string, string>;
  embedModel?(s: AppSettings): string;
}

function compatAdapter(c: CompatConfig): ProviderAdapter {
  const generate = async (s: AppSettings, req: GenerateRequest): Promise<string | null> => {
    const base = c.base(s);
    if (!base) return null;
    return fetchOpenAiCompatible(
      `${base}/chat/completions`,
      c.key(s),
      c.model(s),
      req.prompt,
      req.system,
      c.headers ?? {},
      req.mode === "json"
    );
  };
  const embedModel = c.embedModel;
  return {
    id: c.id,
    label: c.label,
    displayName: c.displayName,
    auto: c.auto,
    isLocal: c.isLocal,
    ready: async (s) => c.ready(s),
    model: c.model,
    generate,
    ...(embedModel
      ? {
          embed: async (s: AppSettings, text: string) => {
            const base = c.base(s);
            if (!base) return null;
            return fetchOpenAiEmbeddings(`${base}/embeddings`, c.key(s), embedModel(s), text);
          },
          embedModelId: (s: AppSettings) => `${c.id}:${embedModel(s)}`,
        }
      : {}),
  };
}

export const openaiAdapter = compatAdapter({
  id: "openai",
  label: "openai",
  displayName: "OpenAI",
  auto: true,
  base: () => "https://api.openai.com/v1",
  key: (s) => s.openai_api_key,
  model: (s) => s.openai_llm_model,
  ready: (s) => !!s.openai_api_key,
  isLocal: () => false,
  embedModel: () => "text-embedding-3-small",
});

export const groqAdapter = compatAdapter({
  id: "groq",
  label: "groq",
  displayName: "Groq",
  auto: true,
  base: () => "https://api.groq.com/openai/v1",
  key: (s) => s.groq_api_key,
  model: (s) => s.groq_llm_model,
  ready: (s) => !!s.groq_api_key,
  isLocal: () => false,
});

export const openrouterAdapter = compatAdapter({
  id: "openrouter",
  label: "openrouter",
  displayName: "OpenRouter",
  auto: true,
  base: () => "https://openrouter.ai/api/v1",
  key: (s) => s.openrouter_api_key,
  model: (s) => s.openrouter_llm_model,
  ready: (s) => !!s.openrouter_api_key,
  isLocal: () => false,
  headers: { "X-Title": "IndexArc" },
});

const localCompat = compatAdapter({
  id: "local_openai",
  label: "local_openai",
  displayName: "Local OpenAI compatible",
  // Never picked by "auto": only when the user selects it.
  auto: false,
  base: (s) => safeBaseUrl(s.local_openai_base_url, "local_openai"),
  key: (s) => s.local_openai_api_key,
  model: (s) => s.local_openai_llm_model,
  ready: () => true,
  isLocal: (s) => isLoopback(s.local_openai_base_url),
  // Falls back to the LLM model when no dedicated embedding model is set.
  embedModel: (s) => s.local_openai_embed_model || s.local_openai_llm_model,
});

/** Local servers get a short, budgeted autocomplete call; the rest reuse chat. */
async function localComplete(s: AppSettings, req: GenerateRequest): Promise<string | null> {
  const base = safeBaseUrl(s.local_openai_base_url, "local_openai autocomplete");
  if (!base) return null;
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: s.local_openai_llm_model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.prompt },
      ],
      max_tokens: req.maxTokens ?? 32,
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content || null;
}

export const localOpenAiAdapter: ProviderAdapter = {
  ...localCompat,
  generate: (s, req) => (req.mode === "complete" ? localComplete(s, req) : localCompat.generate(s, req)),
};
