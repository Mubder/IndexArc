import { GoogleGenAI, Type } from "@google/genai";
import type { AnalyzeCandidate, AppSettings } from "../types.js";
import { heuristicAnalyze } from "./heuristics.js";
import { addLog } from "../logs.js";
import { randomUUID } from "crypto";

let lastOllamaCheck: { online: boolean; models: string[] } | null = null;
let lastOllamaCheckTime = 0;

export async function checkOllama(baseUrl: string): Promise<{ online: boolean; models: string[] }> {
  const now = Date.now();
  if (lastOllamaCheck && (now - lastOllamaCheckTime < 10000)) {
    return lastOllamaCheck;
  }
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!res.ok) {
      lastOllamaCheck = { online: false, models: [] };
    } else {
      const data = (await res.json()) as { models?: { name: string }[] };
      lastOllamaCheck = {
        online: true,
        models: (data.models || []).map((m) => m.name),
      };
    }
  } catch {
    lastOllamaCheck = { online: false, models: [] };
  }
  lastOllamaCheckTime = Date.now();
  return lastOllamaCheck;
}

export async function resolveActiveProvider(
  settings: AppSettings
): Promise<"local" | "api" | "openai" | "groq" | "openrouter" | "anthropic" | "local_openai" | "heuristic"> {
  if (settings.ai_provider === "local") {
    const o = await checkOllama(settings.ollama_base_url);
    return o.online ? "local" : "heuristic";
  }
  if (settings.ai_provider === "api") {
    return settings.gemini_api_key ? "api" : "heuristic";
  }
  if (settings.ai_provider === "openai") {
    return settings.openai_api_key ? "openai" : "heuristic";
  }
  if (settings.ai_provider === "groq") {
    return settings.groq_api_key ? "groq" : "heuristic";
  }
  if (settings.ai_provider === "openrouter") {
    return settings.openrouter_api_key ? "openrouter" : "heuristic";
  }
  if (settings.ai_provider === "anthropic") {
    return settings.anthropic_api_key ? "anthropic" : "heuristic";
  }
  if (settings.ai_provider === "local_openai") {
    return "local_openai";
  }
  // auto
  const o = await checkOllama(settings.ollama_base_url);
  if (o.online) return "local";
  if (settings.gemini_api_key) return "api";
  if (settings.openai_api_key) return "openai";
  if (settings.groq_api_key) return "groq";
  if (settings.openrouter_api_key) return "openrouter";
  if (settings.anthropic_api_key) return "anthropic";
  return "heuristic";
}

async function ollamaGenerate(
  settings: AppSettings,
  prompt: string,
  system: string
): Promise<string | null> {
  const base = settings.ollama_base_url.replace(/\/$/, "");
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

/** Load LLM into memory so analyze isn't embed-only */
export async function warmOllamaLlm(settings: AppSettings): Promise<boolean> {
  const base = settings.ollama_base_url.replace(/\/$/, "");
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

function isGarbageCandidate(c: AnalyzeCandidate): boolean {
  const bad = /freeform type|short stable name|e\.g\.|example|required for secrets|needs_type|model_notes/i;
  if (bad.test(c.type) || bad.test(c.name) || bad.test(c.value)) return true;
  if (c.value.length < 1) return true;
  // prompt leakage
  if (c.type.length > 80) return true;
  return false;
}

export async function ollamaEmbed(
  settings: AppSettings,
  text: string
): Promise<number[] | null> {
  const base = settings.ollama_base_url.replace(/\/$/, "");
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

async function geminiEmbed(settings: AppSettings, text: string): Promise<number[] | null> {
  if (!settings.gemini_api_key) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: settings.gemini_api_key });
    const res: any = await ai.models.embedContent({
      model: settings.gemini_embed_model,
      contents: text.slice(0, 8000),
    });
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

async function fetchOpenAiCompatible(
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

async function anthropicGenerate(
  settings: AppSettings,
  prompt: string,
  system: string
): Promise<string | null> {
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

async function fetchOpenAiEmbeddings(
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

export async function embedText(
  settings: AppSettings,
  text: string,
  provider?: "local" | "api" | "openai" | "groq" | "openrouter" | "anthropic" | "local_openai" | "heuristic"
): Promise<number[] | null> {
  const active = provider || (await resolveActiveProvider(settings));
  if (active === "local") return ollamaEmbed(settings, text);
  if (active === "api") return geminiEmbed(settings, text);
  if (active === "openai") {
    return fetchOpenAiEmbeddings(
      "https://api.openai.com/v1/embeddings",
      settings.openai_api_key,
      "text-embedding-3-small",
      text
    );
  }
  if (active === "local_openai") {
    const baseUrl = settings.local_openai_base_url.replace(/\/$/, "");
    return fetchOpenAiEmbeddings(
      `${baseUrl}/embeddings`,
      settings.local_openai_api_key,
      settings.local_openai_llm_model,
      text
    );
  }
  // Fallbacks
  if (settings.gemini_api_key) return geminiEmbed(settings, text);
  const o = await checkOllama(settings.ollama_base_url);
  if (o.online) return ollamaEmbed(settings, text);
  return null;
}

const ANALYZE_SYSTEM = `You are IndexArc Vault classifier. Extract ALL secrets, tokens, IDs, commands, URLs, and notes from the user paste.
Return STRICT JSON:
{
  "candidates": [
    {
      "value": "the important value only",
      "type": "freeform type in English e.g. telegram user id",
      "name": "short stable name/alias required for secrets",
      "raw_fragment": "source line or snippet",
      "labels": ["optional","tags"],
      "type_aliases": ["telegram id","معرف تيليجرام"],
      "family": "secret|command|note|unknown",
      "needs_type": false,
      "needs_name": false,
      "confidence": 0.0-1.0,
      "model_notes": "optional"
    }
  ]
}
Rules:
- One paste may yield MANY candidates (.env files).
- Every secret/token/id MUST have a name if clear from context; else needs_name=true and name="".
- **name must NEVER be the secret value itself.** If no contextual name is available, use the type as the name (e.g. "google api key", "oauth client secret"). If even the type is unknown, leave name="" and set needs_name=true.
- If a line is a human title and the next line is a key/ID, use the title as name and the key as value (family=secret). Example:
  Gemini API New
  AQ.Ab8...
  → name="Gemini API New", value=AQ.Ab8..., type="google api key", family=secret
- Google *.apps.googleusercontent.com → type "google oauth client id", family=secret.
- Google GOCSPX-* → type "google oauth client secret", family=secret.
- Google API keys (AIza*, AQ.*) → type "google api key", family=secret.
- URLs (https://... or http://...) on their own line → family=note, type="url", name="url". Keep the full URL as value, do NOT split it.
- Unknown high-entropy keys: family=unknown, needs_type=true, needs_name=true.
- Commands (shell): family=command.
- Plain text only (no secret): family=note.
- NEVER put title+value into one note. Split them.
- NEVER split a URL into parts. Keep the entire URL as one candidate.
- Include Arabic aliases in type_aliases when relevant.
- Do not invent values not present in the paste.
- value must be the critical payload (e.g. the ID number, not the whole env line).`;

function normalizeLlmCandidates(raw: any, paste: string): AnalyzeCandidate[] {
  const list = Array.isArray(raw?.candidates) ? raw.candidates : Array.isArray(raw) ? raw : [];
  if (!list.length) return heuristicAnalyze(paste);

  return list.map((c: any) => {
    const family = (["secret", "command", "note", "unknown"].includes(c.family)
      ? c.family
      : "unknown") as AnalyzeCandidate["family"];
    let needs_type = !!c.needs_type || !String(c.type || "").trim();
    let needs_name = !!c.needs_name || !String(c.name || "").trim();
    // Prevent LLM from using the value itself as the name
    const valueStr = String(c.value || "").trim();
    const nameStr = String(c.name || "").trim();
    if (nameStr && valueStr && nameStr === valueStr) {
      needs_name = true;
    }
    if (family === "note" || family === "command") {
      needs_type = false;
      needs_name = false;
    }
    if (family === "secret" || family === "unknown") {
      if (!String(c.name || "").trim()) needs_name = true;
      if (!String(c.type || "").trim()) needs_type = true;
    }
    const type = String(c.type || "").trim();
    const name =
      String(c.name || "").trim() ||
      (family === "note" || family === "command" ? String(c.value || "").slice(0, 40) : "");
    const ready = !needs_type && !needs_name;
    return {
      temp_id: randomUUID(),
      value: String(c.value ?? "").trim(),
      type,
      name,
      raw_fragment: String(c.raw_fragment || c.value || "").trim() || paste.slice(0, 200),
      labels: Array.isArray(c.labels) ? c.labels.map(String) : [],
      type_aliases: Array.isArray(c.type_aliases) ? c.type_aliases.map(String) : [],
      family: needs_type ? "unknown" : family,
      confidence: typeof c.confidence === "number" ? c.confidence : 0.6,
      needs_type,
      needs_name,
      ready,
      model_notes: c.model_notes ? String(c.model_notes) : undefined,
    } satisfies AnalyzeCandidate;
  }).filter((c: AnalyzeCandidate) => c.value.length > 0);
}

function extractJsonObject(text: string): any | null {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try to recover JSON blob from model prose */
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export async function analyzePaste(
  paste: string,
  settings: AppSettings
): Promise<{ candidates: AnalyzeCandidate[]; provider_used: string }> {
  // Heuristics are always the reliability baseline (env files, IDs, commands)
  const heuristic = heuristicAnalyze(paste);
  const active = await resolveActiveProvider(settings);

  if (active === "heuristic") {
    addLog("ANALYZE", `Heuristics only → ${heuristic.length} candidate(s)`);
    return { candidates: heuristic, provider_used: "heuristic" };
  }

  const userPrompt = `Paste to analyze:\n"""\n${paste.slice(0, 12000)}\n"""\nReturn JSON candidates only.`;

  try {
    let text: string | null = null;
    let usedLabel = "";

    if (active === "local") {
      addLog("ANALYZE", `Ollama classify via ${settings.ollama_llm_model}`);
      text = await ollamaGenerate(settings, userPrompt, ANALYZE_SYSTEM);
      usedLabel = "ollama+heuristic";
    } else if (active === "api") {
      addLog("ANALYZE", `Gemini classify via ${settings.gemini_llm_model}`);
      const ai = new GoogleGenAI({ apiKey: settings.gemini_api_key });
      const response = await ai.models.generateContent({
        model: settings.gemini_llm_model,
        contents: userPrompt,
        config: {
          systemInstruction: ANALYZE_SYSTEM,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              candidates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    value: { type: Type.STRING },
                    type: { type: Type.STRING },
                    name: { type: Type.STRING },
                    raw_fragment: { type: Type.STRING },
                    labels: { type: Type.ARRAY, items: { type: Type.STRING } },
                    type_aliases: { type: Type.ARRAY, items: { type: Type.STRING } },
                    family: { type: Type.STRING },
                    needs_type: { type: Type.BOOLEAN },
                    needs_name: { type: Type.BOOLEAN },
                    confidence: { type: Type.NUMBER },
                    model_notes: { type: Type.STRING },
                  },
                  required: ["value", "family"],
                },
              },
            },
            required: ["candidates"],
          },
        },
      });
      text = response.text || null;
      usedLabel = "gemini+heuristic";
    } else if (active === "openai") {
      addLog("ANALYZE", `OpenAI classify via ${settings.openai_llm_model}`);
      text = await fetchOpenAiCompatible(
        "https://api.openai.com/v1/chat/completions",
        settings.openai_api_key,
        settings.openai_llm_model,
        userPrompt,
        ANALYZE_SYSTEM,
        {},
        true
      );
      usedLabel = "openai+heuristic";
    } else if (active === "groq") {
      addLog("ANALYZE", `Groq classify via ${settings.groq_llm_model}`);
      text = await fetchOpenAiCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        settings.groq_api_key,
        settings.groq_llm_model,
        userPrompt,
        ANALYZE_SYSTEM,
        {},
        true
      );
      usedLabel = "groq+heuristic";
    } else if (active === "openrouter") {
      addLog("ANALYZE", `OpenRouter classify via ${settings.openrouter_llm_model}`);
      text = await fetchOpenAiCompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        settings.openrouter_api_key,
        settings.openrouter_llm_model,
        userPrompt,
        ANALYZE_SYSTEM,
        {
          "HTTP-Referer": "https://github.com/Mubder/IndexArc",
          "X-Title": "IndexArc",
        },
        true
      );
      usedLabel = "openrouter+heuristic";
    } else if (active === "anthropic") {
      addLog("ANALYZE", `Anthropic classify via ${settings.anthropic_llm_model}`);
      text = await anthropicGenerate(settings, userPrompt, ANALYZE_SYSTEM);
      usedLabel = "anthropic+heuristic";
    } else if (active === "local_openai") {
      addLog("ANALYZE", `Local OpenAI compatible classify via ${settings.local_openai_llm_model}`);
      const baseUrl = settings.local_openai_base_url.replace(/\/$/, "");
      text = await fetchOpenAiCompatible(
        `${baseUrl}/chat/completions`,
        settings.local_openai_api_key,
        settings.local_openai_llm_model,
        userPrompt,
        ANALYZE_SYSTEM,
        {},
        true
      );
      usedLabel = "local_openai+heuristic";
    }

    if (text) {
      const parsed = extractJsonObject(text.trim());
      if (parsed) {
        let candidates = normalizeLlmCandidates(parsed, paste).filter((c) => !isGarbageCandidate(c));
        candidates = mergeCandidates(heuristic, candidates);
        if (candidates.length) {
          addLog("ANALYZE", `${active} classify successful → ${candidates.length} candidate(s)`);
          return { candidates, provider_used: usedLabel };
        }
      } else {
        addLog("ANALYZE", `${active} returned non-JSON/invalid candidates`);
      }
    }
  } catch (e: any) {
    addLog("ANALYZE", `AI analyze failed (${active}), heuristics fallback: ${e.message}`);
  }

  return { candidates: heuristic, provider_used: "heuristic" };
}

/** Union by value; prefer typed secrets over whole-paste notes */
function mergeCandidates(
  heuristic: AnalyzeCandidate[],
  llm: AnalyzeCandidate[]
): AnalyzeCandidate[] {
  const byValue = new Map<string, AnalyzeCandidate>();
  const score = (c: AnalyzeCandidate) =>
    (c.family === "secret" || c.family === "unknown" ? 3 : 0) +
    (c.family === "command" ? 2 : 0) +
    (c.ready ? 2 : 0) +
    (c.type && !isGarbageCandidate(c) ? 1 : 0) +
    (c.name && c.name !== "unnamed" ? 0.8 : 0) +
    // Penalize mega notes that glue title+value
    (c.family === "note" && c.value.includes("\n") ? -2 : 0) +
    c.confidence;

  for (const c of [...llm, ...heuristic]) {
    if (isGarbageCandidate(c)) continue;
    const key = c.value.trim();
    const prev = byValue.get(key);
    if (!prev || score(c) >= score(prev)) byValue.set(key, c);
  }

  let out = [...byValue.values()];

  // Drop notes whose value fully contains a secret/command we already extracted
  const payloads = out.filter((c) => c.family !== "note");
  out = out.filter((c) => {
    if (c.family !== "note") return true;
    const absorbed = payloads.some(
      (p) => p.value && c.value.includes(p.value) && p.value !== c.value
    );
    return !absorbed;
  });

  return out;
}

export async function pullOllamaModel(
  settings: AppSettings,
  modelName: string,
  onProgress?: (msg: string) => void
): Promise<boolean> {
  try {
    const res = await fetch(`${settings.ollama_base_url.replace(/\/$/, "")}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: modelName }),
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

export async function generateText(
  settings: AppSettings,
  prompt: string,
  system: string
): Promise<{ text: string; provider_used: string } | null> {
  const active = await resolveActiveProvider(settings);
  if (active === "heuristic") return null;

  try {
    let text: string | null = null;
    let usedLabel = "";

    if (active === "local") {
      text = await ollamaGenerateText(settings, prompt, system);
      usedLabel = `ollama (${settings.ollama_llm_model})`;
    } else if (active === "api") {
      text = await geminiGenerateText(settings, prompt, system);
      usedLabel = `gemini (${settings.gemini_llm_model})`;
    } else if (active === "openai") {
      text = await fetchOpenAiCompatible(
        "https://api.openai.com/v1/chat/completions",
        settings.openai_api_key,
        settings.openai_llm_model,
        prompt,
        system,
        {},
        false
      );
      usedLabel = `openai (${settings.openai_llm_model})`;
    } else if (active === "groq") {
      text = await fetchOpenAiCompatible(
        "https://api.groq.com/openai/v1/chat/completions",
        settings.groq_api_key,
        settings.groq_llm_model,
        prompt,
        system,
        {},
        false
      );
      usedLabel = `groq (${settings.groq_llm_model})`;
    } else if (active === "openrouter") {
      text = await fetchOpenAiCompatible(
        "https://openrouter.ai/api/v1/chat/completions",
        settings.openrouter_api_key,
        settings.openrouter_llm_model,
        prompt,
        system,
        {
          "HTTP-Referer": "https://github.com/Mubder/IndexArc",
          "X-Title": "IndexArc",
        },
        false
      );
      usedLabel = `openrouter (${settings.openrouter_llm_model})`;
    } else if (active === "anthropic") {
      text = await anthropicGenerate(settings, prompt, system);
      usedLabel = `anthropic (${settings.anthropic_llm_model})`;
    } else if (active === "local_openai") {
      const baseUrl = settings.local_openai_base_url.replace(/\/$/, "");
      text = await fetchOpenAiCompatible(
        `${baseUrl}/chat/completions`,
        settings.local_openai_api_key,
        settings.local_openai_llm_model,
        prompt,
        system,
        {},
        false
      );
      usedLabel = `local_openai (${settings.local_openai_llm_model})`;
    }

    if (text) {
      return { text, provider_used: usedLabel };
    }
  } catch (e: any) {
    addLog("GENERATE", `Text generation failed: ...${e.message}`);
  }

  return null;
}

async function ollamaGenerateText(
  settings: AppSettings,
  prompt: string,
  system: string
): Promise<string | null> {
  const base = settings.ollama_base_url.replace(/\/$/, "");
  const model = settings.ollama_llm_model;
  const timeoutMs = 60_000;
  try {
    addLog("OLLAMA", `generateText → ${model}`);
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
          num_predict: 1024,
          num_ctx: 4096,
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { response?: string };
    return data.response?.trim() || null;
  } catch (e: any) {
    addLog("OLLAMA", `generateText failed: ${e.message}`);
    return null;
  }
}

async function geminiGenerateText(
  settings: AppSettings,
  prompt: string,
  system: string
): Promise<string | null> {
  if (!settings.gemini_api_key) return null;
  try {
    const ai = new GoogleGenAI({ apiKey: settings.gemini_api_key });
    const response = await ai.models.generateContent({
      model: settings.gemini_llm_model,
      contents: prompt,
      config: {
        systemInstruction: system,
        temperature: 0.3,
      },
    });
    return response.text || null;
  } catch (e: any) {
    addLog("GEMINI", `generateText failed: ${e.message}`);
    return null;
  }
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
