import type { AppSettings } from "../../types.js";
import { addLog } from "../../logs.js";
import { isLoopback, ollamaBase, OLLAMA_DEFAULT_BASE } from "./net.js";
import type { GenerateRequest, ProviderAdapter } from "./types.js";

let lastOllamaCheck: { online: boolean; models: string[] } | null = null;
let lastOllamaCheckTime = 0;
let lastOllamaCheckBase = "";

export async function checkOllama(
  settings: Pick<AppSettings, "ollama_base_url" | "ai_cloud_consent">,
  force = false
): Promise<{ online: boolean; models: string[] }> {
  const now = Date.now();
  const cleanBase = ollamaBase(settings, "checkOllama");
  // Even the availability probe is off-device egress when Ollama is remote:
  // without consent the remote host is simply "offline" and never contacted.
  if (!isLoopback(cleanBase) && !settings.ai_cloud_consent) {
    return { online: false, models: [] };
  }
  // The cache is per base URL — switching hosts must not reuse the old answer.
  if (!force && lastOllamaCheck && lastOllamaCheckBase === cleanBase && now - lastOllamaCheckTime < 10000) {
    return lastOllamaCheck;
  }
  lastOllamaCheckBase = cleanBase;
  const candidates = [cleanBase];
  if (cleanBase.includes("localhost")) candidates.push(cleanBase.replace("localhost", "127.0.0.1"));
  else if (cleanBase.includes("127.0.0.1")) candidates.push(cleanBase.replace("127.0.0.1", "localhost"));

  for (const url of candidates) {
    try {
      const res = await fetch(`${url}/api/tags`, {
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = (await res.json()) as { models?: { name: string }[] };
        lastOllamaCheck = {
          online: true,
          models: (data.models || []).map((m) => m.name),
        };
        lastOllamaCheckTime = Date.now();
        return lastOllamaCheck;
      }
    } catch {}
  }

  lastOllamaCheck = { online: false, models: [] };
  lastOllamaCheckTime = Date.now();
  return lastOllamaCheck;
}

/** Structured output (paste analysis). */
async function ollamaGenerateJson(settings: AppSettings, prompt: string, system: string): Promise<string | null> {
  const base = ollamaBase(settings, "ollama");
  const model = settings.ollama_llm_model;
  // Cold load of 7B can exceed 20s — give the model time, then keep it resident
  const timeoutMs = 180_000;

  const attempt = async (useJsonFormat: boolean): Promise<string | null> => {
    try {
      addLog("OLLAMA", `generate → ${model}${useJsonFormat ? " (json)" : ""}`);
      const res = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          system,
          stream: false,
          ...(useJsonFormat ? { format: "json" } : {}),
          // Keep LLM in VRAM so subsequent pastes aren't "embed-only"
          keep_alive: "30m",
          options: {
            temperature: 0.1,
            num_predict: 2048,
            num_ctx: 4096,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        addLog("OLLAMA", `generate HTTP ${res.status}: ${body.slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as { response?: string; error?: string };
      if (data.error) {
        addLog("OLLAMA", `generate error: ${data.error}`);
        return null;
      }
      const text = data.response?.trim() || null;
      if (text) addLog("OLLAMA", `generate ok (${text.length} chars) — model kept warm 30m`);
      return text;
    } catch (e: any) {
      addLog("OLLAMA", `generate failed: ${e.message}`);
      return null;
    }
  };

  // Prefer structured JSON; fall back to free-form JSON in the prose
  return (await attempt(true)) || (await attempt(false));
}

/** Free text; long documents need generous context and output budget. */
async function ollamaGenerateText(settings: AppSettings, prompt: string, system: string): Promise<string | null> {
  const base = ollamaBase(settings, "ollama");
  const model = settings.ollama_llm_model;
  // Scale with input: rough token estimate (~4 chars/token) plus headroom for
  // the rewritten text.
  const inputTokens = Math.ceil(prompt.length / 4) + 64;
  const outputTokens = Math.max(1024, inputTokens * 2);
  const numCtx = Math.min(32768, Math.max(8192, inputTokens + outputTokens + 512));
  const timeoutMs = 180_000;

  const attempt = async (useLargeBudget: boolean): Promise<string | null> => {
    try {
      addLog("OLLAMA", `generateText → ${model} (ctx ${numCtx}, predict ${useLargeBudget ? outputTokens * 2 : outputTokens})`);
      const res = await fetch(`${base}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          prompt,
          system,
          stream: false,
          keep_alive: "30m",
          options: {
            temperature: 0.3,
            num_predict: useLargeBudget ? outputTokens * 2 : outputTokens,
            num_ctx: numCtx,
          },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        addLog("OLLAMA", `generateText HTTP ${res.status}: ${body.slice(0, 200)}`);
        return null;
      }
      const data = (await res.json()) as {
        response?: string;
        error?: string;
        done_reason?: string;
      };
      if (data.error) {
        addLog("OLLAMA", `generateText error: ${data.error}`);
        return null;
      }
      const text = data.response?.trim();
      if (!text) {
        addLog("OLLAMA", `generateText returned empty response (done_reason=${data.done_reason || "unknown"})`);
        return null;
      }
      addLog("OLLAMA", `generateText ok (${text.length} chars, done_reason=${data.done_reason || "unknown"})`);
      return text;
    } catch (e: any) {
      addLog("OLLAMA", `generateText failed: ${e.message}`);
      return null;
    }
  };

  // Some models return an empty response when they hit the output budget early.
  // Retry once with a larger budget before giving up.
  const first = await attempt(false);
  if (first) return first;
  return attempt(true);
}

/** Live autocomplete: short budget, small context, the system text inlined. */
async function ollamaComplete(settings: AppSettings, req: GenerateRequest): Promise<string | null> {
  const base = ollamaBase(settings, "ollama autocomplete");
  const res = await fetch(`${base}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: settings.ollama_llm_model,
      prompt: `${req.system}\n\nUser Text:\n${req.prompt}`,
      stream: false,
      keep_alive: "5m",
      options: {
        temperature: 0.2,
        num_predict: req.maxTokens ?? 32,
        num_ctx: 2048,
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { response?: string };
  return data.response || null;
}

export async function ollamaEmbed(settings: AppSettings, text: string): Promise<number[] | null> {
  const base = ollamaBase(settings, "ollama");
  const cleaned = text.slice(0, 8000).trim();
  if (!cleaned) return null;

  for (const endpoint of ["/api/embed", "/api/embeddings"] as const) {
    try {
      const payload =
        endpoint === "/api/embed"
          ? { model: settings.ollama_embed_model, input: cleaned }
          : { model: settings.ollama_embed_model, prompt: cleaned };
      const res = await fetch(`${base}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        embeddings?: number[][];
        embedding?: number[];
      };
      if (data.embeddings?.[0]) return data.embeddings[0];
      if (data.embedding) return data.embedding;
    } catch {
      continue;
    }
  }
  return null;
}

/** Load LLM into memory so analyze isn't embed-only */
export async function warmOllamaLlm(settings: AppSettings): Promise<boolean> {
  const base = ollamaBase(settings, "ollama");
  try {
    addLog("OLLAMA", `Warming LLM ${settings.ollama_llm_model}…`);
    const res = await fetch(`${base}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.ollama_llm_model,
        prompt: 'Reply with exactly: {"ok":true}',
        stream: false,
        format: "json",
        keep_alive: "30m",
        options: { temperature: 0, num_predict: 16 },
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      addLog("OLLAMA", `warm failed HTTP ${res.status}`);
      return false;
    }
    addLog("OLLAMA", `LLM ${settings.ollama_llm_model} is loaded (keep_alive 30m)`);
    return true;
  } catch (e: any) {
    addLog("OLLAMA", `warm failed: ${e.message}`);
    return false;
  }
}

/** Load the embed model into memory so scan/analyze doesn't pull it on demand */
export async function warmOllamaEmbed(settings: AppSettings): Promise<boolean> {
  const base = ollamaBase(settings, "ollama");
  try {
    addLog("OLLAMA", `Warming embed model ${settings.ollama_embed_model}…`);
    const res = await fetch(`${base}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.ollama_embed_model,
        input: "warm",
        keep_alive: "30m",
      }),
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      addLog("OLLAMA", `embed warm failed HTTP ${res.status} (model may not support embeddings)`);
      return false;
    }
    addLog("OLLAMA", `Embed model ${settings.ollama_embed_model} is loaded (keep_alive 30m)`);
    return true;
  } catch (e: any) {
    addLog("OLLAMA", `embed warm failed: ${e.message}`);
    return false;
  }
}

export async function pullOllamaModel(
  settings: AppSettings,
  modelName: string,
  onProgress?: (msg: string) => void
): Promise<boolean> {
  try {
    const res = await fetch(`${ollamaBase(settings, "ollama pull")}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
      // Model pulls are legitimately slow, but the operation must not hang forever.
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok || !res.body) return false;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split("\n").filter((l) => l.trim())) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.status) onProgress?.(String(parsed.status));
        } catch {
          /* ignore */
        }
      }
    }
    return true;
  } catch (e: any) {
    addLog("OLLAMA", `pull failed: ${e.message}`);
    return false;
  }
}

export const ollamaAdapter: ProviderAdapter = {
  id: "local",
  label: "ollama",
  displayName: "Ollama",
  auto: true,
  isLocal: (s) => isLoopback(s.ollama_base_url || OLLAMA_DEFAULT_BASE),
  ready: async (s) => (await checkOllama(s)).online,
  model: (s) => s.ollama_llm_model,
  generate: (s, req) =>
    req.mode === "json"
      ? ollamaGenerateJson(s, req.prompt, req.system)
      : req.mode === "text"
        ? ollamaGenerateText(s, req.prompt, req.system)
        : ollamaComplete(s, req),
  embed: ollamaEmbed,
  embedModelId: (s) => `local:${s.ollama_embed_model}`,
};
