import { Type } from "@google/genai";
import type { AnalyzeCandidate, AppSettings } from "../types.js";
import { heuristicAnalyze } from "./heuristics.js";
import { addLog } from "../logs.js";
import { randomUUID } from "crypto";
import { ADAPTERS, getAdapter, type ActiveProvider, type GenerateRequest } from "./adapters/index.js";

// Provider wire code lives in ./adapters (one file per provider). This module
// owns provider resolution, the egress gate, and the AI features built on top.
export { checkOllama, ollamaEmbed, warmOllamaLlm, warmOllamaEmbed, pullOllamaModel } from "./adapters/ollama.js";
export type { ActiveProvider } from "./adapters/index.js";

// ── Egress consent & locality (audit H2) ──────────────────────────────────
// A vault must never leak secret-derived text off the machine by default.
// Cloud providers (Gemini/OpenAI/Groq/OpenRouter/Anthropic, or a "local"
// provider pointed at a non-loopback host) are blocked until the user
// explicitly opts in via ai_cloud_consent. Loopback providers (Ollama,
// LM Studio on 127.0.0.1) are always allowed — data stays on the machine.
// Independently of consent, secret VALUES never enter cloud embedding or
// LLM input at all (see services/vault.ts + services/ask.ts).

export function isLocalProvider(settings: AppSettings, provider: string): boolean {
  return getAdapter(provider)?.isLocal(settings) ?? false;
}

let consentWarnedAt = 0;
export function cloudEgressAllowed(settings: AppSettings, provider: string, purpose: string): boolean {
  if (provider === "heuristic" || isLocalProvider(settings, provider)) return true;
  if (settings.ai_cloud_consent) return true;
  if (Date.now() - consentWarnedAt > 30_000) {
    consentWarnedAt = Date.now();
    addLog(
      "AI",
      `Cloud AI (${provider}) blocked for ${purpose}: ai_cloud_consent is OFF. Enable it in Settings → AI after reviewing exactly what would leave this device.`
    );
  }
  return false;
}

/**
 * The one path from a feature to a provider's LLM: the egress gate, then the
 * adapter. Null when the provider is unknown, blocked, or failed.
 */
async function callProvider(
  settings: AppSettings,
  active: ActiveProvider,
  req: GenerateRequest,
  purpose: string
): Promise<string | null> {
  const adapter = getAdapter(active);
  if (!adapter) return null;
  if (!cloudEgressAllowed(settings, active, purpose)) return null;
  addLog("AI", `${purpose} via ${adapter.displayName} (${adapter.model(settings)})`);
  return adapter.generate(settings, req);
}

/**
 * Which provider serves this request: an explicit LLM override, then the
 * selected provider, then "auto" (first ready adapter in registry order).
 * A pinned provider that is not ready means heuristics, never another one.
 */
export async function resolveActiveProvider(settings: AppSettings): Promise<ActiveProvider> {
  if (settings.llm_provider_override === "heuristic") return "heuristic";
  for (const choice of [settings.llm_provider_override, settings.ai_provider]) {
    const adapter = getAdapter(choice);
    if (adapter) return (await adapter.ready(settings)) ? adapter.id : "heuristic";
  }
  for (const adapter of ADAPTERS) {
    if (adapter.auto && (await adapter.ready(settings))) return adapter.id;
  }
  return "heuristic";
}

function isGarbageCandidate(c: AnalyzeCandidate): boolean {
  const bad = /freeform type|short stable name|e\.g\.|example|required for secrets|needs_type|model_notes/i;
  if (bad.test(c.type) || bad.test(c.name) || bad.test(c.value)) return true;
  if (c.value.length < 1) return true;
  // prompt leakage
  if (c.type.length > 80) return true;
  return false;
}

export async function embedText(
  settings: AppSettings,
  text: string,
  providerOverride?: ActiveProvider
): Promise<number[] | null> {
  // The user's explicit embedding pin wins over the caller's per-request
  // provider (callers pass the resolved LLM provider; with embeddings pinned
  // to local and the LLM in the cloud, entry metadata went to the cloud).
  const active = settings.embed_provider_override || providerOverride || (await resolveActiveProvider(settings));
  // Egress gate: cloud embeddings of vault-derived text need explicit consent.
  if (!cloudEgressAllowed(settings, active, "embeddings")) return null;
  const adapter = getAdapter(active);
  if (adapter?.embed) return adapter.embed(settings, text);
  // A pinned provider that is unavailable means NO embedding — never a quiet
  // fall-through to another provider (a "local" pin with Ollama offline
  // resolves to "heuristic" and used to land on Gemini). Only "auto" with no
  // overrides may shop around.
  const pinned =
    !!settings.embed_provider_override ||
    !!settings.llm_provider_override ||
    (!!settings.ai_provider && settings.ai_provider !== "auto");
  if (pinned) return null;
  // Fallbacks reach DIFFERENT providers than the one gated above, so each
  // re-checks consent instead of silently egressing.
  const gemini = getAdapter("api")!;
  if (settings.gemini_api_key && cloudEgressAllowed(settings, "api", "embeddings fallback")) {
    return gemini.embed!(settings, text);
  }
  const ollama = getAdapter("local")!;
  if (cloudEgressAllowed(settings, "local", "embeddings fallback") && (await ollama.ready(settings))) {
    return ollama.embed!(settings, text);
  }
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

export function resolveVerbatimValue(llmValue: string, paste: string): string {
  const raw = String(llmValue ?? "");
  if (!raw) return raw;
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // LLM often strips leading underscore(s) — recover verbatim from paste BEFORE
  // checking paste.includes(trimmed) because the stripped value is substring of the verbatim one
  if (!trimmed.startsWith("_")) {
    // Prefer longest underscore run (handles __secret vs _secret)
    try {
      const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const m = paste.match(new RegExp(`_+${escaped}`));
      if (m && m[0] && paste.includes(m[0])) return m[0];
    } catch {}
    const withUnder = "_" + trimmed;
    if (paste.includes(withUnder)) return withUnder;
  }
  // LLM often strips http(s):// or ftp:// — recover full URL from paste
  if (!/^(?:https?|ftp):\/\//i.test(trimmed)) {
    const lines = paste.split(/\r?\n/);
    for (const line of lines) {
      const urlMatch = line.match(/(?:https?|ftp):\/\/[^\s"']+/i);
      if (urlMatch && urlMatch[0].includes(trimmed)) return urlMatch[0];
    }
  }
  // Generic leading special-char recovery: LLM may strip @#%*() before _secret
  // e.g. paste "@_eq9wyu..." LLM returns "_eq9wyu..." — recover verbatim line
  {
    const lines = paste.split(/\r?\n/);
    for (const line of lines) {
      const t = line.trim();
      if (!t || t === trimmed) continue;
      if (t.includes(trimmed) && t.length - trimmed.length <= 5 && t.length < 500) {
        // prefix is 1-5 non-alphanum chars (like @, #, @_, etc)
        const prefix = t.slice(0, t.indexOf(trimmed));
        if (/^[^A-Za-z0-9]*$/.test(prefix) && paste.includes(t)) return t;
      }
    }
  }
  // LLM normalized underscores to spaces — recover underscore version
  if (trimmed.includes(" ") && paste.includes(trimmed.replace(/ /g, "_"))) {
    const underscored = trimmed.replace(/ /g, "_");
    if (paste.includes(underscored)) return underscored;
  }
  // Exact verbatim hit — preserve as LLM gave (includes leading _ or http) if no longer recovery found
  if (paste.includes(raw)) return raw;
  if (paste.includes(trimmed)) return trimmed;
  return trimmed;
}

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
    const verbatimValue = resolveVerbatimValue(c.value, paste);
    // Prefer paste-verbatim raw_fragment as well
    const rawFragRaw = String(c.raw_fragment || c.value || "").trim();
    const verbatimRaw =
      rawFragRaw && paste.includes(rawFragRaw)
        ? rawFragRaw
        : paste.includes(verbatimValue)
          ? (() => {
              const idx = paste.indexOf(verbatimValue);
              // grab surrounding line as fragment for context
              const start = paste.lastIndexOf("\n", idx) + 1;
              const endIdx = paste.indexOf("\n", idx + verbatimValue.length);
              const line = paste.slice(start, endIdx === -1 ? undefined : endIdx).trim();
              return line || verbatimValue;
            })()
          : verbatimValue || paste.slice(0, 200);
    return {
      temp_id: randomUUID(),
      value: verbatimValue,
      type,
      name,
      raw_fragment: verbatimRaw || paste.slice(0, 200),
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

// Gemini's native response schema for paste analysis (other providers get
// JSON mode plus the format spelled out in ANALYZE_SYSTEM).
const ANALYZE_SCHEMA = {
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
};

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
    // Egress gate inside callProvider: the paste is RAW secret material — the
    // single most sensitive text in the app. Blocked cloud → heuristics only.
    const text = await callProvider(
      settings,
      active,
      { mode: "json", prompt: userPrompt, system: ANALYZE_SYSTEM, responseSchema: ANALYZE_SCHEMA },
      "paste analysis"
    );
    const usedLabel = `${getAdapter(active)!.label}+heuristic`;

    if (text) {
      const parsed = extractJsonObject(text.trim());
      if (parsed) {
        let candidates = normalizeLlmCandidates(parsed, paste).filter((c) => !isGarbageCandidate(c));
        candidates = mergeCandidates(heuristic, candidates);
        // Enforce verbatim: whatever pasted is what is saved — recover leading _ / http if LLM stripped them
        candidates = candidates.map((c) => {
          if (paste.includes(c.value)) return c;
          const fixed = resolveVerbatimValue(c.value, paste);
          if (fixed && paste.includes(fixed) && fixed !== c.value) {
            const fixedRaw = c.raw_fragment && paste.includes(c.raw_fragment) ? c.raw_fragment : fixed;
            return { ...c, value: fixed, raw_fragment: fixedRaw };
          }
          return c;
        });
        // Prefer heuristic verbatim values over hallucinated LLM values that aren't in paste
        const heuristicValues = new Set(heuristic.map((h) => h.value));
        candidates = candidates.filter((c) => {
          if (paste.includes(c.value)) return true;
          // If LLM hallucinated a secret not present verbatim in paste, drop it if heuristic has a verbatim equivalent
          if ((c.family === "secret" || c.family === "unknown") && heuristicValues.size > 0) return false;
          return true;
        });
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

export async function generateText(
  settings: AppSettings,
  prompt: string,
  system: string,
  /** Use exactly this provider instead of re-resolving. Callers that shaped
   *  the prompt for a specific provider (Ask puts secret values in it only
   *  when that provider is LOCAL) must pin it: re-resolving here could pick a
   *  cloud fallback if the local one went offline in between. */
  pinnedProvider?: ActiveProvider
): Promise<{ text: string; provider_used: string } | null> {
  const active = pinnedProvider ?? (await resolveActiveProvider(settings));
  const adapter = getAdapter(active);
  if (!adapter) return null;
  try {
    // Egress gate inside callProvider: vault-derived text needs consent for cloud.
    const text = await callProvider(settings, active, { mode: "text", prompt, system }, "text generation");
    if (text) return { text, provider_used: `${adapter.label} (${adapter.model(settings)})` };
  } catch (e: any) {
    addLog("GENERATE", `Text generation failed: ...${e.message}`);
  }
  return null;
}

/**
 * Identifies the embedding space embedText() would use, so vectors from a
 * different model (same dimension, unrelated geometry) are never compared.
 */
export function embedModelId(settings: AppSettings, active: string): string {
  const p = settings.embed_provider_override || active;
  return getAdapter(p)?.embedModelId?.(settings) ?? p;
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

// --- Auto-complete / Live Prediction ---

const AUTO_COMPLETION_SYSTEM = `You are a live text completion engine. Predict ONLY the next 2 to 8 words that naturally continue the user's text.
STRICT RULES:
1. Return ONLY the new continuation words that come AFTER the input.
2. DO NOT repeat, echo, or duplicate any part of the input text.
3. Keep the same language (Arabic or English), tone, and style.
4. Do NOT add quotes, explanations, or quotes.`;

function extractContinuation(prefix: string, rawCompletion: string): string | null {
  if (!rawCompletion || !rawCompletion.trim()) return null;
  let comp = rawCompletion.trim();

  // Strip common labels
  comp = comp.replace(/^(Input|Output|Completion|Continuation):\s*/i, "").trim();

  const cleanPrefix = prefix.trim();
  if (comp.toLowerCase().startsWith(cleanPrefix.toLowerCase())) {
    comp = comp.slice(cleanPrefix.length).trim();
  }

  const words = cleanPrefix.split(/\s+/);
  for (let len = Math.min(6, words.length); len >= 2; len--) {
    const tail = words.slice(-len).join(" ");
    if (tail && comp.toLowerCase().startsWith(tail.toLowerCase())) {
      comp = comp.slice(tail.length).trim();
      break;
    }
  }

  comp = comp.replace(/^[.,;:!?\s]+/, "").trim();
  if (comp.length > 50) {
    comp = comp.slice(0, 50).replace(/\s+\S*$/, "").trim();
  }
  if (!comp || comp.length <= 1) return null;
  return comp;
}

/**
 * Generate text completion for live auto-complete
 * @param settings - App settings with AI provider configuration
 * @param prefix - The current text prefix (what the user has typed)
 * @param maxTokens - Maximum tokens to generate (default 64)
 * @returns Completed text continuation, or null if failed
 */
export async function autoComplete(
  settings: AppSettings,
  prefix: string,
  maxTokens: number = 32
): Promise<string | null> {
  const text = prefix.trim();
  if (!text) return null;

  const active = await resolveActiveProvider(settings);
  if (active === "heuristic") return null;

  try {
    // Egress gate inside callProvider: the prefix is live note content —
    // frequently the beginning of a secret being typed.
    const raw = await callProvider(
      settings,
      active,
      { mode: "complete", prompt: text, system: AUTO_COMPLETION_SYSTEM, maxTokens },
      "autocomplete"
    );
    if (raw) return extractContinuation(text, raw);
  } catch (e: any) {
    addLog("AUTOCOMPLETE", `Failed: ${e.message}`);
  }

  return null;
}
