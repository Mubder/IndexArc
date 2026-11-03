import type { AppSettings } from "../../types.js";

/** Settings values for `ai_provider` / `llm_provider_override` (plus "heuristic"). */
export type ProviderId = "local" | "api" | "openai" | "groq" | "openrouter" | "anthropic" | "local_openai";
export type ActiveProvider = ProviderId | "heuristic";

/**
 * What the caller wants back:
 * - "json": structured output (paste analysis) — JSON mode where supported.
 * - "text": free text (rewrite, proofread, Ask answers).
 * - "complete": a short live continuation of `prompt` (autocomplete).
 */
export type GenerateMode = "json" | "text" | "complete";

export interface GenerateRequest {
  mode: GenerateMode;
  prompt: string;
  system: string;
  /** "complete" only: output token budget. */
  maxTokens?: number;
  /** "json" only: a provider-native response schema, where one is supported (Gemini). */
  responseSchema?: unknown;
}

/**
 * One AI provider. Adapters only talk to their service — consent and
 * egress checks live in one place (providers.ts `cloudEgressAllowed`,
 * applied by every caller before an adapter is reached).
 */
export interface ProviderAdapter {
  id: ProviderId;
  /** Short name used in provider_used labels ("ollama", "gemini", …). */
  label: string;
  /** Human name for logs. */
  displayName: string;
  /** Picked by "auto" (in registry order) when ready. */
  auto: boolean;
  /** True when requests stay on this machine (loopback). */
  isLocal(settings: AppSettings): boolean;
  /** Usable right now: key configured, or the local server answering. */
  ready(settings: AppSettings): Promise<boolean>;
  /** The LLM model the settings select. */
  model(settings: AppSettings): string;
  /** Text back, or null on any failure (logged by the adapter). */
  generate(settings: AppSettings, req: GenerateRequest): Promise<string | null>;
  /** Absent when the provider has no embeddings API. */
  embed?(settings: AppSettings, text: string): Promise<number[] | null>;
  /** Identifies the embedding space (model) `embed` uses. */
  embedModelId?(settings: AppSettings): string;
}
