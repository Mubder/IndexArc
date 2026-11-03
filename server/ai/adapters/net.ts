import { addLog } from "../../logs.js";
import { isHttpUrl } from "../../validate.js";

export const OLLAMA_DEFAULT_BASE = "http://127.0.0.1:11434";

// Base URLs come from settings and end up in fetch targets that carry vault
// content. Only http(s) with a hostname is accepted; anything else falls
// through to the next provider instead of erroring the request path.
export function safeBaseUrl(url: string | undefined, label: string): string | null {
  const raw = String(url || "").trim();
  if (!isHttpUrl(raw)) {
    addLog("AI", `${label}: invalid base URL (must be http/https) — skipping provider`);
    return null;
  }
  return raw.replace(/\/$/, "");
}

/**
 * Validated Ollama base URL. Falls back to the loopback default when unset
 * or malformed — every ollama_base_url use must go through this (a raw
 * string used to produce confusing fetch errors, and an attacker-edited
 * non-loopback URL silently became an egress endpoint).
 * Note: consent for a non-loopback URL is still governed by isLocal +
 * cloudEgressAllowed before any adapter call.
 */
export function ollamaBase(settings: { ollama_base_url?: string }, label: string): string {
  const raw = String(settings.ollama_base_url || "").trim();
  if (!raw) return OLLAMA_DEFAULT_BASE;
  if (!isHttpUrl(raw)) {
    addLog("AI", `${label}: invalid ollama_base_url "${raw.slice(0, 60)}" — using loopback default`);
    return OLLAMA_DEFAULT_BASE;
  }
  return raw.replace(/\/$/, "");
}

export function isLoopback(url: string | undefined): boolean {
  try {
    const u = new URL(String(url || ""));
    return u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "::1";
  } catch {
    return false;
  }
}

/** POST to an OpenAI-compatible /chat/completions endpoint. */
export async function fetchOpenAiCompatible(
  url: string,
  apiKey: string,
  model: string,
  prompt: string,
  system: string,
  extraHeaders: Record<string, string> = {},
  useJsonFormat = true
): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const body = {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      ...(useJsonFormat ? { response_format: { type: "json_object" } } : {}),
    };

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      addLog("AI_COMPATIBLE", `HTTP ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: any;
    };

    if (data.error) {
      addLog("AI_COMPATIBLE", `API Error: ${JSON.stringify(data.error)}`);
      return null;
    }

    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e: any) {
    addLog("AI_COMPATIBLE", `Fetch failed: ${e.message}`);
    return null;
  }
}

/** POST to an OpenAI-compatible /embeddings endpoint. */
export async function fetchOpenAiEmbeddings(
  url: string,
  apiKey: string,
  model: string,
  text: string
): Promise<number[] | null> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        input: text.slice(0, 8000),
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as {
      data?: { embedding: number[] }[];
    };
    return data.data?.[0]?.embedding || null;
  } catch (e: any) {
    addLog("AI_EMBED", `OpenAI compatible embed failed: ${e.message}`);
    return null;
  }
}
