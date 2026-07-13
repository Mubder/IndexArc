import { GoogleGenAI, Type } from "@google/genai";
import type { AnalyzeCandidate, AppSettings } from "../types.js";
import { heuristicAnalyze } from "./heuristics.js";
import { addLog } from "../logs.js";
import { randomUUID } from "crypto";

export async function checkOllama(baseUrl: string): Promise<{ online: boolean; models: string[] }> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { online: false, models: [] };
    const data = (await res.json()) as { models?: { name: string }[] };
    return {
      online: true,
      models: (data.models || []).map((m) => m.name),
    };
  } catch {
    return { online: false, models: [] };
  }
}

export async function resolveActiveProvider(
  settings: AppSettings
): Promise<"local" | "api" | "heuristic"> {
  if (settings.ai_provider === "local") {
    const o = await checkOllama(settings.ollama_base_url);
    return o.online ? "local" : "heuristic";
  }
  if (settings.ai_provider === "api") {
    return settings.gemini_api_key ? "api" : "heuristic";
  }
  // auto
  const o = await checkOllama(settings.ollama_base_url);
  if (o.online) return "local";
  if (settings.gemini_api_key) return "api";
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

export async function embedText(
  settings: AppSettings,
  text: string,
  provider?: "local" | "api" | "heuristic"
): Promise<number[] | null> {
  const active = provider || (await resolveActiveProvider(settings));
  if (active === "local") return ollamaEmbed(settings, text);
  if (active === "api") return geminiEmbed(settings, text);
  return null;
}

const ANALYZE_SYSTEM = `You are IndexArc Vault classifier. Extract ALL secrets, tokens, IDs, commands, and notes from the user paste.
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
- If a line is a human title and the next line is a key/ID, use the title as name and the key as value (family=secret). Example:
  Antigravity Kazma Build
  4475….apps.googleusercontent.com
  → name="Antigravity Kazma Build", value=client id, type="google oauth client id", family=secret
- Google *.apps.googleusercontent.com → type "google oauth client id", family=secret.
- Unknown high-entropy keys: family=unknown, needs_type=true, needs_name=true.
- Commands (shell): family=command.
- Plain text only (no secret): family=note.
- NEVER put title+value into one note. Split them.
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
    if (active === "local") {
      addLog("ANALYZE", `Ollama classify via ${settings.ollama_llm_model}`);
      const text = await ollamaGenerate(settings, userPrompt, ANALYZE_SYSTEM);
      if (text) {
        const parsed = extractJsonObject(text);
        if (parsed) {
          let candidates = normalizeLlmCandidates(parsed, paste).filter((c) => !isGarbageCandidate(c));
          candidates = mergeCandidates(heuristic, candidates);
          if (candidates.length) {
            addLog("ANALYZE", `Ollama+heuristic → ${candidates.length} candidate(s)`);
            return { candidates, provider_used: "ollama+heuristic" };
          }
        } else {
          addLog("ANALYZE", "Ollama returned non-JSON — using heuristics");
        }
      } else {
        addLog("ANALYZE", "Ollama generate empty — using heuristics");
      }
    }

    if (active === "api") {
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
      if (response.text) {
        const parsed = extractJsonObject(response.text.trim()) || JSON.parse(response.text.trim());
        let candidates = normalizeLlmCandidates(parsed, paste).filter((c) => !isGarbageCandidate(c));
        candidates = mergeCandidates(heuristic, candidates);
        return { candidates, provider_used: "gemini+heuristic" };
      }
    }
  } catch (e: any) {
    addLog("ANALYZE", `AI analyze failed, heuristics fallback: ${e.message}`);
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
